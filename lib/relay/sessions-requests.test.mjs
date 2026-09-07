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

test("fork resolves only unique saved user references on the authorized branch", async () => {
  const { onlineMessage } = await jiti.import("./online-transcript.ts");
  const { RelaySessionError } = await jiti.import("./session-runtime.ts");
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const previousSessions = globalThis.__ompSessions;
  const commands = [];
  try {
    await withAgentDir(async dir => {
      const id = "fork-references";
      const root = userEntry("root", null, "first");
      const historical = userEntry("historical", "root", "other branch");
      const selected = userEntry("selected", "root", "same text");
      selected.message.timestamp = 1;
      const distinct = userEntry("distinct", "selected", "same text");
      distinct.message.timestamp = 2;
      const answer = assistantEntry("answer", "distinct", "answer");
      const duplicate = userEntry("duplicate", "answer", "repeated");
      const duplicateAgain = userEntry("duplicate-again", "duplicate", "repeated");
      writeSessionFile(dir, "fork.jsonl", { id, cwd: dir }, [root, historical, selected, distinct, answer, duplicate, duplicateAgain]);
      writeSessionFile(dir, "foreign.jsonl", { id: "foreign-fork", cwd: dir }, [userEntry("foreign", null, "foreign")]);
      invalidateSessionListCache();
      globalThis.__ompSessions = new Map([[id, {
        sessionId: id, isAlive: () => true,
        send(command) { commands.push({ ...command }); return { newSessionId: `fork-${command.entryId}` }; },
      }]]);
      const context = { ...CONTEXT, sessionId: id };
      const fork = (entryId, extra = {}, ctx = context) => handleSessionsRequest("command", { id, command: { type: "fork", entryId, ...extra } }, ctx);
      assert.deepEqual(await fork("selected"), { result: { newSessionId: "fork-selected" } });
      assert.deepEqual(await fork(onlineMessage(distinct.message).entryId), { result: { newSessionId: "fork-distinct" } });
      assert.deepEqual(await fork(onlineMessage(historical.message).entryId, { leafId: "historical" }), { result: { newSessionId: "fork-historical" } });
      assert.deepEqual(await fork("duplicate-again"), { result: { newSessionId: "fork-duplicate-again" } });
      assert.deepEqual(await fork("historical"), { result: { newSessionId: "fork-historical" } });
      await assert.rejects(fork("historical", { leafId: "duplicate-again" }), { code: "entry_not_found" });
      for (const reference of ["foreign", "missing", "answer", onlineMessage(answer.message).entryId, onlineMessage(duplicate.message).entryId, onlineMessage(historical.message).entryId, onlineMessage({ role: "user", content: "not saved" }).entryId]) {
        await assert.rejects(fork(reference), { code: "entry_not_found" });
      }
      globalThis.__ompSessions.set("fork-unpersisted", {
        sessionId: "fork-unpersisted", isAlive: () => true,
        send() { throw new Error("An unsaved fork must never reach the runtime"); },
      });
      await assert.rejects(handleSessionsRequest("command", { id: "fork-unpersisted", command: { type: "fork", entryId: onlineMessage(root.message).entryId } }, { ...CONTEXT, sessionId: "fork-unpersisted" }), { code: "entry_not_found" });
      await assert.rejects(fork("root", {}, CONTEXT), { code: "invalid_session" });
      await assert.rejects(fork("root", {}, { ...context, assertActive() { throw new RelaySessionError("device_revoked", "revoked"); } }), { code: "device_revoked" });
      assert.deepEqual(commands.map(command => command.entryId), ["selected", "distinct", "historical", "duplicate-again", "historical"]);
      assert.equal(commands.some(command => "leafId" in command), false);
    });
  } finally {
    globalThis.__ompSessions = previousSessions;
    invalidateSessionListCache();
  }
});

