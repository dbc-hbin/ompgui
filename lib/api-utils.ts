import { NextResponse } from "next/server";
import { resolveSessionPath } from "./session-reader";

const SESSION_NOT_FOUND = { error: "Session not found", code: "session_not_found" } as const;

/** Resolve a session id to its file path, or a 404 JSON response. Replaces the
 * repeated `resolveSessionPath(id)` + "Session not found" guard across routes. */
export async function resolveSessionPathOr404(
  id: string,
): Promise<{ filePath: string } | { response: NextResponse }> {
  const filePath = await resolveSessionPath(id);
  if (!filePath) return { response: NextResponse.json(SESSION_NOT_FOUND, { status: 404 }) };
  return { filePath };
}

/** Uniform JSON error body used by most API routes. */
export function apiErrorResponse(error: unknown, status = 500): NextResponse {
  return NextResponse.json({ error: String(error) }, { status });
}

/** Stable snake_case codes on ompgui's own Error subclasses. */
const INTERNAL_RPC_ERROR_CODE = /^[a-z][a-z0-9_]{0,63}$/;

function stringField(error: object, key: string): string | undefined {
  const value = (error as Record<string, unknown>)[key];
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

/**
 * Recognize `WebRpcError` / `RpcCommandError` across HMR. Live session
 * wrappers keep the class copy from first load; route `instanceof` against a
 * refreshed module class fails and used to collapse stale-queue CAS into a
 * 500 with no `code`. Name + code + message is the contract; plain objects
 * and unrelated Errors that happen to carry a `code` are rejected.
 */
export function rpcApiErrorPayload(error: unknown): { error: string; code: string } | null {
  if (!(error instanceof Error) || !error.message) return null;
  if (error.name === "WebRpcError") {
    const code = stringField(error, "code");
    if (!code || !INTERNAL_RPC_ERROR_CODE.test(code)) return null;
    return { error: error.message, code };
  }
  if (error.name === "RpcCommandError") {
    if (!stringField(error, "command")) return null;
    const code = stringField(error, "code") ?? "rpc_command_failed";
    if (!INTERNAL_RPC_ERROR_CODE.test(code)) return null;
    return { error: error.message, code };
  }
  return null;
}

/** 400 `{ error, code }` for internal RPC errors; otherwise null. */
export function rpcApiErrorResponse(error: unknown): NextResponse | null {
  const payload = rpcApiErrorPayload(error);
  if (!payload) return null;
  return NextResponse.json(payload, { status: 400 });
}
