import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { apiErrorResponse, rpcApiErrorPayload, rpcApiErrorResponse } = await jiti.import("./api-utils.ts");

class ForeignWebRpcError extends Error {
  constructor(message, code) {
    super(message);
    this.name = "WebRpcError";
    this.code = code;
  }
}

class ForeignRpcCommandError extends Error {
  constructor(command, message, code) {
    super(message);
    this.name = "RpcCommandError";
    this.command = command;
    this.code = code;
  }
}

test("stale-queue WebRpcError from a prior module copy is a 400 with queue_stale_revision", async () => {
  const error = new ForeignWebRpcError(
    "Queue revision is stale; reload the queue and retry",
    "queue_stale_revision",
  );
  const response = rpcApiErrorResponse(error);
  assert.ok(response);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), {
    error: "Queue revision is stale; reload the queue and retry",
    code: "queue_stale_revision",
  });
});

test("RpcCommandError from a prior module copy keeps its stable code", async () => {
  const error = new ForeignRpcCommandError("prompt", "command failed", "rpc_timeout");
  const response = rpcApiErrorResponse(error);
  assert.ok(response);
  assert.equal(response.status, 400);
  assert.deepEqual(await response.json(), { error: "command failed", code: "rpc_timeout" });
});

test("RpcCommandError without a code falls back to rpc_command_failed", async () => {
  const error = new ForeignRpcCommandError("prompt", "command failed");
  assert.deepEqual(rpcApiErrorPayload(error), { error: "command failed", code: "rpc_command_failed" });
});

test("rejects arbitrary Errors and plain objects that only look similar", () => {
  const withCode = new Error("Queue revision is stale; reload the queue and retry");
  withCode.code = "queue_stale_revision";
  assert.equal(rpcApiErrorPayload(withCode), null);
  assert.equal(rpcApiErrorResponse(withCode), null);

  const unnamed = new Error("Queue revision is stale; reload the queue and retry");
  unnamed.name = "WebRpcError";
  assert.equal(rpcApiErrorPayload(unnamed), null);

  const badCode = new ForeignWebRpcError("nope", "not a code!!");
  assert.equal(rpcApiErrorPayload(badCode), null);

  const missingCommand = new Error("command failed");
  missingCommand.name = "RpcCommandError";
  missingCommand.code = "rpc_timeout";
  assert.equal(rpcApiErrorPayload(missingCommand), null);

  assert.equal(
    rpcApiErrorPayload({
      name: "WebRpcError",
      message: "Queue revision is stale; reload the queue and retry",
      code: "queue_stale_revision",
    }),
    null,
  );
});

test("generic failures still stringify without a code", async () => {
  const error = new Error("boom");
  const response = apiErrorResponse(error);
  assert.equal(response.status, 500);
  assert.deepEqual(await response.json(), { error: "Error: boom" });
});

