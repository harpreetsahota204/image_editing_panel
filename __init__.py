"""FiftyOne Image Edit Panel plugin.

Architecture
------------
The plugin consists of two registered components:

``ImageEditPanel`` (foo.Panel)
    A hybrid panel that surfaces a React UI inside the sample modal.
    Python lifecycle hooks (``on_load``, ``on_change_current_sample``,
    ``on_change_group_slice``) push filepath / sample-ID state to the
    React component via ``ctx.panel.set_state()``.  Two callable panel
    methods are exposed to the frontend:

    * ``run_edit``  – calls the HuggingFace Inference API and returns the
      edited image as a base64 data URL plus timing metadata.
    * ``update_slice`` – resolves the filepath/sample-ID for the currently
      selected group slice and returns them directly (bypassing
      ``set_state``, which requires a valid panel_id that is not available
      when called from a ``usePanelEvent`` handler in React).

``SaveEditedImages`` (foo.Operator)
    An unlisted operator invoked from the React layer to persist one or
    more edited turns as new ``edit_N`` group slices on the dataset.
    Optionally deep-copies a caller-specified list of label fields from the
    source sample onto each new sample.

Communication pattern
---------------------
React calls panel methods via ``usePanelEvent``.  Return values come back
through the callback argument rather than through ``set_state``, because
``usePanelEvent`` synthesises a panel_id from the event name which does not
match any real panel — making ``ctx.panel.set_state()`` silently fail when
called from those handlers.  Direct ``set_state`` calls in lifecycle hooks
(``on_load`` etc.) work correctly because the framework supplies the correct
panel_id in that context.
"""

import base64
import copy
import io
import os
import shutil
import time
import traceback

import bson
from huggingface_hub import InferenceClient
from PIL import Image

import fiftyone as fo
import fiftyone.core.fields as fof
import fiftyone.operators as foo
import fiftyone.operators.types as types
from fiftyone import ViewField as F
from fiftyone.core.odm.database import get_db_conn

# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Single source of truth for the model list — sent to React via set_state("models") in on_load.
MODELS = [
    "black-forest-labs/FLUX.2-dev",
    "black-forest-labs/FLUX.2-klein-4B",
    "black-forest-labs/FLUX.1-Kontext-dev",
    "kontext-community/relighting-kontext-dev-lora-v3",
    "lightx2v/Qwen-Image-Edit-2511-Lightning",
    "FireRedTeam/FireRed-Image-Edit-1.0",
    "Qwen/Qwen-Image-Edit-2509",
    "Qwen/Qwen-Image-Edit-2511",
    "tencent/HunyuanImage-3.0-Instruct",
]

DEFAULT_MODEL = "Qwen/Qwen-Image-Edit-2511"

# Temporary storage for edited images before the user saves them to the
# dataset.  Files here are NOT served by FiftyOne's /media endpoint (which
# only serves registered sample filepaths), so we return base64 data URLs
# for in-panel display instead of relying on makeMediaUrl().
TEMP_DIR = os.path.join(os.path.expanduser("~"), ".fiftyone", "image_edits")