test("body search previews the matching historical branch without sending runtime commands", async () => {
  const previousSessions = globalThis.__ompSessions;
  const commands = [];
  try {
    await withAgentDir(async dir => {
      writeSessionFile(dir, "body-search.jsonl", { id: "body-search", cwd: dir, title: "Unrelated title" }, [
        userEntry("root", null, "Shared ancestor"),
        assistantEntry("old-branch", "root", "Historical needle 한글 %_"),
        assistantEntry("active-branch", "root", "Active response"),
      ]);
      globalThis.__ompSessions = new Map([["body-search", {
        isAlive: () => true,
        isRunning: () => true,
        send(command) { commands.push(command); throw new Error("Search must not send runtime commands"); },
      }]]);
      const found = await handleSessionsRequest("search", { query: "NEEDLE 한글 %_", limit: 1 }, CONTEXT);
      assert.deepEqual(found.matches.map(match => [match.sessionId, match.entryId]), [["body-search", "old-branch"]]);
      const preview = await handleSessionsRequest("searchContext", { id: "body-search", entryId: "old-branch" }, CONTEXT);
      assert.deepEqual(preview.messages.map(message => message.entryId), ["root", "old-branch"]);
      assert.equal(preview.messages[preview.matchIndex].content, "Historical needle 한글 %_");
      assert.equal(preview.leafId, "old-branch");
      assert.deepEqual(commands, []);
      await assert.rejects(handleSessionsRequest("search", { query: "needle", from: 7 }, CONTEXT), { code: "invalid_search" });
      await assert.rejects(handleSessionsRequest("searchContext", { id: "body-search", entryId: "absent" }, CONTEXT), { code: "not_found" });
    });
  } finally {
    globalThis.__ompSessions = previousSessions;
  }
});

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
      assert.equal(opened.snapshot.messages.length, 1);
      const first = opened.snapshot.messages[0];
      assert.equal(first.role, "user");
      assert.equal(first.text, "first");
      assert.equal(typeof first.entryId, "string");
      assert.ok(first.entryId.length > 0);
      const history = await handleSessionsRequest("history", { id: live.sessionId, online: true }, CONTEXT);
      assert.equal(history.messages[0].entryId, first.entryId);
      assert.equal(history.messages[0].text, "first");
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

test("saved online branch snapshots preserve complete text, tool failures and addressable media without sibling disclosure", async () => {
  const { snapshotRelayLeaf } = await jiti.import("./session-runtime.ts");
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  try {
    await withAgentDir(async dir => {
      const id = "rich-saved-branch";
      const longText = "Historical response 한글 ".repeat(300);
      const image = { type: "image", mimeType: "image/png", data: "QUJDRA==" };
      const call = assistantEntry("call", "root", longText);
      call.message.content.push({ type: "toolCall", id: "read-call", name: "read", arguments: { path: "missing.png" } });
      writeSessionFile(dir, `${id}.jsonl`, { id, cwd: dir }, [
        userEntry("root", null, "Read the image"),
        call,
        { type: "message", id: "failed-read", parentId: "call", timestamp: "2026-01-01T00:00:01.000Z", message: {
          role: "toolResult", toolCallId: "read-call", toolName: "read", isError: true,
          content: [{ type: "text", text: "Image lookup failed" }, image],
        } },
        assistantEntry("active-sibling", "root", "PRIVATE ACTIVE SIBLING"),
      ]);
      invalidateSessionListCache();
      const snapshot = await snapshotRelayLeaf(id, "failed-read");
      assert.equal(snapshot.leafId, "failed-read");
      assert.deepEqual(snapshot.messages.map(message => message.entryId), ["root", "call", "failed-read"]);
      assert.equal(snapshot.total, 3);
      assert.equal(snapshot.offset, 0);
      assert.equal(snapshot.hasMore, false);
      const assistant = snapshot.messages.find(message => message.entryId === "call");
      assert.equal(assistant.text, longText);
      assert.deepEqual(assistant.content.find(block => block.type === "toolCall"), {
        type: "toolCall", toolCallId: "read-call", toolName: "read", input: { path: "missing.png" },
      });
      const result = snapshot.messages.find(message => message.entryId === "failed-read");
      assert.equal(result.role, "toolResult");
      assert.equal(result.toolCallId, "read-call");
      assert.equal(result.toolName, "read");
      assert.equal(result.isError, true);
      assert.ok(result.text.split("\n").includes("Image lookup failed"));
      assert.deepEqual(result.deferredImages, { entryId: "failed-read", count: 1 });
      assert.equal(JSON.stringify(snapshot).includes(image.data), false);
      assert.equal(JSON.stringify(snapshot).includes("PRIVATE ACTIVE SIBLING"), false);
      const history = await handleSessionsRequest("history", { id, leafId: "failed-read", online: true }, CONTEXT);
      assert.deepEqual(history.messages, snapshot.messages);
      const media = await handleSessionsRequest("media", { id, entryId: result.entryId, leafId: "failed-read" }, CONTEXT);
      assert.deepEqual(media.images, [image]);
      assert.equal(media.missingCount, 0);
      assert.equal(media.hasMore, false);
      await assert.rejects(handleSessionsRequest("content", { id, entryId: "active-sibling", leafId: "failed-read" }, CONTEXT), { code: "entry_not_found" });
    });
  } finally {
    invalidateSessionListCache();
  }
});

