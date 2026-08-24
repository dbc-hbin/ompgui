import { NextResponse } from "next/server";
import {
  invalidateSessionFileListCache,
  listArchivedSessionInfos,
  restoreArchivedSessionWithArtifacts,
  SessionArchiveError,
} from "@/lib/omp/session-files";
import {
  invalidateSessionListCache,
  invalidateSessionPathCache,
  listAllSessions,
} from "@/lib/session-reader";

export const runtime = "nodejs";

/** GET /api/sessions/archive — bounded metadata for native OMP archives. */
export async function GET() {
  try {
    const archives = await listArchivedSessionInfos();
    return NextResponse.json({ archives });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, code: "archive_list_failed" }, { status: 500 });
  }
}

/** POST /api/sessions/archive — restore { key } and return the live session. */
export async function POST(req: Request) {
  let key: unknown;
  try {
    const body = await req.json() as { key?: unknown };
    key = body?.key;
  } catch {
    return NextResponse.json({ error: "Invalid request body", code: "invalid_request" }, { status: 400 });
  }
  if (typeof key !== "string") {
    return NextResponse.json({ error: "Archive key is required", code: "invalid_key" }, { status: 400 });
  }

  try {
    const restored = await restoreArchivedSessionWithArtifacts(key);
    // The reader maintains independent list, path, entry, and file-walk caches;
    // invalidate all of them before resolving the restored session for the UI.
    invalidateSessionPathCache(restored.id);
    invalidateSessionListCache();
    invalidateSessionFileListCache();
    const session = (await listAllSessions()).find((item) => item.id === restored.id);
    return NextResponse.json({ ok: true, sessionId: restored.id, session });
  } catch (error) {
    const code = error instanceof SessionArchiveError ? error.code : "restore_failed";
    const status = code === "invalid_key" ? 400 : code === "not_found" ? 404 : code === "destination_conflict" ? 409 : 500;
    const message = error instanceof Error ? error.message : String(error);
    return NextResponse.json({ error: message, code }, { status });
  }
}
