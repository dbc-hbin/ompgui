import assert from "node:assert/strict";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { pairingQrMatrix, pairingQrSvg } = await jiti.import("./qr-svg.ts");

const SAMPLE =
  "ompgui://pair#v=1&url=wss%3A%2F%2Fmac.example.ts.net%2Frelay&sid=s_abcDEF1234567890&secret=sekritvalue_0123456789abcdefghijk";

test("encodes a pairing URI into a square matrix", () => {
  const matrix = pairingQrMatrix(SAMPLE);
  assert.ok(matrix);
  assert.ok(matrix.length >= 21);
  assert.ok(matrix.every((row) => row.length === matrix.length));
  const dark = matrix.flat().filter(Boolean).length;
  assert.ok(dark > 0);
});

test("renders SVG without a remote image URL", () => {
  const svg = pairingQrSvg(SAMPLE);
  assert.ok(svg);
  assert.match(svg, /^<svg /);
  assert.match(svg, /viewBox="0 0 \d+ \d+"/);
  assert.equal(/<(?:img|image)\b/i.test(svg), false);
  assert.equal(/https?:\/\/(?!www\.w3\.org\/)/.test(svg), false);
});

test("rejects empty and oversized payloads", () => {
  assert.equal(pairingQrMatrix(""), null);
  assert.equal(pairingQrSvg("   "), null);
  assert.equal(pairingQrMatrix("x".repeat(2049)), null);
});