# Names used when converting a flat dataset to grouped on first save.
GROUP_FIELD = "group"
ORIGINAL_SLICE = "original"


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _run_edit(
    hf_token: str,
    model: str,
    input_filepath: str,
    prompt: str,
    negative_prompt: str = None,
    num_inference_steps: int = None,
    guidance_scale: float = None,
    target_size: dict = None,
) -> tuple:
    """Call the HuggingFace Inference API and return the edited image.

    Parameters
    ----------
    hf_token:
        HuggingFace API token (read from the ``HF_TOKEN`` secret).
    model:
        HuggingFace model repo ID, e.g. ``"Qwen/Qwen-Image-Edit-2511"``.
    input_filepath:
        Absolute path to the source image on disk.
    prompt:
        Text instruction for the edit.
    negative_prompt:
        Optional negative prompt (passed as-is; ``None`` omits the param).
    num_inference_steps:
        Denoising steps.  Not supported by all models — see the retry
        logic below.
    guidance_scale:
        Classifier-free guidance scale.  Same caveat as above.
    target_size:
        Dict with ``{"width": int, "height": int}`` for the output
        resolution.  Defaults to the input image's natural dimensions so
        the output is always the same size as the source.

    Returns
    -------
    tuple of (output_filepath, generation_time, image_data_url, params_dropped)

    ``output_filepath``
        Path to the full-quality PNG saved in ``TEMP_DIR``.  Kept for
        dataset persistence when the user clicks the save icon.
    ``generation_time``
        Wall-clock seconds the API call took, rounded to 2 d.p.
    ``image_data_url``
        JPEG base64 data URL (max 1024 px, quality 85) for immediate
        in-panel display.  Bypasses FiftyOne's /media restriction.
    ``params_dropped``
        ``True`` when the first API call failed because the model rejected
        ``num_inference_steps`` / ``guidance_scale`` and we retried
        without them.  The caller should surface a warning to the user.
    """
    os.makedirs(TEMP_DIR, exist_ok=True)

    # 540 s keeps us under FiftyOne's hard 600 s operator execution timeout.
    # Models on HF Inference API can take 1–3 min to warm up on a cold start;
    # hitting this timeout surfaces a clear error instead of a silent hang.
    client = InferenceClient(token=hf_token, timeout=540)

    input_image = Image.open(input_filepath).convert("RGB")

    # Default to the source image's natural dimensions so the output is
    # pixel-for-pixel the same size as the input unless overridden.
    if target_size is None:
        target_size = {"width": input_image.width, "height": input_image.height}

    # Encode the input as PNG bytes for the API.
    buf = io.BytesIO()
    input_image.save(buf, format="PNG")
    buf.seek(0)

    t0 = time.time()
    params_dropped = False

    # First attempt: send the full parameter set.
    # Not all models/providers on HF Inference API support
    # ``num_inference_steps`` and ``guidance_scale`` — some reject them
    # with a 400/422 error rather than silently ignoring them.  When that
    # happens we retry without those two params so the edit still completes,
    # and flag ``params_dropped=True`` to show the user a warning banner.
    try:
        result_image = client.image_to_image(
            buf.getvalue(),
            prompt=prompt,
            negative_prompt=negative_prompt,
            num_inference_steps=num_inference_steps,
            guidance_scale=guidance_scale,
            model=model,
            target_size=target_size,
        )
    except Exception as first_exc:
        # If neither optional param was supplied there is nothing to drop,
        # so re-raise to surface the real error to the user.
        if num_inference_steps is None and guidance_scale is None:
            raise

        print(
            f"[image_edit] Retrying without num_inference_steps/guidance_scale "
            f"(model rejected them): {first_exc}"
        )
        result_image = client.image_to_image(
            buf.getvalue(),
            prompt=prompt,
            negative_prompt=negative_prompt,
            model=model,
            target_size=target_size,
        )
        params_dropped = True

    generation_time = round(time.time() - t0, 2)

    # Persist the full-quality result so it can be copied to the dataset
    # media directory later if the user saves this turn.
    ts = int(time.time())
    base = os.path.splitext(os.path.basename(input_filepath))[0]
    out_path = os.path.join(TEMP_DIR, f"{base}_{ts}.png")
    result_image.save(out_path)

    # Build a compact JPEG data URL for in-panel preview.  Capped at
    # 1024 px so the base64 payload fits comfortably in sessionStorage.
    display = result_image.copy()
    if max(display.width, display.height) > 1024:
        display.thumbnail((1024, 1024), Image.LANCZOS)
    disp_buf = io.BytesIO()
    display.save(disp_buf, format="JPEG", quality=85)
    image_data_url = (
        "data:image/jpeg;base64,"
        + base64.b64encode(disp_buf.getvalue()).decode()
    )

    return out_path, generation_time, image_data_url, params_dropped


def _copy_to_media_dir(src_filepath: str, original_filepath: str) -> str:
    """Copy an edited image into the same directory as the source sample.

    Placing the file alongside the original ensures it is reachable via the
    same media root that FiftyOne uses to serve the dataset, so the saved
    slice can be rendered without any additional configuration.

    Parameters
    ----------
    src_filepath:
        Path to the temporary edited image in ``TEMP_DIR``.
    original_filepath:
        Path to the source sample's media file — used only to derive the
        destination directory.

    Returns
    -------
    str
        Absolute path of the newly copied file.
    """
    dest_dir = os.path.dirname(original_filepath)
    dest_name = os.path.basename(src_filepath)
    dest_path = os.path.join(dest_dir, dest_name)
    shutil.copy2(src_filepath, dest_path)
    return dest_path


