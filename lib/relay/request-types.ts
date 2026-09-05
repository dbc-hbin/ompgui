/**
 * Relay domain-request context (TransportParity owns this file).
 *
 * Every finite domain handler receives this context alongside its validated
 * action + args. `deviceId` is the authenticated device from hello;
 * `sessionId` is the currently opened relay session (if any) at dispatch
 * time. Handlers must NOT trust raw tokens — the token never leaves the
 * transport/auth layer.
 */
export interface RelayRequestContext {
  deviceId: string;
  sessionId: string | null;
}

/**
 * Finite domain dispatch handler. Returns a JSON object on success; throws a
 * coded error (carrying `code` + safe `details`) on failure. Transport
 * surfaces thrown codes as `{op:'result',req,success:false,error:{...}}`.
 */
export type RelayRequestHandler = (
  action: string,
  args: Record<string, unknown>,
  context: RelayRequestContext,
) => Promise<Record<string, unknown>>;