test("online snapshots expose the latest bounded page and history retrieves the omitted prefix", async () => {
  const { snapshotRelayLeaf } = await jiti.import("./session-runtime.ts");
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  try {
    await withAgentDir(async dir => {
      const id = "rich-paged-snapshot";
      const entries = Array.from({ length: 600 }, (_, index) => assistantEntry(`entry-${index}`, index ? `entry-${index - 1}` : null, `Response ${index}`));
      writeSessionFile(dir, `${id}.jsonl`, { id, cwd: dir }, entries);
      invalidateSessionListCache();
      const snapshot = await snapshotRelayLeaf(id, "entry-599");
      assert.equal(snapshot.total, 600);
      assert.ok(snapshot.offset > 0);
      assert.equal(snapshot.offset + snapshot.messages.length, snapshot.total);
      assert.equal(snapshot.messages[0].entryId, `entry-${snapshot.offset}`);
      assert.equal(snapshot.messages.at(-1).entryId, "entry-599");
      assert.equal(snapshot.messages.at(-1).text, "Response 599");
      const prefix = await handleSessionsRequest("history", { id, leafId: "entry-599", online: true, offset: 0, limit: 10 }, CONTEXT);
      assert.equal(prefix.total, 600);
      assert.equal(prefix.offset, 0);
      assert.equal(prefix.hasMore, true);
      assert.deepEqual(prefix.messages.map(message => message.entryId), entries.slice(0, 10).map(entry => entry.id));
    });
  } finally {
    invalidateSessionListCache();
  }
});

test("live unpersisted rich history keeps snapshot identities and resolves tool images", async () => {
  const { openRelaySession } = await jiti.import("./session-runtime.ts");
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const previousSessions = globalThis.__ompSessions;
  let opened;
  try {
    await withAgentDir(async dir => {
      const id = "live-rich-media";
      const image = { type: "image", mimeType: "image/png", data: "QUJDRA==" };
      const messages = [
        { role: "assistant", content: [{ type: "toolCall", id: "live-call", name: "read", arguments: { path: "live.png" } }] },
        { role: "toolResult", toolCallId: "live-call", toolName: "read", isError: false, content: [{ type: "text", text: "Live image" }, image] },
      ];
      globalThis.__ompSessions = new Map([[id, {
        sessionId: id, cwd: dir, isAlive: () => true, isRunning: () => false,
        async send(command) { return command.type === "get_messages" ? { messages } : {}; },
        onEvent() { return () => {}; }, onDestroy() { return () => {}; },
      }]]);
      invalidateSessionListCache();
      opened = await openRelaySession(id, () => {});
      const history = await handleSessionsRequest("history", { id, online: true }, CONTEXT);
      assert.equal(history.total, 2);
      assert.deepEqual(history.messages, opened.snapshot.messages);
      const result = history.messages.find(message => message.role === "toolResult");
      assert.equal(typeof result.entryId, "string");
      assert.equal(result.toolCallId, "live-call");
      assert.match(result.text, /Live image/);
      assert.deepEqual(result.deferredImages, { entryId: result.entryId, count: 1 });
      assert.equal(JSON.stringify(history.messages).includes(image.data), false);
      const media = await handleSessionsRequest("media", { id, entryId: result.entryId }, CONTEXT);
      assert.deepEqual(media.images, [image]);
      assert.equal(media.missingCount, 0);
      assert.equal(media.hasMore, false);
    });
  } finally {
    opened?.dispose();
    globalThis.__ompSessions = previousSessions;
    invalidateSessionListCache();
  }
});

