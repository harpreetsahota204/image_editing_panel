import React, { useCallback, useEffect, useRef, useState } from "react";
import { useRecoilValue } from "recoil";
import { modalGroupSlice as fosModalGroupSlice } from "@fiftyone/state";
import { useOperatorExecutor } from "@fiftyone/operators";
import { usePanelClient } from "./hooks/usePanelClient";
import { Turn } from "./types";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const PLUGIN_NAME = "@harpreetsahota/image_editing";

function makeMediaUrl(filepath: string): string {
  return `${window.location.origin}/media?filepath=${encodeURIComponent(filepath)}`;
}

// ---------------------------------------------------------------------------
// Styles — pure inline, zero emotion / MUI dependency
// ---------------------------------------------------------------------------

const S = {
  root: {
    display: "flex",
    flexDirection: "column" as const,
    height: "100%",
    overflow: "hidden",
    fontFamily: "var(--fo-fontFamily-body, sans-serif)",
    fontSize: 13,
    color: "#d0d0d0",
    boxSizing: "border-box" as const,
  },
  topBar: {
    display: "flex",
    gap: 8,
    padding: "8px 12px",
    borderBottom: "1px solid #3a3a3a",
    flexShrink: 0,
    flexWrap: "wrap" as const,
    alignItems: "center",
  },
  advancedToggle: {
    background: "none",
    border: "none",
    color: "#777",
    cursor: "pointer",
    fontSize: 11,
    padding: "2px 4px",
    flexShrink: 0,
    textDecoration: "underline",
    lineHeight: 1.4,
  },
  advancedPanel: {
    padding: "8px 12px",
    borderBottom: "1px solid #2a2a2a",
    background: "#111",
    display: "flex",
    flexDirection: "column" as const,
    gap: 6,
    flexShrink: 0,
  },
  advancedRow: {
    display: "flex",
    gap: 8,
    alignItems: "center",
    flexWrap: "wrap" as const,
  },
  advancedLabel: {
    fontSize: 11,
    color: "#777",
    flexShrink: 0,
    minWidth: 110,
  },
  advancedInput: {
    flex: 1,
    minWidth: 80,
    background: "#1a1a1a",
    color: "#d0d0d0",
    border: "1px solid #3a3a3a",
    borderRadius: 4,
    padding: "4px 8px",
    fontSize: 12,
    outline: "none",
  },
  select: {
    flex: 1,
    minWidth: 150,
    background: "#1a1a1a",
    color: "#d0d0d0",
    border: "1px solid #4a4a4a",
    borderRadius: 4,
    padding: "5px 8px",
    fontSize: 13,
    cursor: "pointer",
    outline: "none",
  },
  scroll: {
    flex: 1,
    overflowY: "auto" as const,
    padding: "10px 12px",
  },
  turnLabel: {
    fontSize: 12,
    color: "#888",
    fontStyle: "italic",
    marginBottom: 4,
    padding: "0 2px",
    display: "flex",
    justifyContent: "space-between" as const,
    alignItems: "center",
  },
  turnTime: {
    fontSize: 11,
    color: "#666",
    fontStyle: "normal",
  },
  imgWrap: {
    position: "relative" as const,
    marginBottom: 14,
    lineHeight: 0,
  },
  img: {
    width: "100%",
    display: "block",
    borderRadius: 4,
    objectFit: "contain" as const,
    maxHeight: 420,
  },
  badge: {
    position: "absolute" as const,
    bottom: 6,
    left: 6,
    background: "rgba(0,0,0,0.6)",
    color: "#fff",
    fontSize: 11,
    padding: "2px 6px",
    borderRadius: 3,
    lineHeight: 1.5,
  },
  imgActions: {
    position: "absolute" as const,
    bottom: 6,
    right: 6,
    display: "flex",
    gap: 4,
    alignItems: "center",
  },
  imgActionBtn: (muted: boolean): React.CSSProperties => ({
    background: "rgba(0,0,0,0.6)",
    border: "1px solid rgba(255,255,255,0.15)",
    borderRadius: 4,
    color: muted ? "#888" : "#d0d0d0",
    cursor: muted ? "not-allowed" : "pointer",
    padding: "4px 7px",
    fontSize: 14,
    lineHeight: 1,
    display: "flex",
    alignItems: "center",
    gap: 4,
  }),
  loading: {
    display: "flex",
    alignItems: "center",
    gap: 8,
    padding: "6px 0",
    color: "#888",
    fontSize: 13,
  },
  spinner: {
    width: 14,
    height: 14,
    border: "2px solid #444",
    borderTop: "2px solid #aaa",
    borderRadius: "50%",
    display: "inline-block",
    animation: "imageEditSpin 0.7s linear infinite",
  } as React.CSSProperties,
  errorBox: {
    padding: "8px 10px",
    background: "#6b2020",
    color: "#ffc0c0",
    borderRadius: 4,
    marginBottom: 8,
    fontSize: 12,
  },
  warnBox: {
    padding: "8px 10px",
    background: "#4a3a10",
    color: "#ffd580",
    borderRadius: 4,
    marginBottom: 8,
    fontSize: 12,
  },
  bottomBar: {
    padding: "8px 12px",
    borderTop: "1px solid #3a3a3a",
    flexShrink: 0,
  },
  inputRow: {
    display: "flex",
    gap: 6,
    alignItems: "center",
  },
  input: {
    flex: 1,
    background: "#1a1a1a",
    color: "#d0d0d0",
    border: "1px solid #4a4a4a",
    borderRadius: 4,
    padding: "6px 10px",
    fontSize: 13,
    outline: "none",
    minWidth: 0,
  },
  sendBtn: (enabled: boolean): React.CSSProperties => ({
    background: enabled ? "#444" : "#2a2a2a",
    color: enabled ? "#d0d0d0" : "#555",
    border: "1px solid #4a4a4a",
    borderRadius: 4,
    padding: "6px 10px",
    cursor: enabled ? "pointer" : "not-allowed",
    fontSize: 15,
    lineHeight: 1,
    flexShrink: 0,
  }),
  empty: {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    height: "100%",
    color: "#666",
    padding: 24,
    textAlign: "center" as const,
    fontSize: 13,
  },
  tokenWarning: {
    display: "flex",
    flexDirection: "column" as const,
    gap: 12,
    padding: "20px 24px",
    margin: 16,
    background: "#3d2020",
    border: "1px solid #7a3030",
    borderRadius: 6,
    fontSize: 13,
    lineHeight: 1.6,
    color: "#f5c6c6",
  },
  tokenWarningTitle: {
    fontWeight: 700,
    fontSize: 14,
    color: "#ff9999",
    marginBottom: 2,
  },
  tokenCode: {
    display: "block",
    background: "#1a1a1a",
    color: "#90cdf4",
    fontFamily: "monospace",
    fontSize: 12,
    padding: "6px 10px",
    borderRadius: 4,
    border: "1px solid #333",
    whiteSpace: "pre" as const,
  },
};

