import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const mod = await jiti.import("./sessions-requests.ts");
const { handleSessionsRequest } = mod;

const CONTEXT = { deviceId: "d_testdevice0123456789", sessionId: null };

function writeSessionFile(dir, name, header, entries = []) {
  const filePath = join(dir, name);
  const lines = [JSON.stringify({ type: "session", version: 3, ...header })];
  for (const entry of entries) lines.push(JSON.stringify(entry));
  writeFileSync(filePath, `${lines.join("\n")}\n`);
  return filePath;
}

function userEntry(id, parentId, content) {
  return { type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z", message: { role: "user", content } };
}

function assistantEntry(id, parentId, text) {
  return {
    type: "message", id, parentId, timestamp: "2026-01-01T00:00:00.000Z",
    message: { role: "assistant", provider: "test", model: "test-model", content: [{ type: "text", text }] },
  };
}

function withAgentDir(run) {
  const agentDir = mkdtempSync(join(tmpdir(), "ompgui-sessreq-"));
  const projectDir = join(agentDir, "sessions", "-project");
  mkdirSync(projectDir, { recursive: true });
  const previous = process.env.PI_CODING_AGENT_DIR;
  process.env.PI_CODING_AGENT_DIR = agentDir;
  return Promise.resolve(run(projectDir)).finally(() => {
    if (previous === undefined) delete process.env.PI_CODING_AGENT_DIR;
    else process.env.PI_CODING_AGENT_DIR = previous;
    rmSync(agentDir, { recursive: true, force: true });
  });
}

test("revocation during awaited startup prevents the prepared prompt from reaching OMP", async () => {
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const { RelaySessionError } = await jiti.import("./session-runtime.ts");
  const previousLocks = globalThis.__ompStartLocks;
  const started = Promise.withResolvers();
  const firstCheck = Promise.withResolvers();
  let active = true;
  let sent = 0;
  globalThis.__ompStartLocks = new Map([["revoke-startup", started.promise]]);
  try {
    await withAgentDir(async dir => {
      writeSessionFile(dir, "revoke-startup.jsonl", { id: "revoke-startup", cwd: dir, timestamp: "2026-01-01T00:00:00.000Z" });
      invalidateSessionListCache();
      const pending = handleSessionsRequest("command", { id: "revoke-startup", command: { type: "prompt", message: "must not send" } }, {
        ...CONTEXT,
        assertActive() {
          if (!active) throw new RelaySessionError("device_revoked", "Device revoked");
          firstCheck.resolve();
        },
      });
      const rejected = assert.rejects(pending, { code: "device_revoked" });
      await firstCheck.promise;
      active = false;
      started.resolve({ session: { send() { sent++; return {}; } }, realSessionId: "revoke-startup" });
      await rejected;
      assert.equal(sent, 0);
    });
  } finally {
    globalThis.__ompStartLocks = previousLocks;
    invalidateSessionListCache();
  }
});

test("live unpersisted sessions open and accept their first image prompt while absent inactive sessions reject", async () => {
  const { openRelaySession } = await jiti.import("./session-runtime.ts");
  const { relayAttachments } = await jiti.import("./attachments.ts");
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const previousSessions = globalThis.__ompSessions;
  const commands = [];
  const liveMessages = [];
  const events = new Set();
  let opened;
  try {
    await withAgentDir(async dir => {
      const live = {
        sessionId: "live-unpersisted", cwd: dir,
        isAlive: () => true, isRunning: () => false,
        send(command) {
          commands.push(command);
          if (command.type === "get_messages") return Promise.resolve({ messages: liveMessages });
          if (command.type === "prompt") liveMessages.push({ role: "user", content: [{ type: "text", text: command.message }], timestamp: 1 });
          return Promise.resolve({ sessionId: this.sessionId });
        },
        onEvent(callback) { events.add(callback); return () => events.delete(callback); },
        onDestroy() { return () => {}; },
      };
      globalThis.__ompSessions = new Map([[live.sessionId, live]]);
      invalidateSessionListCache();
      opened = await openRelaySession(live.sessionId, () => {});
      assert.equal(opened.snapshot.agent.ready, true);
      assert.deepEqual(opened.snapshot.messages, []);
      const image = relayAttachments.begin(CONTEXT.deviceId, "image/png", 1);
      relayAttachments.chunk(CONTEXT.deviceId, image.attachmentId, 0, "YQ==");
      relayAttachments.complete(CONTEXT.deviceId, image.attachmentId);
      await handleSessionsRequest("command", { id: live.sessionId, command: { type: "prompt", message: "first", attachmentIds: [image.attachmentId] } }, { ...CONTEXT, sessionId: live.sessionId });
      const prompt = commands.find(command => command.type === "prompt");
      assert.deepEqual(prompt.images, [{ type: "image", mimeType: "image/png", data: "YQ==" }]);
      opened.dispose();
      opened = await openRelaySession(live.sessionId, () => {});
      assert.deepEqual(opened.snapshot.messages, [{ role: "user", text: "first", timestamp: 1 }]);
      await assert.rejects(handleSessionsRequest("command", { id: live.sessionId, command: { type: "prompt", message: "reuse", attachmentIds: [image.attachmentId] } }, { ...CONTEXT, sessionId: live.sessionId }), { code: "invalid_attachment" });
      await assert.rejects(openRelaySession("inactive-missing", () => {}), { code: "session_not_found" });
      opened.dispose();
      assert.equal(events.size, 0);
    });
  } finally {
    opened?.dispose();
    relayAttachments.cleanupDevice(CONTEXT.deviceId);
    globalThis.__ompSessions = previousSessions;
    invalidateSessionListCache();
  }
});

test("subagent detail distinguishes live pending, historical output, unavailable and foreign artifacts", async () => {
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const previousSessions = globalThis.__ompSessions;
  try {
    await withAgentDir(async dir => {
      const id = "detail-parent";
      const artifacts = join(dir, id);
      mkdirSync(artifacts);
      const artifactAlias = join(dir, "artifact-alias");
      symlinkSync(artifacts, artifactAlias, "dir");
      writeFileSync(join(artifacts, "finished-output.md"), "Finished result");
      writeFileSync(join(dir, "private.md"), "Do not disclose");
      symlinkSync(join(dir, "private.md"), join(artifacts, "Escaped.md"));
      writeSessionFile(dir, `${id}.jsonl`, { id, cwd: dir }, [{
        type: "message", id: "task-result", message: { role: "toolResult", toolName: "task", details: {
          progress: [{ id: "Historical", status: "running" }],
          results: [
            { id: "Finished", exitCode: 0, outputPath: join(artifactAlias, "finished-output.md") },
            { id: "Foreign", exitCode: 0, outputPath: join(dir, "private.md") },
          ],
        } },
      }]);
      globalThis.__ompSessions = new Map([[id, {
        isAlive: () => true,
        async send(command) {
          if (command.type === "get_subagents") return { subagents: [{ id: "Active", status: "running" }] };
          throw new Error("Registry transcript not ready");
        },
      }]]);
      invalidateSessionListCache();
      const detail = (action, subagentId) => handleSessionsRequest(action, { id, subagentId }, CONTEXT);
      assert.deepEqual(await detail("subagentCompletion", "Active"), { status: "pending", completion: null, truncated: false });
      assert.equal((await detail("subagentTranscript", "Active")).status, "pending");
      assert.deepEqual(await detail("subagentCompletion", "Finished"), { status: "ready", completion: "Finished result", truncated: false });
      assert.deepEqual(await detail("subagentCompletion", "Historical"), { status: "unavailable", completion: null, truncated: false });
      await assert.rejects(detail("subagentTranscript", "Historical"), { code: "transcript_not_found" });
      await assert.rejects(detail("subagentCompletion", "Unknown"), { code: "subagent_not_found" });
      await assert.rejects(detail("subagentCompletion", "Foreign"), { code: "artifact_forbidden" });
      await assert.rejects(detail("subagentCompletion", "Escaped"), { code: "artifact_forbidden" });
      writeFileSync(join(artifacts, "Finished.jsonl"), `${JSON.stringify(assistantEntry("a1", null, "Transcript final"))}\n`);
      const page = await detail("subagentTranscript", "Finished");
      assert.deepEqual(page.messages[0].content, [{ type: "text", text: "Transcript final" }]);
      assert.equal(page.status, "ready");
    });
  } finally {
    globalThis.__ompSessions = previousSessions;
    invalidateSessionListCache();
  }
});

test("attachment steering and follow-up reach native RPC and consume uploaded payloads", async () => {
  const { AgentSessionWrapper } = await jiti.import("../rpc-manager.ts");
  const { relayAttachments } = await jiti.import("./attachments.ts");
  const previousSessions = globalThis.__ompSessions;
  const commands = [];
  const wrapper = new AgentSessionWrapper({
    isAlive: true,
    async sendCommand(command) { commands.push(command); return {}; },
    onFrame() { return () => {}; },
    sendFrame() {},
    async dispose() {},
  }, process.cwd());
  try {
    globalThis.__ompSessions = new Map([["attachment-handoff", wrapper]]);
    for (const type of ["steer", "follow_up"]) {
      const image = relayAttachments.begin(CONTEXT.deviceId, "image/png", 1);
      relayAttachments.chunk(CONTEXT.deviceId, image.attachmentId, 0, "YQ==");
      relayAttachments.complete(CONTEXT.deviceId, image.attachmentId);
      const args = { id: "attachment-handoff", command: { type, message: "Inspect image", attachmentIds: [image.attachmentId] } };
      const context = { ...CONTEXT, sessionId: args.id };
      await handleSessionsRequest("command", args, context);
      assert.deepEqual(commands.find(command => command.type === type), { type, message: "Inspect image", images: [{ type: "image", mimeType: "image/png", data: "YQ==" }] });
      await assert.rejects(handleSessionsRequest("command", args, context), { code: "invalid_attachment" });
    }
  } finally {
    await wrapper.destroyAndWait();
    relayAttachments.cleanupDevice(CONTEXT.deviceId);
    globalThis.__ompSessions = previousSessions;
  }
});

test("unknown action fails with unknown_action", async () => {
  await assert.rejects(() => handleSessionsRequest("nope", {}, CONTEXT), (error) => error.code === "unknown_action");
});

test("request rejects non-object arguments instead of defaulting them", async () => {
  for (const args of [null, undefined, [], "text", 1]) {
    await assert.rejects(
      () => handleSessionsRequest("list", args, CONTEXT),
      (error) => error.code === "invalid_args",
    );
  }
});

test("command rejects unsupported UI-only commands", async () => {
  for (const type of ["navigate_tree", "clear_queue", "get_tools", "set_tools", "extension_ui_input"]) {
    await assert.rejects(
      () => handleSessionsRequest("command", { id: "x", command: { type } }, CONTEXT),
      (error) => error.code === "unsupported_command",
      type,
    );
  }
});

test("command rejects arbitrary RPC types", async () => {
  await assert.rejects(
    () => handleSessionsRequest("command", { id: "x", command: { type: "rm_rf_everything" } }, CONTEXT),
    (error) => error.code === "unsupported_command",
  );
});

test("command rejects bash output exclusion rather than leaking output into context", async () => {
  await assert.rejects(
    () => handleSessionsRequest("command", { id: "x", command: { type: "bash", command: "ls", excludeFromContext: true } }, CONTEXT),
    (error) => error.code === "bash_exclude_unsupported",
  );
});

test("history paginates full disk context without legacy caps", async () => {
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  await withAgentDir(async (dir) => {
    const cwd = join(tmpdir(), "ompgui-sessreq-missing");
    writeSessionFile(dir, "2026-01-01_hist.jsonl", { id: "hist-1", cwd, timestamp: "2026-01-01T00:00:00.000Z" }, [
      userEntry("u1", null, "first"),
      assistantEntry("a1", "u1", "answer one"),
      userEntry("u2", "a1", "second"),
      assistantEntry("a2", "u2", "answer two"),
    ]);
    invalidateSessionListCache();
    const page1 = await handleSessionsRequest("history", { id: "hist-1", offset: 0, limit: 2 }, CONTEXT);
    assert.equal(page1.total, 4);
    assert.equal(page1.messages.length, 2);
    assert.equal(page1.hasMore, true);
    const page2 = await handleSessionsRequest("history", { id: "hist-1", offset: 2, limit: 2 }, CONTEXT);
    assert.equal(page2.messages.length, 2);
    assert.equal(page2.hasMore, false);
  });
});


test("import rejects oversized content at the 10MB bound", async () => {
  await assert.rejects(
    () => handleSessionsRequest("import", { fileName: "s.jsonl", content: `{"type":"session","cwd":"/tmp","id":"x"}\n${"y".repeat(11 * 1024 * 1024)}` }, CONTEXT),
    (error) => error.code === "invalid_content",
  );
});

test("thinking validates entry and block index", async () => {
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  await withAgentDir(async (dir) => {
    const cwd = join(tmpdir(), "ompgui-sessreq-think");
    writeSessionFile(dir, "2026-01-01_think.jsonl", { id: "think-1", cwd, timestamp: "2026-01-01T00:00:00.000Z" }, [
      userEntry("u1", null, "hi"),
      {
        type: "message", id: "a1", parentId: "u1", timestamp: "2026-01-01T00:00:00.000Z",
        message: { role: "assistant", provider: "t", model: "m", content: [{ type: "thinking", thinking: "deep thought" }] },
      },
    ]);
    invalidateSessionListCache();
    const out = await handleSessionsRequest("thinking", { id: "think-1", entryId: "a1", blockIndex: 0 }, CONTEXT);
    assert.equal(out.thinking, "deep thought");
    await assert.rejects(
      () => handleSessionsRequest("thinking", { id: "think-1", entryId: "a1", blockIndex: 5 }, CONTEXT),
      (error) => error.code === "thinking_block_not_found",
    );
  });
});

