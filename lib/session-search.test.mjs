import assert from "node:assert/strict";
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { homedir, tmpdir } from "node:os";
import { join, relative } from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { searchSessions, searchSessionContext, SessionSearchError } = await jiti.import("./session-search.ts");
const { getSessionsDir } = await jiti.import("./omp/paths.ts");
const { setSessionTitle } = await jiti.import("./omp/session-files.ts");

function message(id, parentId, content, role = "user", extra = {}) {
  return { type: "message", id, parentId, timestamp: "2026-01-02T12:00:00Z", message: { role, content, ...extra } };
}

async function fixture(run) {
  const dir = mkdtempSync(join(tmpdir(), "session-search-"));
  const keys = ["OMP_PROFILE", "PI_PROFILE", "PI_CODING_AGENT_DIR", "PI_CONFIG_DIR"];
  const previous = keys.map(key => process.env[key]);
  process.env.OMP_PROFILE = "";
  delete process.env.PI_PROFILE;
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.PI_CONFIG_DIR = relative(homedir(), join(dir, "config"));
  const project = join(dir, "project");
  mkdirSync(project);
  const folder = join(getSessionsDir(), "fixture");
  mkdirSync(folder, { recursive: true });
  const file = join(folder, "session.jsonl");
  const header = { type: "session", version: 3, id: "session", cwd: project, timestamp: "2026-01-01T00:00:00Z", title: "Original" };
  const save = (entries, customHeader = header) => writeFileSync(file, [customHeader, ...entries].map(value => JSON.stringify(value)).join("\n") + "\n");
  try { await run({ dir, file, folder, project, header, save }); }
  finally {
    keys.forEach((key, index) => { if (previous[index] === undefined) delete process.env[key]; else process.env[key] = previous[index]; });
    rmSync(dir, { recursive: true, force: true });
  }
}

test("literal Unicode body search ignores wildcard syntax and nonplaintext payloads", async () => fixture(async ({ dir, save, project }) => {
  save([
    message("u", null, "İstanbul 日本語 CAFÉ literal %_ [needle] ς ſuffix"),
    message("a", "u", [{ type: "text", text: "café" }, { type: "thinking", thinking: "private-secret" }, { type: "image", data: "private-secret" }, { type: "text", hidden: true, text: "private-secret" }], "assistant"),
    message("t", "a", [{ type: "text", text: "tool café" }], "toolResult"),
    message("hidden", "t", "private-secret", "user", { hidden: true }),
    message("custom", "hidden", "private-secret", "custom"),
  ]);
  assert.deepEqual((await searchSessions({ query: "CAFÉ", projectRoot: project })).matches.map(m => m.entryId).sort(), ["a", "t", "u"]);
  for (const query of ["%_", "[needle]", "日本語", "i\u0307stanbul", "Σ", "Suffix"]) assert.equal((await searchSessions({ query })).matches[0].entryId, "u");
  assert.deepEqual((await searchSessions({ query: "private-secret" })).matches, []);
  const cache = join(dir, ".ompgui-search");
  const databases = readdirSync(cache).filter(name => name.endsWith(".sqlite"));
  assert.equal(databases.length, 1);
  for (const name of databases) {
    const file = join(cache, name);
    assert.equal(statSync(file).mode & 0o777, 0o600);
    assert.equal(readFileSync(file).includes(Buffer.from("private-secret")), false);
  }
  assert.equal((await searchSessions({ query: "café", from: "2026-01-02", to: "2026-01-03" })).matches.length, 3);
  assert.deepEqual((await searchSessions({ query: "café", to: "2026-01-02T12:00:00Z" })).matches, []);
}));

test("fallback titles exclude hidden first messages and metadata summaries", async () => fixture(async ({ dir, save, header }) => {
  const untitled = { ...header, title: undefined };
  save([
    message("hidden", null, "hiddenfirstsecret", "user", { hidden: true }),
    message("developer", "hidden", "developersecret", "developer"),
    message("visible", "developer", "visiblelater needle"),
  ], { ...untitled, shortSummary: "summarysecret" });
  const result = await searchSessions({ query: "needle" });
  assert.equal(result.matches[0].sessionName, "visiblelater needle");
  assert.equal((await searchSessionContext({ id: "session", entryId: "visible" })).sessionName, "visiblelater needle");
  const cache = join(dir, ".ompgui-search");
  for (const name of readdirSync(cache)) {
    const bytes = readFileSync(join(cache, name));
    for (const secret of ["hiddenfirstsecret", "developersecret", "summarysecret"]) assert.equal(bytes.includes(Buffer.from(secret)), false);
  }
}));

test("warm search paginates literal matches across yielding candidate batches", async () => fixture(async ({ save }) => {
  save(Array.from({ length: 400 }, (_, index) => message(String(index).padStart(4, "0"), null, index % 97 === 0 ? "needle" : "unrelated text")));
  await searchSessions({ query: "warm index" });
  const ids = [];
  let cursor;
  do {
    const result = await searchSessions({ query: "needle", limit: 2, cursor });
    ids.push(...result.matches.map(match => match.entryId));
    cursor = result.nextCursor;
  } while (cursor);
  assert.deepEqual(ids, ["0000", "0097", "0194", "0291", "0388"]);
}));