// ---------------------------------------------------------------------------
// Save icon SVG
// ---------------------------------------------------------------------------

const SaveIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
    <path d="M17 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V7l-4-4zm2 16H5V5h11.17L19 7.83V19zm-7-7c-1.66 0-3 1.34-3 3s1.34 3 3 3 3-1.34 3-3-1.34-3-3-3zM6 6h9v4H6z" />
  </svg>
);

const TrashIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
    <path d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z" />
  </svg>
);

const SourceIcon: React.FC = () => (
  <svg viewBox="0 0 24 24" width="13" height="13" fill="currentColor">
    <path d="M12 2C6.48 2 2 6.48 2 12s4.48 10 10 10 10-4.48 10-10S17.52 2 12 2zm0 18c-4.42 0-8-3.58-8-8s3.58-8 8-8 8 3.58 8 8-3.58 8-8 8zm0-12.5c-2.49 0-4.5 2.01-4.5 4.5S9.51 16.5 12 16.5s4.5-2.01 4.5-4.5S14.49 7.5 12 7.5zm0 7c-1.38 0-2.5-1.12-2.5-2.5S10.62 9.5 12 9.5s2.5 1.12 2.5 2.5S13.38 14.5 12 14.5z" />
  </svg>
);

// ---------------------------------------------------------------------------
// Spin keyframe — injected once on first render
// ---------------------------------------------------------------------------

let spinInjected = false;
function ensureSpinKeyframe() {
  if (spinInjected) return;
  spinInjected = true;
  const el = document.createElement("style");
  el.textContent = "@keyframes imageEditSpin { to { transform: rotate(360deg); } }";
  document.head.appendChild(el);
}