test("large live image results paginate without losing individually supported images", async () => {
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const previousSessions = globalThis.__ompSessions;
  try {
    await withAgentDir(async dir => {
      const id = "live-large-media";
      const images = [
        { type: "image", mimeType: "image/png", data: Buffer.alloc(6 * 1024 * 1024, 65).toString("base64") },
        { type: "image", mimeType: "image/png", data: Buffer.alloc(6 * 1024 * 1024, 66).toString("base64") },
      ];
      const messages = [{ role: "toolResult", toolCallId: "large-images", toolName: "read", content: images }];
      globalThis.__ompSessions = new Map([[id, {
        sessionId: id, cwd: dir, isAlive: () => true, isRunning: () => false,
        async send(command) { return command.type === "get_messages" ? { messages } : {}; },
      }]]);
      invalidateSessionListCache();
      const history = await handleSessionsRequest("history", { id, online: true }, CONTEXT);
      const entryId = history.messages[0].entryId;
      const first = await handleSessionsRequest("media", { id, entryId }, CONTEXT);
      assert.equal(first.total, 2);
      assert.equal(first.offset, 0);
      assert.equal(first.hasMore, true);
      assert.equal(first.nextOffset, 1);
      assert.equal(first.missingCount, 0);
      assert.deepEqual(first.images, [images[0]]);
      const second = await handleSessionsRequest("media", { id, entryId, offset: first.nextOffset }, CONTEXT);
      assert.equal(second.total, 2);
      assert.equal(second.offset, 1);
      assert.equal(second.hasMore, false);
      assert.equal(second.missingCount, 0);
      assert.deepEqual(second.images, [images[1]]);
    });
  } finally {
    globalThis.__ompSessions = previousSessions;
    invalidateSessionListCache();
  }
});