def _ensure_sample_in_group(dataset: fo.Dataset, sample: fo.Sample) -> str:
    """Ensure the dataset has a group field and that *sample* belongs to one.

    Handles three situations:

    1. **Flat dataset (no group field)** — adds a ``GROUP_FIELD`` group
       field, then bulk-assigns every existing sample to its own group
       (as the ``ORIGINAL_SLICE`` slice) via direct MongoDB writes.
       This is intentionally done at the database level to avoid loading
       every sample into Python memory for large datasets.

    2. **Grouped dataset, sample not yet in a group** — creates a new
       ``fo.Group`` and assigns the sample to it as ``ORIGINAL_SLICE``.

    3. **Grouped dataset, sample already in a group** — returns the
       existing group ID unchanged.

    Parameters
    ----------
    dataset:
        The active FiftyOne dataset.
    sample:
        The source sample that is about to receive an edited sibling.

    Returns
    -------
    str
        The group ID (as a hex string) that the sample belongs to.
    """
    gf = dataset.group_field

    if not gf:
        # ── Case 1: flat dataset ──────────────────────────────────────────
        dataset.add_group_field(GROUP_FIELD, default=ORIGINAL_SLICE)
        dataset.add_group_slice(ORIGINAL_SLICE, "image")
        # Re-read the field name after the schema change.
        gf = dataset.group_field

        db = get_db_conn()
        coll = db[dataset._sample_collection_name]

        target_group_id = None
        n = 0
        # Iterate only documents that are missing the group field so that
        # any samples already processed in a previous (interrupted) run are
        # not double-processed.
        for doc in coll.find({gf: {"$exists": False}}):
            g = fo.Group()
            coll.update_one(
                {"_id": doc["_id"]},
                {"$set": {gf: {
                    "_id": bson.ObjectId(g.id),
                    "_cls": "Group",
                    "name": ORIGINAL_SLICE,
                }}},
            )
            # Track the group ID for the sample we actually care about.
            if str(doc["_id"]) == sample.id:
                target_group_id = g.id
            n += 1

        # Reload so the Python-side schema and sample cache reflect the
        # MongoDB changes we just made directly.
        dataset.reload()
        print(f"[image_edit] converted {n} samples to grouped ('{ORIGINAL_SLICE}' slice)")

        if target_group_id is None:
            raise RuntimeError(
                f"Sample {sample.id} not found in collection "
                f"'{dataset._sample_collection_name}'"
            )
        return target_group_id

    elif sample[gf] is None:
        # ── Case 2: grouped dataset, sample lacks a group entry ──────────
        group = fo.Group()
        sample[gf] = group.element(ORIGINAL_SLICE)
        sample.save()
        return group.id

    else:
        # ── Case 3: sample is already in a group ─────────────────────────
        return sample[gf].id


def _find_slice_sample(
    dataset: fo.Dataset,
    gf: str,
    group_id: str,
    slice_name: str,
) -> "fo.Sample | None":
    """Return the sample for *slice_name* within *group_id*, or ``None``.

    Raises any FiftyOne / MongoDB exceptions so callers can handle them with
    context-appropriate logging.
    """
    return (
        dataset
        .select_group_slices(slice_name)
        .match(F(f"{gf}._id") == bson.ObjectId(group_id))
        .first()
    )


def _next_edit_slice_name(dataset: fo.Dataset, group_id: str) -> str:
    """Return the next unused ``edit_N`` slice name for the given group.

    Scans all slices in the group and increments N until a free name is
    found.  This guarantees uniqueness even when earlier edit slices have
    been deleted from the dataset.

    Parameters
    ----------
    dataset:
        The active FiftyOne dataset.
    group_id:
        Hex string group ID to inspect.

    Returns
    -------
    str
        A slice name of the form ``"edit_1"``, ``"edit_2"``, … .
    """
    gf = dataset.group_field
    existing_names = set(
        dataset
        .select_group_slices()
        .match(F(f"{gf}._id") == bson.ObjectId(group_id))
        .values(f"{gf}.name")
    )
    idx = 1
    while f"edit_{idx}" in existing_names:
        idx += 1
    return f"edit_{idx}"


# ---------------------------------------------------------------------------
# Schema helpers
# ---------------------------------------------------------------------------


