export interface SessionSearchArgs {
  query: string;
  projectRoot?: string;
  from?: string;
  to?: string;
  limit?: number;
  cursor?: string;
}

export type SessionSearchRole = "user" | "assistant" | "toolResult";

export interface SessionSearchMessage {
  entryId: string;
  timestamp: string;
  role: SessionSearchRole;
  content: string;
}

export interface SessionSearchMatch {
  sessionId: string;
  sessionName: string;
  cwd: string;
  entryId: string;
  timestamp: string;
  role: SessionSearchRole;
  snippet: string;
}

export interface SessionSearchResult {
  matches: SessionSearchMatch[];
  nextCursor?: string;
}

export interface SessionSearchContext {
  sessionId: string;
  sessionName: string;
  cwd: string;
  entryId: string;
  leafId: string;
  matchIndex: number;
  messages: SessionSearchMessage[];
  hasMoreBefore: boolean;
  hasMoreAfter: boolean;
}