test("live tool previews remain encodable and wait for message completion before advertising retrievable content", async () => {
  const { openRelaySession } = await jiti.import("./session-runtime.ts");
  const { encodeRelayFrames, RelayChunkAssembler } = await jiti.import("./chunks.ts");
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const previousSessions = globalThis.__ompSessions;
  let opened;
  try {
    await withAgentDir(async dir => {
      const id = "live-large-events";
      const images = [
        { type: "image", mimeType: "image/png", data: Buffer.alloc(6 * 1024 * 1024, 65).toString("base64") },
        { type: "image", mimeType: "image/png", data: Buffer.alloc(6 * 1024 * 1024, 66).toString("base64") },
      ];
      const text = "Large live tool output 한글 ".repeat(10_000);
      const result = { content: [{ type: "text", text }, ...images] };
      const messages = [];
      let emitLive;
      const delivered = [];
      globalThis.__ompSessions = new Map([[id, {
        sessionId: id, cwd: dir, isAlive: () => true, isRunning: () => false,
        async send(command) { return command.type === "get_messages" ? { messages } : {}; },
        onEvent(callback) { emitLive = callback; return () => {}; },
        onDestroy() { return () => {}; },
      }]]);
      invalidateSessionListCache();
      opened = await openRelaySession(id, event => delivered.push(event));
      emitLive({ type: "tool_execution_update", toolCallId: "event-call", toolName: "read", partialResult: result });
      emitLive({ type: "tool_execution_end", toolCallId: "event-call", toolName: "read", result, isError: true });
      for (const [type, field] of [["tool_execution_update", "partialResult"], ["tool_execution_end", "result"]]) {
        const event = delivered.find(candidate => candidate.type === type);
        const preview = event[field];
        assert.equal(preview.truncated, true);
        assert.equal(preview.contentPending, true);
        assert.equal(preview.entryId, undefined);
        assert.deepEqual(preview.deferredImages, { count: 2 });
        assert.equal(event.contentPending, true);
        assert.equal(event.entryId, undefined);
        assert.equal(event.toolCallId, "event-call");
        const serialized = JSON.stringify(event);
        assert.ok(Buffer.byteLength(serialized) < 16 * 1024 * 1024);
        for (const image of images) assert.equal(serialized.includes(image.data), false);
        const assembler = new RelayChunkAssembler();
        let decoded;
        for (const frame of encodeRelayFrames(event)) {
          assert.ok(Buffer.byteLength(frame) <= 256 * 1024);
          const parsed = JSON.parse(frame);
          decoded = parsed.op === "chunk" ? assembler.accept(parsed) : frame;
        }
        const received = JSON.parse(decoded);
        assert.deepEqual(received, JSON.parse(serialized));
        assert.equal(received.type, type);
        assert.equal(received.toolCallId, "event-call");
        assert.equal(received.contentPending, true);
        assert.equal(received.entryId, undefined);
        assert.equal(received[field].truncated, true);
        assert.equal(received[field].contentPending, true);
        assert.equal(received[field].entryId, undefined);
        assert.deepEqual(received[field].deferredImages, { count: 2 });
      }
      assert.equal(delivered.find(event => event.type === "tool_execution_end").isError, true);
      const message = { role: "toolResult", toolCallId: "event-call", toolName: "read", isError: true, ...result };
      messages.push(message);
      emitLive({ type: "message_end", message });
      const completed = delivered.find(event => event.type === "message_end").message;
      const history = await handleSessionsRequest("history", { id, online: true }, CONTEXT);
      assert.equal(completed.entryId, history.messages[0].entryId);
      assert.deepEqual(completed.deferredImages, { entryId: completed.entryId, count: 2 });
      assert.notEqual(completed.contentPending, true);
      const media = await handleSessionsRequest("media", { id, entryId: completed.entryId }, CONTEXT);
      assert.deepEqual(media.images, [images[0]]);
      assert.equal(media.hasMore, true);
    });
  } finally {
    opened?.dispose();
    globalThis.__ompSessions = previousSessions;
    invalidateSessionListCache();
  }
});