// ---------------------------------------------------------------------------
// Session persistence via sessionStorage
// ---------------------------------------------------------------------------

interface CachedSession {
  turns: Turn[];
  sourceTurnIdx: number;
  selectedModel: string;
}

const CACHE_PREFIX = "imageEdit:";

/**
 * Load a cached session and verify it starts from the same original filepath.
 * All edited-turn imageUrls are base64 data URLs (self-contained), so no
 * network probe is required to check their validity.
 */
function loadSessionValidated(sampleId: string, currentFilepath: string): CachedSession | null {
  try {
    const raw = sessionStorage.getItem(CACHE_PREFIX + sampleId);
    if (!raw) return null;
    const session = JSON.parse(raw) as CachedSession;
    // Session must start from the same original filepath.
    if (!session.turns.length || session.turns[0].filepath !== currentFilepath) return null;
    return session;
  } catch {
    return null;
  }
}

function saveSession(sampleId: string, session: CachedSession): void {
  try {
    sessionStorage.setItem(CACHE_PREFIX + sampleId, JSON.stringify(session));
  } catch {
    // sessionStorage full or unavailable — silently skip
  }
}

// ---------------------------------------------------------------------------
// Props
// ---------------------------------------------------------------------------

interface PanelData {
  original_filepath?: string;
  sample_id?: string;
  hf_token_missing?: boolean;
  label_fields?: string[];
  models?: string[];
  default_model?: string;
  dataset_is_grouped?: boolean;
}

interface ImageEditPanelProps {
  data?: PanelData;
  schema?: { view?: { run_edit?: string; update_slice?: string; delete_turn?: string } };
}

// ---------------------------------------------------------------------------
// Component
// ---------------------------------------------------------------------------