# Explicit types for optional edit-metadata fields.  FiftyOne infers field
# types from values at write time; when a value is ``None`` no schema entry
# is created and the field won't appear in the app sidebar after
# ``reload_dataset()`` — only a full page refresh picks up the change.
# Pre-declaring these fields avoids that problem.
_OPTIONAL_EDIT_FIELDS: dict[str, type] = {
    "edit_negative_prompt": fo.StringField,
    "edit_num_inference_steps": fo.IntField,
    "edit_guidance_scale": fo.FloatField,
}


def _ensure_edit_fields(dataset: fo.Dataset) -> None:
    """Declare optional edit-metadata fields if not already in the schema."""
    schema = dataset.get_field_schema()
    for name, ftype in _OPTIONAL_EDIT_FIELDS.items():
        if name not in schema:
            dataset.add_sample_field(name, ftype)


# ---------------------------------------------------------------------------
# Panel
# ---------------------------------------------------------------------------


def _get_sample_label_fields(dataset: fo.Dataset, sample: fo.Sample) -> list[str]:
    """Return label field names that have a non-``None`` value on *sample*.

    Only ``EmbeddedDocumentField`` fields whose ``document_type`` is a
    subclass of ``fo.core.labels.Label`` are considered.  This covers
    built-in types such as ``Detections``, ``Classifications``,
    ``Segmentation``, ``Keypoints``, ``Polylines``, ``Heatmap``, and any
    custom label types registered on the dataset.  Fields with a ``None``
    value on *sample* are excluded so that, e.g., an ``edit_1`` slice that
    had only one label field copied from the original shows only that field
    in the "Copy labels to saved slice" UI.

    Parameters
    ----------
    dataset:
        The active FiftyOne dataset (used to retrieve the schema).
    sample:
        The specific sample to inspect.

    Returns
    -------
    list[str]
        Field names with non-``None`` values on *sample*, in schema order.
    """
    return [
        name
        for name, field in dataset.get_field_schema().items()
        if isinstance(field, fof.EmbeddedDocumentField)
        and issubclass(field.document_type, fo.core.labels.Label)
        and sample.get_field(name) is not None
    ]