test("oversized online previews explicitly truncate and content chunks reconstruct complete normalized JSON", async () => {
  const { snapshotRelayLeaf } = await jiti.import("./session-runtime.ts");
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  try {
    await withAgentDir(async dir => {
      const id = "rich-large-content";
      const text = "Complete text 한글 😀 ".repeat(100_000);
      writeSessionFile(dir, `${id}.jsonl`, { id, cwd: dir }, [assistantEntry("large", null, text)]);
      invalidateSessionListCache();
      const snapshot = await snapshotRelayLeaf(id, "large");
      const preview = snapshot.messages[0];
      assert.equal(preview.entryId, "large");
      assert.equal(preview.truncated, true);
      assert.ok(preview.text.length < text.length);
      let offset = 0;
      let total;
      const chunks = [];
      for (;;) {
        const chunk = await handleSessionsRequest("content", { id, entryId: preview.entryId, leafId: "large", offset, limit: 8192 }, CONTEXT);
        assert.equal(chunk.encoding, "json");
        assert.equal(chunk.offset, offset);
        total ??= chunk.total;
        assert.equal(chunk.total, total);
        chunks.push(chunk.text);
        offset += chunk.text.length;
        if (!chunk.hasMore) {
          assert.equal(offset, total);
          break;
        }
        assert.equal(chunk.nextOffset, offset);
        assert.ok(chunk.text.length > 0);
        assert.ok(offset < total);
      }
      const complete = JSON.parse(chunks.join(""));
      assert.equal(complete.entryId, "large");
      assert.equal(complete.role, "assistant");
      assert.equal(complete.text, text);
      assert.deepEqual(complete.content, [{ type: "text", text }]);
      assert.notEqual(complete.truncated, true);
    });
  } finally {
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

test("revocation during queue startup prevents image disclosure and consumes the pending claim", async () => {
  const { invalidateSessionListCache } = await jiti.import("../session-reader.ts");
  const { RelaySessionError } = await jiti.import("./session-runtime.ts");
  const { relayAttachments } = await jiti.import("./attachments.ts");
  const previousLocks = globalThis.__ompStartLocks;
  const started = Promise.withResolvers();
  const firstCheck = Promise.withResolvers();
  let active = true;
  let sent = 0;
  globalThis.__ompStartLocks = new Map([["revoke-queue", started.promise]]);
  try {
    await withAgentDir(async dir => {
      writeSessionFile(dir, "revoke-queue.jsonl", { id: "revoke-queue", cwd: dir });
      invalidateSessionListCache();
      const image = relayAttachments.begin(CONTEXT.deviceId, "image/png", 1);
      relayAttachments.chunk(CONTEXT.deviceId, image.attachmentId, 0, "YQ==");
      relayAttachments.complete(CONTEXT.deviceId, image.attachmentId);
      const pending = handleSessionsRequest("command", { id: "revoke-queue", command: {
        type: "enqueue_message", lane: "steer", message: "", attachmentIds: [image.attachmentId],
      } }, {
        ...CONTEXT, sessionId: "revoke-queue",
        assertActive() {
          if (!active) throw new RelaySessionError("device_revoked", "Device revoked");
          firstCheck.resolve();
        },
      });
      const rejected = assert.rejects(pending, { code: "device_revoked" });
      await firstCheck.promise;
      active = false;
      started.resolve({ session: { send() { sent++; return {}; } }, realSessionId: "revoke-queue" });
      await rejected;
      assert.equal(sent, 0);
      assert.throws(() => relayAttachments.claim(CONTEXT.deviceId, [image.attachmentId]), { code: "invalid_attachment" });
    });
  } finally {
    relayAttachments.cleanupDevice(CONTEXT.deviceId);
    globalThis.__ompStartLocks = previousLocks;
    invalidateSessionListCache();
  }
});

test("queue commands validate payloads and preserve explicit revisions and server responses", async () => {
  const { RelaySessionError } = await jiti.import("./session-runtime.ts");
  const previousSessions = globalThis.__ompSessions;
  const commands = [];
  const images = [{ type: "image", mimeType: "image/png", data: "YQ==" }];
  const queue = { revision: 9, items: [] };
  const recalled = { queue, recalled: { id: "queued", text: "", lane: "followUp", status: "queued", attachments: [{ mimeType: "image/png", bytes: 1 }], images } };
  const conflict = new RelaySessionError("stale", "Queue changed", { revision: 9 });
  try {
    globalThis.__ompSessions = new Map([["queue-boundary", {
      isAlive: () => true,
      async send(command) {
        commands.push(command);
        if (command.expectedRevision === 8) throw conflict;
        return command.type === "recall_queued_message" ? recalled : { queue };
      },
    }]]);
    const send = command => handleSessionsRequest("command", { id: "queue-boundary", command }, CONTEXT);
    await send({ type: "enqueue_message", lane: "followUp", message: "", images: [{ ...images[0], filename: "private.png" }] });
    assert.deepEqual(commands[0], { type: "enqueue_message", lane: "followUp", message: "", images });
    await send({ type: "get_message_queue" });
    assert.deepEqual(await send({ type: "recall_queued_message", id: "queued", expectedRevision: 0, __relayRecallMaxBytes: Number.MAX_SAFE_INTEGER }), { result: recalled });
    assert.equal(commands.at(-1).__relayRecallMaxBytes, 15 * 1024 * 1024);
    await send({ type: "delete_queued_message", id: "queued", expectedRevision: 9 });
    await send({ type: "promote_queued_message", id: "queued", expectedRevision: 9 });
    await assert.rejects(send({ type: "delete_queued_message", id: "queued", expectedRevision: 8 }), error => error === conflict);
    const accepted = commands.length;
    for (const command of [
      { type: "enqueue_message", lane: "follow_up", message: "x" },
      { type: "enqueue_message", lane: "steer" },
      { type: "recall_queued_message", id: "queued" },
      { type: "delete_queued_message", id: "queued", expectedRevision: "9" },
      { type: "promote_queued_message", id: "", expectedRevision: 9 },
      { type: "promote_queued_message", id: "queued", expectedRevision: -1 },
    ]) await assert.rejects(send(command), { code: "invalid_command" });
    await assert.rejects(send({ type: "enqueue_message", lane: "steer", message: "", images: [{ data: "not base64", mimeType: "image/png" }] }), { code: "invalid_images" });
    assert.equal(commands.length, accepted);
  } finally {
    globalThis.__ompSessions = previousSessions;
  }
});

test("queued staged images reject duplicate and stale claims and dispose after failed sends", async () => {
  const { relayAttachments } = await jiti.import("./attachments.ts");
  const { RelaySessionError } = await jiti.import("./session-runtime.ts");
  const previousSessions = globalThis.__ompSessions;
  const commands = [];
  const context = { ...CONTEXT, sessionId: "queue-uploads" };
  const failure = new RelaySessionError("queue_full", "Queue is full");
  let rejectSend = false;
  const upload = () => {
    const image = relayAttachments.begin(CONTEXT.deviceId, "image/png", 1);
    relayAttachments.chunk(CONTEXT.deviceId, image.attachmentId, 0, "YQ==");
    relayAttachments.complete(CONTEXT.deviceId, image.attachmentId);
    return image.attachmentId;
  };
  const send = attachmentIds => handleSessionsRequest("command", { id: context.sessionId, command: { type: "enqueue_message", lane: "steer", message: "", attachmentIds } }, context);
  try {
    globalThis.__ompSessions = new Map([[context.sessionId, {
      isAlive: () => true,
      async send(command) { commands.push(command); if (rejectSend) throw failure; return { revision: 1 }; },
    }]]);
    const id = upload();
    const args = { id: context.sessionId, command: { type: "enqueue_message", lane: "steer", message: "", attachmentIds: [id] } };
    await assert.rejects(handleSessionsRequest("command", args, { ...context, sessionId: null }), { code: "invalid_session" });
    await assert.rejects(handleSessionsRequest("command", args, { ...context, deviceId: "d_otherdevice0123456789" }), { code: "invalid_attachment" });
    await assert.rejects(send([id, id]), { code: "invalid_attachment" });
    await assert.rejects(send([id, "stale-upload"]), { code: "invalid_attachment" });
    assert.deepEqual(commands, []);
    await send([id]);
    assert.deepEqual(commands, [{ type: "enqueue_message", lane: "steer", message: "", images: [{ type: "image", mimeType: "image/png", data: "YQ==" }] }]);
    await assert.rejects(send([id]), { code: "invalid_attachment" });
    const failedId = upload();
    rejectSend = true;
    await assert.rejects(send([failedId]), error => error === failure);
    await assert.rejects(send([failedId]), { code: "invalid_attachment" });
    assert.equal(commands.length, 2);
  } finally {
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

test("dialog responses require the opened session and active device", async () => {
  const previousSessions = globalThis.__ompSessions;
  const commands = [];
  globalThis.__ompSessions = new Map([["dialog-session", { isAlive: () => true, send: command => { commands.push(command); return null; } }]]);
  try {
    const args = { id: "dialog-session", command: { type: "extension_ui_response", id: "ask-1", value: "SQLite" } };
    await assert.rejects(handleSessionsRequest("command", args, { ...CONTEXT, sessionId: "other-session" }), error => error.code === "invalid_session");
    await assert.rejects(handleSessionsRequest("command", args, { ...CONTEXT, sessionId: "dialog-session", assertActive() { throw new Error("revoked"); } }), /revoked/);
    assert.deepEqual(commands, []);
    await handleSessionsRequest("command", args, { ...CONTEXT, sessionId: "dialog-session" });
    assert.deepEqual(commands, [args.command]);
  } finally {
    globalThis.__ompSessions = previousSessions;
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

