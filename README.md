# Image Edit Panel

A [FiftyOne](https://docs.voxel51.com) plugin that brings chat-based image editing directly into the sample modal. Write a prompt, see the result inline, iterate, and save your favourite edits back to your dataset — all without leaving the app.

---

## What it does

Open any sample in the FiftyOne modal and the **Image Edit** panel appears alongside it. From there you can:

- **Prompt-driven edits** — describe the change you want in plain text and the panel calls a HuggingFace image-to-image model to apply it.
- **Iterative refinement** — each edit becomes a new turn in the panel's history. You can branch off any previous turn to explore different directions from the same starting point.
- **Advanced controls** — optionally supply a negative prompt, override inference steps, and set a guidance scale for models that support them.
- **Save to dataset** — click the save icon on any edited turn to persist it as a new group slice (`edit_1`, `edit_2`, …) on your dataset. If the dataset is flat it is automatically converted to a grouped dataset on first save.
- **Label copying** — when saving, optionally copy any label fields (detections, classifications, segmentations, etc.) from the source sample to the new edited slice.
- **Session memory** — your edit history for each sample is preserved in the browser session, so switching between samples and coming back doesn't lose your work.

### Supported models

The panel ships with a curated list of warm HuggingFace image-to-image models and a **Browse models ↗** link to discover more. You can type any HuggingFace model repo ID directly into the model field.

---

## Requirements

| Requirement | Detail |
|-------------|--------|
| FiftyOne | `>= 0.22` |
| HuggingFace API token | A `HF_TOKEN` with inference access — get one at [huggingface.co/settings/tokens](https://huggingface.co/settings/tokens) |

---

## Installation

```bash
fiftyone plugins download https://github.com/harpreetsahota204/image_editing_panel --overwrite
```

Then set your HuggingFace token before launching the app:

```python
import os
os.environ["HF_TOKEN"] = "hf_..."

import fiftyone as fo
fo.launch_app(dataset)
```

Or via the shell:

```bash
export HF_TOKEN="hf_..."
fiftyone app launch
```

> The plugin reads `HF_TOKEN` from the environment at startup. If it is missing the panel will display a setup prompt with these same instructions.

---

## Usage

1. Open a dataset in the FiftyOne app and click into any sample.
2. Open the **Image Edit** panel from the modal panel selector.
3. Select a model (or type a HuggingFace repo ID).
4. Type a prompt describing your edit and press **Enter** or click **✦**.
5. When you're happy with a result, click the **Save** button on that turn to write it to your dataset as a new group slice.