test("refresh covers append, fixed title rename, rewrite, truncate, path rename and delete", async () => fixture(async ({ file, folder, save }) => {
  save([message("one", null, "needle old")]);
  assert.equal((await searchSessions({ query: "needle" })).matches.length, 1);
  appendFileSync(file, JSON.stringify(message("two", "one", "needle appended")) + "\n");
  const first = await searchSessions({ query: "needle", limit: 1 });
  assert.ok(first.nextCursor);
  assert.notEqual((await searchSessions({ query: "needle", limit: 1, cursor: first.nextCursor })).matches[0].entryId, first.matches[0].entryId);
  assert.equal(setSessionTitle(file, "Renamed", "user"), true);
  assert.equal((await searchSessions({ query: "needle" })).matches[0].sessionName, "Renamed");
  await assert.rejects(searchSessions({ query: "needle", limit: 1, cursor: first.nextCursor }), error => error.status === 400);
  save([message("three", null, "replacement")]);
  assert.deepEqual((await searchSessions({ query: "needle" })).matches, []);
  assert.equal((await searchSessions({ query: "replacement" })).matches[0].entryId, "three");
  save([]);
  assert.deepEqual((await searchSessions({ query: "replacement" })).matches, []);
  save([message("four", null, "moved")]);
  const moved = join(folder, "renamed.jsonl");
  renameSync(file, moved);
  assert.equal((await searchSessions({ query: "moved" })).matches[0].entryId, "four");
  rmSync(moved);
  assert.deepEqual((await searchSessions({ query: "moved" })).matches, []);
  await assert.rejects(searchSessionContext({ id: "session", entryId: "four" }), error => error.status === 404);
}));

test("context follows matched ancestor branch, including nonmessage links, not active leaf", async () => fixture(async ({ save }) => {
  save([
    message("root", null, "root text"),
    message("old", "root", "inactive needle", "assistant"),
    { type: "model_change", id: "model", parentId: "old", timestamp: "2026-01-02T12:00:00Z" },
    message("tool", "model", "tool needle", "toolResult"),
    message("active", "root", "different active leaf"),
  ]);
  const context = await searchSessionContext({ id: "session", entryId: "tool" });
  assert.deepEqual(context.messages.map(m => m.entryId), ["root", "old", "tool"]);
  assert.equal(context.leafId, "tool");
  assert.equal(context.matchIndex, 2);
  assert.equal(context.hasMoreAfter, false);
  assert.equal(context.hasMoreBefore, false);
  await assert.rejects(searchSessionContext({ id: "session", entryId: "missing" }), error => error.status === 404);
  save(Array.from({ length: 24 }, (_, index) => message(`m${index}`, index ? `m${index - 1}` : null, "text")));
  const bounded = await searchSessionContext({ id: "session", entryId: "m23" });
  assert.equal(bounded.messages.length, 21);
  assert.equal(bounded.messages[0].entryId, "m3");
  assert.equal(bounded.hasMoreBefore, true);
}));

test("legacy linear migration has stable derived IDs and excludes hook messages", async () => fixture(async ({ save, header }) => {
  save([message("ignored", "wrong", "legacy needle"), message("ignored", null, "hook secret", "hookMessage"), message("ignored", null, "legacy second")], { ...header, version: 1 });
  const match = (await searchSessions({ query: "legacy second" })).matches[0];
  assert.equal(match.entryId, "legacy-3");
  assert.deepEqual((await searchSessionContext({ id: "session", entryId: match.entryId })).messages.map(m => m.entryId), ["legacy-1", "legacy-3"]);
  assert.deepEqual((await searchSessions({ query: "hook secret" })).matches, []);
}));

test("canonical roots isolate profiles and never reuse another profile's matching ID", async () => fixture(async ({ dir, save, project }) => {
  save([message("one", null, "default-only")]);
  assert.equal((await searchSessions({ query: "default-only" })).matches.length, 1);
  const other = join(dir, "other-agent");
  process.env.PI_CODING_AGENT_DIR = other;
  process.env.OMP_PROFILE = "search-test";
  const folder = join(getSessionsDir(), "fixture");
  mkdirSync(folder, { recursive: true });
  writeFileSync(join(folder, "other.jsonl"), [
    { type: "session", version: 3, id: "session", cwd: project, timestamp: "2026-01-01T00:00:00Z" }, message("one", null, "other-only"),
  ].map(JSON.stringify).join("\n") + "\n");
  assert.deepEqual((await searchSessions({ query: "default-only" })).matches, []);
  assert.equal((await searchSessionContext({ id: "session", entryId: "one" })).messages[0].content, "other-only");
  process.env.PI_CODING_AGENT_DIR = dir;
  process.env.OMP_PROFILE = "";
  assert.deepEqual((await searchSessions({ query: "other-only" })).matches, []);
  assert.equal(statSync(join(dir, ".ompgui-search")).mode & 0o777, 0o700);
}));

test("invalid query, date, limit and cursor are actionable client errors", async () => {
  for (const args of [
    { query: "" }, { query: "   " }, { query: "a".repeat(501) },
    { query: "a", limit: 51 }, { query: "a", limit: 1.5 },
    { query: "a", from: "2026-02-30" }, { query: "a", from: "2026-01-01T00:00:00" },
    { query: "a", from: "2026-01-02", to: "2026-01-01" },
    { query: "a", cursor: "%%%" }, { query: "a", cursor: Buffer.from("{}").toString("base64url") },
  ]) await assert.rejects(searchSessions(args), error => error instanceof SessionSearchError && error.status === 400);
});