class ImageEditPanel(foo.Panel):
    """Hybrid panel that provides chat-based image editing inside the modal.

    The panel exposes a React component (``ImageEditPanel``) via the
    ``render`` method.  Python drives the initial state through
    ``ctx.panel.set_state()`` in lifecycle hooks, and the React layer calls
    back into Python through ``run_edit`` and ``update_slice`` panel methods.
    """

    @property
    def config(self):
        return foo.PanelConfig(
            name="image_edit_panel",
            label="Image Edit",
            surfaces="modal",
            help_markdown=(
                "Chat-based image editing powered by HuggingFace models. "
                "Type a prompt to edit the current image, then save your "
                "favourite results as new group slices on the dataset."
            ),
        )

    # ── Lifecycle hooks ──────────────────────────────────────────────────────

    def on_load(self, ctx):
        """Initialise panel state when the modal is first opened."""
        ctx.panel.set_state("hf_token_missing", not bool(ctx.secrets.get("HF_TOKEN")))
        ctx.panel.set_state("models", MODELS)
        ctx.panel.set_state("default_model", DEFAULT_MODEL)
        self._sync_sample(ctx)

    def on_change_current_sample(self, ctx):
        """Refresh filepath / sample-ID state when the user navigates to a
        different sample in the modal."""
        self._sync_sample(ctx)

    def on_change_group_slice(self, ctx):
        """Refresh state when the active group slice changes.

        This hook fires for *all* group slice changes — both modal-internal
        tab clicks and external changes (e.g. the user selecting a different
        default slice in the sidebar).

        For modal-internal tab clicks the React layer also detects the change
        independently via the ``modalGroupSlice`` Recoil atom and calls
        ``update_slice`` directly.  Both paths resolve the same filepath and
        sample ID; the React path typically completes first (direct callback),
        while this hook provides the authoritative fallback via ``set_state``.
        """
        self._sync_sample(ctx)

    # ── Internal helpers ─────────────────────────────────────────────────────

    def _sync_sample(self, ctx):
        """Push the current sample's filepath, ID, and label field list to
        the React component via ``ctx.panel.set_state()``.

        For grouped datasets the method resolves the *active slice* — which
        may differ from the slice that ``ctx.current_sample`` belongs to —
        and returns that slice's filepath and sample ID instead.
        """
        if not ctx.current_sample:
            return

        dataset = ctx.dataset
        sample = dataset[ctx.current_sample]
        gf = dataset.group_field

        filepath = sample.filepath
        sample_id = ctx.current_sample
        resolved_sample = sample

        # When the dataset is grouped and there is an active slice that
        # differs from the slice ctx.current_sample belongs to, look up the
        # matching sample for the active slice within the same group.
        if gf and ctx.group_slice:
            group_elem = sample[gf]
            if group_elem and group_elem.name != ctx.group_slice:
                try:
                    slice_sample = _find_slice_sample(dataset, gf, group_elem.id, ctx.group_slice)
                    if slice_sample is not None:
                        filepath = slice_sample.filepath
                        sample_id = slice_sample.id
                        resolved_sample = slice_sample
                        print(f"[image_edit] slice lookup OK -> sample_id={sample_id!r}")
                    else:
                        print(f"[image_edit] slice lookup returned None for slice={ctx.group_slice!r}")
                except Exception as exc:
                    print(f"[image_edit] slice lookup error: {exc}")

        ctx.panel.set_state("original_filepath", filepath)
        ctx.panel.set_state("sample_id", sample_id)
        # Use sample-level fields so only populated label fields are shown
        # (e.g. edit_N slices that had only one label type copied show only
        # that field, not every field in the dataset schema).
        ctx.panel.set_state("label_fields", _get_sample_label_fields(dataset, resolved_sample))
        # Expose whether the dataset is grouped so the React layer can detect
        # a flat→grouped migration on the first save and prompt the user to
        # close and reopen the sample modal.
        ctx.panel.set_state("dataset_is_grouped", bool(dataset.group_field))

    # ── Panel methods (called from React via usePanelEvent) ──────────────────

    def delete_turn(self, ctx):
        """Delete a temporary edited image file from disk.

        Only files inside ``TEMP_DIR`` may be deleted.  Silently succeeds when
        the file no longer exists (already deleted or never written).

        Parameters (via ctx.params)
        ---------------------------
        filepath : str
            Absolute path to the temp file to remove.

        Returns
        -------
        dict
            ``{"deleted": True}`` on success, or ``{"error": "..."}`` on
            validation / deletion failure.
        """
        filepath = ctx.params.get("filepath", "")
        if not filepath:
            return {"error": "No filepath provided."}

        abs_path = os.path.realpath(filepath)
        abs_temp = os.path.realpath(TEMP_DIR)
        if not abs_path.startswith(abs_temp + os.sep):
            return {"error": "Only temp edit files can be deleted."}

        try:
            if os.path.exists(filepath):
                os.remove(filepath)
            return {"deleted": True}
        except Exception as exc:
            return {"error": str(exc)}

    def update_slice(self, ctx):
        """Resolve the filepath and sample-ID for a requested group slice.

        Called by the React layer when the ``modalGroupSlice`` Recoil atom
        changes (i.e. the user clicks a slice tab inside the modal).  The
        result is returned directly so the React callback can update local
        state — ``ctx.panel.set_state()`` is intentionally *not* used here
        because ``usePanelEvent`` synthesises a fake panel_id that would
        cause ``set_state`` to silently target a non-existent panel.

        Parameters (via ctx.params)
        ---------------------------
        slice : str
            The name of the slice the user switched to.

        Returns
        -------
        dict with keys ``original_filepath``, ``sample_id``, and
        ``label_fields``, or an empty dict if the slice cannot be resolved.
        """
        slice_name = ctx.params.get("slice", "")
        if not slice_name or not ctx.current_sample:
            return {}

        dataset = ctx.dataset
        sample = dataset[ctx.current_sample]
        gf = dataset.group_field

        if not gf:
            return {}

        group_elem = sample[gf]
        if not group_elem:
            return {}

        if group_elem.name == slice_name:
            # The current sample is already on the requested slice.
            return {
                "original_filepath": sample.filepath,
                "sample_id": ctx.current_sample,
                "label_fields": _get_sample_label_fields(dataset, sample),
            }

        try:
            slice_sample = _find_slice_sample(dataset, gf, group_elem.id, slice_name)
            if slice_sample is not None:
                return {
                    "original_filepath": slice_sample.filepath,
                    "sample_id": slice_sample.id,
                    "label_fields": _get_sample_label_fields(dataset, slice_sample),
                }
        except Exception as exc:
            print(f"[image_edit] update_slice error: {exc}")

        return {}

    def run_edit(self, ctx):
        """Execute an image edit via the HuggingFace Inference API.

        Reads edit parameters from ``ctx.params``, delegates to
        ``_run_edit()``, and returns the result dict to the React caller.

        Parameters (via ctx.params)
        ---------------------------
        prompt : str
            Edit instruction (required).
        model : str
            HuggingFace model repo ID.  Defaults to ``DEFAULT_MODEL``.
        input_filepath : str
            Absolute path to the source image.
        negative_prompt : str, optional
        num_inference_steps : int, optional
        guidance_scale : float, optional
        target_width / target_height : int, optional
            React always supplies these from the source image's natural
            dimensions (``sourceDimsRef``), so ``_run_edit``'s own
            fallback (also the natural dimensions) is effectively never
            reached from the UI — but it remains as a safety net.

        Returns
        -------
        dict
            On success: ``output_filepath``, ``generation_time``,
            ``image_data_url``, and optionally ``warning``.
            On failure: ``error`` with a human-readable message.
        """
        prompt = ctx.params.get("prompt", "").strip()
        model = ctx.params.get("model") or DEFAULT_MODEL
        input_filepath = ctx.params.get("input_filepath", "")
        negative_prompt = ctx.params.get("negative_prompt")
        num_inference_steps = ctx.params.get("num_inference_steps", None)
        guidance_scale = ctx.params.get("guidance_scale", None)

        target_width = ctx.params.get("target_width", None)
        target_height = ctx.params.get("target_height", None)
        target_size = None
        if target_width and target_height:
            target_size = {"width": int(target_width), "height": int(target_height)}

        hf_token = ctx.secrets.get("HF_TOKEN")
        if not hf_token:
            return {"error": "HF_TOKEN not set. Declare it in fiftyone.yml and export the env var."}
        if not prompt:
            return {"error": "Prompt cannot be empty."}
        if not input_filepath:
            return {"error": "No input filepath provided."}

        # Security: only allow files inside TEMP_DIR (chain edits of prior
        # turns) or registered sample filepaths in the current dataset.
        # For grouped datasets we must search across ALL slices, not just the
        # active/default one — edit_N slice filepaths won't appear in the
        # default-slice view and would be wrongly rejected otherwise.
        abs_input = os.path.realpath(input_filepath)
        abs_temp = os.path.realpath(TEMP_DIR)
        if not abs_input.startswith(abs_temp + os.sep):
            try:
                gf = ctx.dataset.group_field
                search_view = (
                    ctx.dataset.select_group_slices(ctx.dataset.group_slices)
                    if gf else ctx.dataset
                )
                search_view.one(F("filepath") == input_filepath)
            except Exception:
                return {"error": "Invalid input_filepath: not a registered sample or a temp edit."}

        try:
            output_filepath, generation_time, image_data_url, params_dropped = _run_edit(
                hf_token,
                model,
                input_filepath,
                prompt,
                negative_prompt=negative_prompt,
                num_inference_steps=int(num_inference_steps) if num_inference_steps is not None else None,
                guidance_scale=float(guidance_scale) if guidance_scale is not None else None,
                target_size=target_size,
            )
            result = {
                "output_filepath": output_filepath,
                "generation_time": generation_time,
                "image_data_url": image_data_url,
            }
            if params_dropped:
                result["warning"] = (
                    "This model does not support steps/guidance scale — "
                    "the edit ran with default sampling settings."
                )
            return result
        except TimeoutError:
            return {
                "error": (
                    "Request timed out after 9 minutes. The model may be cold-starting on "
                    "HuggingFace Inference API — try again in a moment, or switch to a "
                    "smaller/faster model (e.g. FLUX.2-klein-4B)."
                )
            }
        except Exception as exc:
            return {"error": str(exc)}

    def render(self, ctx):
        return types.Property(
            types.Object(),
            view=types.View(
                component="ImageEditPanel",
                composite_view=True,
                run_edit=self.run_edit,
                update_slice=self.update_slice,
                delete_turn=self.delete_turn,
            ),
        )


