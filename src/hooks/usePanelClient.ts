import { useCallback } from "react";
import { usePanelEvent } from "@fiftyone/operators";
import { EditResult } from "../types";

interface EditParams {
  prompt: string;
  model: string;
  input_filepath: string;
  negative_prompt?: string;
  num_inference_steps?: number;
  guidance_scale?: number;
  target_width?: number;
  target_height?: number;
}

interface UpdateSliceResult {
  original_filepath: string;
  sample_id: string;
  label_fields: string[];
}

/**
 * Bridge to the Python ``ImageEditPanel`` panel methods:
 *   - ``run_edit``    – call the HuggingFace Inference API
 *   - ``update_slice`` – resolve filepath / sample-ID for a group slice
 *   - ``delete_turn``  – remove a temp edit file from disk
 */
export function usePanelClient(
  runEditUri: string,
  updateSliceUri: string,
  deleteTurnUri: string,
) {
  const handleEvent = usePanelEvent();

  const runEdit = useCallback(
    (params: EditParams): Promise<EditResult> =>
      new Promise((resolve, reject) => {
        handleEvent("run_edit", {
          operator: runEditUri,
          params,
          callback: (result: any) => {
            // Two error sources checked with the same pattern used elsewhere:
            // result.error        — FiftyOne framework error (network, auth, …)
            // result.result.error — Python method returned {"error": "…"}
            const err = result?.error ?? result?.result?.error;
            if (err) {
              reject(new Error(err));
            } else {
              resolve(result?.result as EditResult);
            }
          },
        });
      }),
    [handleEvent, runEditUri]
  );

  const updateSlice = useCallback(
    (params: { slice: string }): Promise<UpdateSliceResult | null> =>
      new Promise((resolve, reject) => {
        handleEvent("update_slice", {
          operator: updateSliceUri,
          params,
          callback: (result: any) => {
            const err = result?.error ?? result?.result?.error;
            if (err) {
              reject(new Error(err));
            } else {
              resolve((result?.result as UpdateSliceResult) ?? null);
            }
          },
        });
      }),
    [handleEvent, updateSliceUri]
  );

  const deleteTurn = useCallback(
    (params: { filepath: string }): Promise<void> =>
      new Promise((resolve, reject) => {
        handleEvent("delete_turn", {
          operator: deleteTurnUri,
          params,
          callback: (result: any) => {
            const err = result?.error ?? result?.result?.error;
            err ? reject(new Error(err)) : resolve();
          },
        });
      }),
    [handleEvent, deleteTurnUri]
  );

  return { runEdit, updateSlice, deleteTurn };
}
