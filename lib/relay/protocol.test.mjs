import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const {
  parseClientFrame,
  commandFromRelayCmd,
  RELAY_PROTOCOL_VERSION,
} = await jiti.import("./protocol.ts");

test("parses pairing hello and device hello", () => {
  const pairing = parseClientFrame(JSON.stringify({
    op: "hello",
    protocol: RELAY_PROTOCOL_VERSION,
    pairingSecret: "a".repeat(43),
    label: "Pixel",
  }));
  assert.equal(pairing.op, "hello");
  assert.equal(pairing.pairingSecret.length, 43);

  const device = parseClientFrame(JSON.stringify({
    op: "hello",
    protocol: RELAY_PROTOCOL_VERSION,
    deviceId: "d_abcdefghijklmnopqr",
    token: "b".repeat(43),
  }));
  assert.equal(device.op, "hello");
  assert.equal(device.deviceId.startsWith("d_"), true);
});

test("rejects unknown ops and disallowed commands", () => {
  assert.equal(parseClientFrame("{").code, "invalid_json");
  assert.equal(parseClientFrame(JSON.stringify({ op: "explode" })).code, "unknown_op");
  assert.equal(parseClientFrame(JSON.stringify({ op: "hello", protocol: 2 })).code, "protocol");
  assert.equal(parseClientFrame(JSON.stringify({ op: "cmd", req: 1, type: "bash" })).code, "unsupported_command");
  assert.equal(parseClientFrame(JSON.stringify({
    op: "cmd", req: 1, type: "prompt", message: "hi", images: [{ data: "x" }],
  })).code, "invalid_command");
});

test("parses prompt with valid images and usage op", () => {
  const promptWithImg = parseClientFrame(JSON.stringify({
    op: "cmd", req: 2, type: "prompt", message: "look",
    images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
  }));
  assert.equal(promptWithImg.op, "cmd");
  assert.deepEqual(promptWithImg.images, [{ data: "aGVsbG8=", mimeType: "image/png" }]);
  assert.deepEqual(commandFromRelayCmd(promptWithImg), {
    type: "prompt",
    message: "look",
    images: [{ data: "aGVsbG8=", mimeType: "image/png" }],
  });

  const usage = parseClientFrame(JSON.stringify({ op: "usage" }));
  assert.deepEqual(usage, { op: "usage" });
});

test("maps allowed cmds to rpc-manager send bodies", () => {
  const prompt = parseClientFrame(JSON.stringify({ op: "cmd", req: 7, type: "prompt", message: "hi" }));
  assert.deepEqual(commandFromRelayCmd(prompt), { type: "prompt", message: "hi" });
  const abort = parseClientFrame(JSON.stringify({ op: "cmd", req: 8, type: "abort" }));
  assert.deepEqual(commandFromRelayCmd(abort), { type: "abort" });
  const model = parseClientFrame(JSON.stringify({
    op: "cmd", req: 9, type: "set_model", provider: "openai", modelId: "gpt",
  }));
  assert.deepEqual(commandFromRelayCmd(model), { type: "set_model", provider: "openai", modelId: "gpt" });
});

test("parses models.list client frame", () => {
  const frame = parseClientFrame(JSON.stringify({ op: "models.list" }));
  assert.deepEqual(frame, { op: "models.list" });
});

test("parses settings.get and settings.update frames", () => {
  const get = parseClientFrame(JSON.stringify({ op: "settings.get" }));
  assert.deepEqual(get, { op: "settings.get" });

  const update = parseClientFrame(JSON.stringify({ op: "settings.update", settings: { theme: "dark" } }));
  assert.deepEqual(update, { op: "settings.update", settings: { theme: "dark" } });

  const invalid = parseClientFrame(JSON.stringify({ op: "settings.update", settings: "dark" }));
  assert.equal(invalid.code, "invalid_settings");

  const missing = parseClientFrame(JSON.stringify({ op: "settings.update" }));
  assert.equal(missing.code, "invalid_settings");
});

test("relayModelsFrame sanitizes, caps fields, and caps at 80", async () => {
  const { relayModelsFrame, toRelayModelOption } = await jiti.import("./protocol.ts");

  assert.deepEqual(
    toRelayModelOption({ provider: "openai", id: "gpt-5", name: "GPT-5" }),
    { provider: "openai", id: "gpt-5", name: "GPT-5" },
  );
  // name falls back to id.
  assert.deepEqual(
    toRelayModelOption({ provider: "anthropic", id: "claude" }),
    { provider: "anthropic", id: "claude", name: "claude" },
  );
  // missing provider/id or non-objects are dropped.
  assert.equal(toRelayModelOption({ id: "x" }), null);
  assert.equal(toRelayModelOption({ provider: "p" }), null);
  assert.equal(toRelayModelOption(null), null);
  assert.equal(toRelayModelOption("openai/gpt"), null);

  // name capped at 128 chars; provider/id preserved exactly up to 512 chars
  const long = "a".repeat(200);
  const clipped = toRelayModelOption({ provider: long, id: long, name: long });
  assert.equal(clipped.provider.length, 200);
  assert.equal(clipped.id.length, 200);
  assert.equal(clipped.name.length, 128);
  assert.equal(toRelayModelOption({ provider: "a".repeat(513), id: "x" }), null);
  assert.equal(toRelayModelOption({ provider: "x", id: "a".repeat(513) }), null);

  const many = Array.from({ length: 90 }, (_, i) => ({ provider: "p", id: `m-${i}` }));
  const frame = relayModelsFrame([...many, null, { provider: "", id: "" }]);
  assert.equal(frame.op, "models");
  assert.equal(frame.models.length, 80);
  assert.deepEqual(frame.models[0], { provider: "p", id: "m-0", name: "m-0" });

  assert.deepEqual(relayModelsFrame(undefined), { op: "models", models: [] });
});
