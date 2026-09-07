/** Read-only access to lifecycle ownership retained by useAgentSession. */
export interface SessionFeatureContext {
  sessionId: string | null;
  loadGeneration: number;
  runtimeGeneration: number;
  alive: boolean;
  runtimeReady: boolean;
}

export interface AttachedImage {
  /** Base64 bytes without a data URL prefix. */
  data: string;
  mimeType: string;
  /** Object URL used only for composer display. */
  previewUrl: string;
}