# ---------------------------------------------------------------------------
# Operator
# ---------------------------------------------------------------------------


class SaveEditedImages(foo.Operator):
    """Persist one or more edited turns as new ``edit_N`` group slices.

    This operator is unlisted (not shown in the operator browser) and is
    invoked programmatically from the React layer via
    ``useOperatorExecutor``.  Each saved turn is:

    * Copied from ``TEMP_DIR`` into the dataset's media directory.
    * Stored as a new ``fo.Sample`` in the same group as the source sample,
      on the next available ``edit_N`` slice.
    * Optionally populated with deep-copied label fields from the source
      sample (controlled by the ``selected_label_fields`` param).
    """

    @property
    def config(self):
        return foo.OperatorConfig(
            name="save_edited_images",
            label="Save Edited Images",
            unlisted=True,
        )

    def execute(self, ctx):
        """Persist the requested turns and reload the dataset in the UI.

        Parameters (via ctx.params)
        ---------------------------
        sample_id : str
            ID of the source sample the edits were made from.
        turns : list[dict]
            Each dict has ``filepath``, ``prompt``, ``model``,
            ``generation_time``, ``negative_prompt``,
            ``num_inference_steps``, and ``guidance_scale`` keys for one
            edited turn.  Advanced param values are ``None`` when the user
            left those fields blank.
        chat_history : list[dict]
            Full turn history stored as ``edit_history`` on each new sample.
        selected_label_fields : list[str], optional
            Names of label fields to deep-copy from the source sample onto
            each new edited sample.  Defaults to ``[]`` (no labels copied).
        """
        try:
            sample_id = ctx.params["sample_id"]
            turns = ctx.params["turns"]
            chat_history = ctx.params["chat_history"]
            # Empty list means the user did not select any fields to copy.
            selected_label_fields: list[str] = ctx.params.get("selected_label_fields", [])

            # Use the framework-provided dataset handle directly.
            # _ensure_sample_in_group calls dataset.reload() internally when
            # doing a flat→grouped migration, so ctx.dataset is always current.
            dataset = ctx.dataset

            original_sample = dataset[sample_id]
            original_filepath = original_sample.filepath

            group_id = _ensure_sample_in_group(dataset, original_sample)
            gf = dataset.group_field

            # Pre-declare optional fields so they appear in the sidebar
            # immediately after reload_dataset(), even when their values are
            # None (FiftyOne can't infer a type from None and skips the entry).
            _ensure_edit_fields(dataset)

            for turn in turns:
                saved_filepath = _copy_to_media_dir(turn["filepath"], original_filepath)
                slice_name = _next_edit_slice_name(dataset, group_id)

                edited_sample = fo.Sample(
                    filepath=saved_filepath,
                    **{gf: fo.Group(id=group_id).element(slice_name)},
                    parent_sample_id=sample_id,
                    edit_model=turn.get("model"),
                    edit_prompt=turn.get("prompt"),
                    edit_negative_prompt=turn.get("negative_prompt"),
                    edit_num_inference_steps=turn.get("num_inference_steps"),
                    edit_guidance_scale=turn.get("guidance_scale"),
                    edit_history=chat_history,
                    generation_time=turn.get("generation_time"),
                    tags=["edited"],
                )

                # Copy whichever label fields the user selected.
                # deepcopy ensures the new sample's label objects are fully
                # independent — a shallow copy would share nested document
                # references and could corrupt both samples on the next save.
                for field_name in selected_label_fields:
                    val = original_sample.get_field(field_name)
                    if val is not None:
                        edited_sample[field_name] = copy.deepcopy(val)

                dataset.add_sample(edited_sample)

                # Register the new slice name in the dataset schema if it has
                # not been seen before (FiftyOne requires explicit registration
                # for group slices to appear in the UI slice selector).
                if slice_name not in dataset.group_slices:
                    dataset.add_group_slice(slice_name, "image")

            print(f"[image_edit] saved {len(turns)} edit slice(s) to group {group_id}")

            # Refresh the FiftyOne app so the new slices appear immediately.
            ctx.ops.reload_dataset()

        except Exception as e:
            print(f"[save_edited_images] ERROR: {e}")
            print(traceback.format_exc())
            raise


# ---------------------------------------------------------------------------
# Registration
# ---------------------------------------------------------------------------


def register(p):
    p.register(ImageEditPanel)
    p.register(SaveEditedImages)
