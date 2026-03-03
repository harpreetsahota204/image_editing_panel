export interface Turn {
  filepath: string;
  imageUrl: string;
  /** Empty string for turn 0 (the original). */
  prompt: string;
  /** Empty string for turn 0. */
  model: string;
  timestamp: number;
  /** API response time in seconds. Undefined for turn 0 (original). */
  generation_time?: number;
  /** Null when no value was entered (turn 0 or field left blank). */
  negative_prompt?: string | null;
  num_inference_steps?: number | null;
  guidance_scale?: number | null;
}

export interface EditResult {
  output_filepath: string;
  /** API response time in seconds. */
  generation_time: number;
  /**
   * JPEG data URL of the edited image for immediate display.
   * Bypasses FiftyOne's /media server which only serves registered sample paths.
   */
  image_data_url: string;
  /**
   * Set when steps/guidance_scale were requested but rejected by the model.
   * The edit still completed using default sampling settings.
   */
  warning?: string;
}