const ImageEditPanel: React.FC<ImageEditPanelProps> = ({ data, schema }) => {
  const runEditUri     = schema?.view?.run_edit     ?? "";
  const updateSliceUri = schema?.view?.update_slice ?? "";
  const deleteTurnUri  = schema?.view?.delete_turn  ?? "";

  const activeModalSlice = useRecoilValue<string | null>(fosModalGroupSlice);

  // Local active sample state — updated by Python lifecycle props or by the
  // update_slice callback when a modal slice tab is clicked.
  const [activeFilepath, setActiveFilepath] = useState<string>("");
  const [activeSampleId, setActiveSampleId] = useState<string>("");

  // Turn history
  const [turns, setTurns] = useState<Turn[]>([]);
  const [selectedModel, setSelectedModel] = useState<string>("");
  const [sourceTurnIdx, setSourceTurnIdx] = useState<number>(0);
  const [prompt, setPrompt] = useState<string>("");
  const [isLoading, setIsLoading] = useState<boolean>(false);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [warnMsg, setWarnMsg] = useState<string | null>(null);

  // Advanced parameters — label field preferences persist across samples
  const [showAdvanced, setShowAdvanced] = useState<boolean>(false);
  const [negativePrompt, setNegativePrompt] = useState<string>("");
  const [numSteps, setNumSteps] = useState<string>("");
  const [guidanceScale, setGuidanceScale] = useState<string>("");
  // All label fields on the current sample (updated from Python)
  const [availableLabelFields, setAvailableLabelFields] = useState<string[]>([]);
  // Which fields the user has selected to copy (persists across samples)
  const [selectedLabelFields, setSelectedLabelFields] = useState<Set<string>>(new Set());
  // Natural dimensions of the source image — passed automatically as target_size
  const sourceDimsRef = useRef<{ w: number; h: number } | null>(null);
  // Holds the committed model value while the model input is temporarily
  // cleared on focus (so the datalist shows all options, not just the match).
  const pendingModelRef = useRef<string>("");

  // Live elapsed-time counter shown while a generation is in progress
  const [elapsedSec, setElapsedSec] = useState<number>(0);
  const editStartRef = useRef<number | null>(null);

  // Per-turn saving / deleting / saved state
  const [savingTurns, setSavingTurns] = useState<Set<number>>(new Set());
  const [savedTurns, setSavedTurns] = useState<Set<number>>(new Set());
  const [deletingTurns, setDeletingTurns] = useState<Set<number>>(new Set());
  const [saveErrorMsg, setSaveErrorMsg] = useState<string | null>(null);

  const { runEdit, updateSlice, deleteTurn } = usePanelClient(runEditUri, updateSliceUri, deleteTurnUri);
  const saveExecutor = useOperatorExecutor(`${PLUGIN_NAME}/save_edited_images`);
  const scrollRef = useRef<HTMLDivElement>(null);

  // ── Sync from Python lifecycle props ───────────────────────────────────────
  const prevDataSampleIdRef = useRef<string>("");
  useEffect(() => {
    const newId = data?.sample_id ?? "";
    const newPath = data?.original_filepath ?? "";
    if (!newId || !newPath) return;
    if (newId === prevDataSampleIdRef.current) return;
    prevDataSampleIdRef.current = newId;
    setActiveSampleId(newId);
    setActiveFilepath(newPath);
    const labelFields = data?.label_fields;
    if (Array.isArray(labelFields)) {
      setAvailableLabelFields(labelFields);
    }
    prevSliceRef.current = null;
  }, [data?.sample_id, data?.original_filepath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Slice tab detection ────────────────────────────────────────────────────
  // This effect handles modal-internal slice tab clicks via the Recoil atom.
  // Python's on_change_group_slice hook fires for the same events and updates
  // data.sample_id via set_state — both paths converge on the same values.
  // The Recoil path resolves faster (direct callback); the Python path is the
  // authoritative fallback for external slice changes (e.g. sidebar changes).
  const prevSliceRef = useRef<string | null>(null);
  useEffect(() => {
    if (!activeModalSlice || !data?.sample_id) return;
    if (activeModalSlice === prevSliceRef.current) return;
    prevSliceRef.current = activeModalSlice;
    updateSlice({ slice: activeModalSlice }).then((r) => {
      if (r?.original_filepath && r?.sample_id) {
        setActiveFilepath(r.original_filepath);
        setActiveSampleId(r.sample_id);
      }
      if (Array.isArray(r?.label_fields)) {
        setAvailableLabelFields(r.label_fields);
      }
    }).catch(() => {/* slice lookup errors are non-fatal */});
  }, [activeModalSlice, data?.sample_id]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session restore when active sample/filepath changes ────────────────────
  const prevSettledIdRef = useRef<string>("");
  const prevSettledPathRef = useRef<string>("");

  useEffect(() => { ensureSpinKeyframe(); }, []);

  // Start / stop the live elapsed-time counter whenever isLoading changes.
  useEffect(() => {
    if (isLoading) {
      editStartRef.current = Date.now();
      setElapsedSec(0);
      const id = setInterval(() => {
        setElapsedSec(Math.floor((Date.now() - editStartRef.current!) / 100) / 10);
      }, 100);
      return () => clearInterval(id);
    } else {
      editStartRef.current = null;
    }
  }, [isLoading]);

  useEffect(() => {
    if (!activeSampleId || !activeFilepath) return;
    if (
      activeSampleId === prevSettledIdRef.current &&
      activeFilepath === prevSettledPathRef.current
    ) return;

    prevSettledIdRef.current = activeSampleId;
    prevSettledPathRef.current = activeFilepath;

    const freshTurn = (): Turn => ({
      filepath: activeFilepath,
      imageUrl: makeMediaUrl(activeFilepath),
      prompt: "",
      model: "",
      timestamp: 0,
    });

    const resetToFresh = () => {
      const t = freshTurn();
      setTurns([t]);
      setSourceTurnIdx(0);
      setSelectedModel("");
      saveSession(activeSampleId, { turns: [t], sourceTurnIdx: 0, selectedModel: "" });
    };

    setPrompt("");
    setNegativePrompt("");
    setNumSteps("");
    setGuidanceScale("");
    setErrorMsg(null);
    setWarnMsg(null);
    setSaveErrorMsg(null);
    setSavingTurns(new Set());
    setSavedTurns(new Set());
    setDeletingTurns(new Set());
    sourceDimsRef.current = null;

    const existing = loadSessionValidated(activeSampleId, activeFilepath);
    if (existing) {
      setTurns(existing.turns);
      setSourceTurnIdx(existing.sourceTurnIdx ?? 0);
      setSelectedModel(existing.selectedModel);
    } else {
      resetToFresh();
    }
  }, [activeSampleId, activeFilepath]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Session sync ────────────────────────────────────────────────────────────
  useEffect(() => {
    if (!activeSampleId || !activeFilepath || turns.length === 0) return;
    if (turns[0].filepath !== activeFilepath) return;
    saveSession(activeSampleId, { turns, sourceTurnIdx, selectedModel });
  }, [turns, sourceTurnIdx, selectedModel, activeSampleId, activeFilepath]);

  // ── sourceTurnIdx safety net — clamp to valid range after a deletion ────────
  useEffect(() => {
    if (turns.length && sourceTurnIdx >= turns.length) {
      setSourceTurnIdx(turns.length - 1);
    }
  }, [turns]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Scroll to bottom on new turns ───────────────────────────────────────────
  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [turns.length, isLoading]);

  // ── Edit handler ────────────────────────────────────────────────────────────
  const handleEdit = useCallback(async () => {
    if (!prompt.trim() || isLoading || !activeFilepath) return;
    const sourceFilepath = turns[sourceTurnIdx]?.filepath ?? activeFilepath;
    setIsLoading(true);
    setErrorMsg(null);
    setWarnMsg(null);
    try {
      // Fall back to the Python default model if the user left the field empty.
      const effectiveModel = selectedModel.trim() || data?.default_model || "";
      const params: Parameters<typeof runEdit>[0] = {
        prompt: prompt.trim(),
        model: effectiveModel,
        input_filepath: sourceFilepath,
      };
      if (negativePrompt.trim()) params.negative_prompt = negativePrompt.trim();
      if (numSteps !== "") params.num_inference_steps = Number(numSteps);
      if (guidanceScale !== "") params.guidance_scale = Number(guidanceScale);
      // Always pass the source image's natural dimensions so the output
      // matches the input size.  Falls back to nothing if the image hasn't
      // loaded yet (Python will use the file's own dimensions in that case).
      const dims = sourceDimsRef.current;
      if (dims) {
        params.target_width = dims.w;
        params.target_height = dims.h;
      }

      const result = await runEdit(params);
      if (result.warning) setWarnMsg(result.warning);
      setTurns((prev) => {
        const next = [
          ...prev,
          {
            filepath: result.output_filepath,
            // Use the data URL returned by Python — FiftyOne's /media server
            // only serves registered sample filepaths, so temp edit files
            // return 404 if served that way.
            imageUrl: result.image_data_url,
            prompt: prompt.trim(),
            model: effectiveModel,
            timestamp: Date.now(),
            generation_time: result.generation_time,
            negative_prompt: negativePrompt.trim() || null,
            num_inference_steps: numSteps !== "" ? Number(numSteps) : null,
            guidance_scale: guidanceScale !== "" ? Number(guidanceScale) : null,
          },
        ];
        setSourceTurnIdx(next.length - 1);
        return next;
      });
      setPrompt("");
    } catch (e: any) {
      setErrorMsg(e.message ?? "Edit failed");
    } finally {
      setIsLoading(false);
    }
  }, [prompt, isLoading, activeFilepath, turns, sourceTurnIdx, selectedModel, negativePrompt, numSteps, guidanceScale, runEdit]);

  // ── Per-turn save ───────────────────────────────────────────────────────────
  const handleSaveTurn = useCallback((turnIdx: number) => {
    if (!activeSampleId || savingTurns.has(turnIdx)) return;
    const turn = turns[turnIdx];
    if (!turn) return;
    // Capture pre-save grouping state. data?.dataset_is_grouped is set by
    // Python's _sync_sample and reflects whether the dataset was already
    // grouped before this save. If it's explicitly false the dataset is flat
    // and this save will trigger a flat→grouped migration.
    const wasFlat = data?.dataset_is_grouped === false;
    setSavingTurns((prev) => new Set(prev).add(turnIdx));
    setSaveErrorMsg(null);
    saveExecutor
      .execute({
        sample_id: activeSampleId,
        selected_label_fields: Array.from(selectedLabelFields),
        turns: [{
          filepath: turn.filepath,
          prompt: turn.prompt,
          model: turn.model,
          generation_time: turn.generation_time,
          negative_prompt: turn.negative_prompt ?? null,
          num_inference_steps: turn.num_inference_steps ?? null,
          guidance_scale: turn.guidance_scale ?? null,
        }],
        chat_history: turns.map((t) => ({
          filepath: t.filepath,
          image_url: t.imageUrl,
          prompt: t.prompt,
          model: t.model,
        })),
      })
      .then(() => {
        setSavingTurns((prev) => { const n = new Set(prev); n.delete(turnIdx); return n; });
        setSavedTurns((prev) => new Set(prev).add(turnIdx));
        if (wasFlat) {
          setWarnMsg(
            "Dataset converted to grouped format. " +
            "Close and reopen the sample modal for the display to refresh correctly."
          );
        }
      })
      .catch((e: any) => {
        setSaveErrorMsg(e?.message ?? "Save failed — check server logs.");
        setSavingTurns((prev) => { const n = new Set(prev); n.delete(turnIdx); return n; });
      });
  }, [activeSampleId, savingTurns, turns, saveExecutor, selectedLabelFields, data?.dataset_is_grouped]);

  // ── Per-turn delete ─────────────────────────────────────────────────────────
  const handleDeleteTurn = useCallback((turnIdx: number) => {
    if (deletingTurns.has(turnIdx) || isLoading) return;
    const turn = turns[turnIdx];
    if (!turn || turnIdx === 0) return;
    setDeletingTurns((prev) => new Set(prev).add(turnIdx));
    deleteTurn({ filepath: turn.filepath })
      .then(() => {
        setDeletingTurns((prev) => { const n = new Set(prev); n.delete(turnIdx); return n; });
        setTurns((prev) => {
          const next = prev.filter((_, i) => i !== turnIdx);
          setSourceTurnIdx((idx) => (idx >= next.length ? next.length - 1 : idx));
          return next;
        });
      })
      .catch((e: any) => {
        setDeletingTurns((prev) => { const n = new Set(prev); n.delete(turnIdx); return n; });
        setSaveErrorMsg(`Delete failed: ${e?.message ?? e}`);
      });
  }, [deletingTurns, isLoading, turns, deleteTurn]);

  // ── Source image load — pre-fill target_size with natural dimensions ────────
  const handleSourceImgLoad = useCallback((e: React.SyntheticEvent<HTMLImageElement>) => {
    const img = e.currentTarget;
    sourceDimsRef.current = { w: img.naturalWidth, h: img.naturalHeight };
  }, []);

  // ── Early returns ───────────────────────────────────────────────────────────
  if (data?.hf_token_missing) {
    return (
      <div style={S.tokenWarning}>
        <div style={S.tokenWarningTitle}>⚠ HF_TOKEN is not set</div>
        <div>
          This panel requires a Hugging Face API token. Set{" "}
          <code style={{ color: "#90cdf4" }}>HF_TOKEN</code> before launching
          the app, then relaunch.
        </div>
        <div style={{ color: "#ccc", fontSize: 12, marginBottom: 2 }}>Python</div>
        <code style={S.tokenCode}>
          {`import os\nos.environ["HF_TOKEN"] = "hf_..."\n\nimport fiftyone as fo\nfo.launch_app(dataset)`}
        </code>
        <div style={{ color: "#ccc", fontSize: 12, marginBottom: 2 }}>Shell / CLI</div>
        <code style={S.tokenCode}>
          {`export HF_TOKEN="hf_..."\nfiftyone app launch`}
        </code>
        <div style={{ color: "#888", fontSize: 12 }}>
          Get a token at{" "}
          <a href="https://huggingface.co/settings/tokens" target="_blank" rel="noreferrer" style={{ color: "#90cdf4" }}>
            huggingface.co/settings/tokens
          </a>
        </div>
      </div>
    );
  }

  if (!activeFilepath) {
    return <div style={S.empty}>Open a sample to begin editing.</div>;
  }

  const canSend = !!prompt.trim() && !isLoading;
  const isSaving = saveExecutor.isLoading;

  return (
    <div style={S.root}>

      {/* ── Model + Edit-from selectors ── */}
      <div style={S.topBar}>
        <label style={{ fontSize: 12, color: "#888", flexShrink: 0 }}>Model</label>
        <input
          list="hf-model-list"
          style={S.select}
          value={selectedModel}
          onChange={(e) => setSelectedModel(e.target.value)}
          placeholder="Select model or type model name"
          autoComplete="off"
          spellCheck={false}
          onFocus={() => {
            pendingModelRef.current = selectedModel;
            setSelectedModel("");
          }}
          onClick={() => {
            // onFocus only fires on the first click; subsequent clicks on the
            // arrow (already focused) need to re-clear so all models show.
            if (selectedModel) pendingModelRef.current = selectedModel;
            setSelectedModel("");
          }}
          onBlur={(e) => {
            if (!e.target.value.trim()) setSelectedModel(pendingModelRef.current);
          }}
        />
        <datalist id="hf-model-list">
          {(data?.models ?? []).map((m) => (
            <option key={m} value={m} />
          ))}
        </datalist>
        <a
          href="https://huggingface.co/models?inference=warm&pipeline_tag=image-to-image"
          target="_blank"
          rel="noreferrer"
          style={{ fontSize: 11, color: "#90cdf4", flexShrink: 0, whiteSpace: "nowrap" as const }}
          title="Browse warm image-to-image models on Hugging Face"
        >
          Browse models ↗
        </a>

        <button
          style={S.advancedToggle}
          onClick={() => setShowAdvanced((v) => !v)}
        >
          {showAdvanced ? "▲ Advanced" : "▼ Advanced"}
        </button>
      </div>

      {/* ── Advanced settings ── */}
      {showAdvanced && (
        <div style={S.advancedPanel}>
          <div style={S.advancedRow}>
            <span style={S.advancedLabel}>Negative prompt</span>
            <input
              style={S.advancedInput}
              type="text"
              value={negativePrompt}
              onChange={(e) => setNegativePrompt(e.target.value)}
              placeholder="e.g. blurry, low quality"
            />
          </div>
          <div style={{
            padding: "6px 9px",
            borderRadius: 5,
            background: "rgba(245,166,35,0.08)",
            border: "1px solid rgba(245,166,35,0.25)",
            fontSize: 11,
            lineHeight: 1.5,
            color: "#c8a96e",
          }}>
            ⚠ Not all models support <strong>Steps</strong> or <strong>Guidance scale</strong>. Check the model&apos;s documentation before use.
          </div>
          <div style={S.advancedRow}>
            <span style={S.advancedLabel}>Steps</span>
            <input
              style={S.advancedInput}
              type="number"
              min={1}
              max={150}
              value={numSteps}
              onChange={(e) => setNumSteps(e.target.value)}
              placeholder="default"
            />
          </div>
          <div style={S.advancedRow}>
            <span style={S.advancedLabel}>Guidance scale</span>
            <input
              style={S.advancedInput}
              type="number"
              min={0}
              step={0.1}
              value={guidanceScale}
              onChange={(e) => setGuidanceScale(e.target.value)}
              placeholder="default"
            />
          </div>
          {availableLabelFields.length > 0 && (
            <div style={{ marginTop: 6 }}>
              <div style={{ ...S.advancedRow, justifyContent: "space-between", marginBottom: 4 }}>
                <span style={{ ...S.advancedLabel, color: "#bbb", fontWeight: 600 }}>
                  Copy labels to saved slice
                </span>
                <div style={{ display: "flex", gap: 8 }}>
                  <button
                    style={{ ...S.advancedToggle, fontSize: 10 }}
                    onClick={() => setSelectedLabelFields(new Set(availableLabelFields))}
                  >all</button>
                  <button
                    style={{ ...S.advancedToggle, fontSize: 10 }}
                    onClick={() => setSelectedLabelFields(new Set())}
                  >none</button>
                </div>
              </div>
              {availableLabelFields.map((field) => (
                <div key={field} style={{ ...S.advancedRow, paddingLeft: 4, paddingTop: 2, paddingBottom: 2 }}>
                  <label style={{ display: "flex", alignItems: "center", gap: 7, cursor: "pointer", userSelect: "none" as const, width: "100%" }}>
                    <input
                      type="checkbox"
                      checked={selectedLabelFields.has(field)}
                      onChange={(e) => {
                        setSelectedLabelFields((prev) => {
                          const next = new Set(prev);
                          e.target.checked ? next.add(field) : next.delete(field);
                          return next;
                        });
                      }}
                      style={{ width: 13, height: 13, cursor: "pointer", accentColor: "#f5a623", flexShrink: 0 }}
                    />
                    <span style={{ ...S.advancedLabel, minWidth: 0, color: "#ccc", fontFamily: "monospace", fontSize: 11 }}>
                      {field}
                    </span>
                  </label>
                </div>
              ))}
            </div>
          )}
          <div style={{ ...S.advancedRow, justifyContent: "flex-end", marginTop: 6 }}>
            <button
              style={{ ...S.advancedToggle, fontSize: 11 }}
              onClick={() => {
                setNegativePrompt("");
                setNumSteps("");
                setGuidanceScale("");
                setSelectedLabelFields(new Set());
              }}
            >
              ↺ clear all
            </button>
          </div>
        </div>
      )}

      {/* ── Scrollable turn history ── */}
      <div ref={scrollRef} style={S.scroll}>
        {turns.map((turn, i) => {
          const isSource = i === sourceTurnIdx;
          return (
            <div key={`${activeSampleId}-${i}`}>
              {i > 0 && (
                <div style={S.turnLabel}>
                  <span>Turn {i}: &ldquo;{turn.prompt}&rdquo;</span>
                  {turn.generation_time != null && (
                    <span style={S.turnTime}>{turn.generation_time}s</span>
                  )}
                </div>
              )}
              <div style={{
                ...S.imgWrap,
                outline: isSource && turns.length > 1 ? "2px solid #f5a623" : "none",
                borderRadius: 4,
              }}>
                <img
                  src={turn.imageUrl}
                  alt={i === 0 ? "Original" : `Edit turn ${i}`}
                  style={S.img}
                  onLoad={isSource ? handleSourceImgLoad : undefined}
                />
                {i === 0 && <span style={S.badge}>Original</span>}
                {(turns.length > 1 || i > 0) && (
                  <div style={S.imgActions}>
                    {/* Set as edit source — shown on all turns when branching is possible */}
                    {turns.length > 1 && (
                      <button
                        style={{
                          ...S.imgActionBtn(false),
                          outline: isSource ? "1px solid #f5a623" : "none",
                        }}
                        onClick={() => setSourceTurnIdx(i)}
                        title="Use as source for next edit"
                      >
                        <SourceIcon />
                      </button>
                    )}
                    {/* Trash + Save — only for edited turns */}
                    {i > 0 && (
                      <>
                        <button
                          style={S.imgActionBtn(deletingTurns.has(i) || isSaving || isLoading)}
                          onClick={() => handleDeleteTurn(i)}
                          disabled={deletingTurns.has(i) || isSaving || isLoading}
                          title="Delete this edit"
                        >
                          <TrashIcon />
                        </button>
                        <button
                          style={S.imgActionBtn(savingTurns.has(i) || savedTurns.has(i) || isSaving)}
                          onClick={() => handleSaveTurn(i)}
                          disabled={savingTurns.has(i) || savedTurns.has(i) || isSaving}
                          title={savedTurns.has(i) ? "Already saved as a group slice" : "Save as group slice"}
                        >
                          <SaveIcon />
                          <span style={{ fontSize: 11 }}>
                            {savingTurns.has(i) ? "Saving…" : savedTurns.has(i) ? "Saved ✓" : "Save"}
                          </span>
                        </button>
                      </>
                    )}
                  </div>
                )}
              </div>
            </div>
          );
        })}

        {isLoading && (
          <div style={S.loading}>
            <span style={S.spinner} />
            Editing image…
            <span style={{ marginLeft: 8, fontVariantNumeric: "tabular-nums", opacity: 0.75 }}>
              {elapsedSec.toFixed(1)}s
            </span>
          </div>
        )}

        {warnMsg && <div style={S.warnBox}>⚠ {warnMsg}</div>}
        {errorMsg && <div style={S.errorBox}>{errorMsg}</div>}
        {saveErrorMsg && <div style={S.errorBox}>{saveErrorMsg}</div>}
      </div>

      {/* ── Prompt input ── */}
      <div style={S.bottomBar}>
        <div style={S.inputRow}>
          <input
            type="text"
            style={S.input}
            value={prompt}
            onChange={(e) => setPrompt(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                handleEdit();
              }
            }}
            placeholder="Describe an edit… (Enter to send)"
            disabled={isLoading}
          />
          <button
            style={S.sendBtn(canSend)}
            onClick={handleEdit}
            disabled={!canSend}
            title="Edit image"
          >
            ✦
          </button>
        </div>
      </div>
    </div>
  );
};

export default ImageEditPanel;
