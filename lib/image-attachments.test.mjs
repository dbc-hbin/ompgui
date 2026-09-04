import assert from "node:assert/strict";
import test from "node:test";

async function loadSubject() {
  return import("./image-attachments.ts");
}

const image = { type: "image", mimeType: "image/png", data: "YWJj" };

test("calculates padded base64 byte lengths and rejects invalid data", async () => {
  const { getBase64DecodedByteLength } = await loadSubject();

  assert.equal(getBase64DecodedByteLength("YQ=="), 1);
  assert.equal(getBase64DecodedByteLength("YWI="), 2);
  assert.equal(getBase64DecodedByteLength("YWJj"), 3);
  assert.equal(getBase64DecodedByteLength("not base64!"), null);
});

test("rejects invalid, oversized, and too many image attachments", async () => {
  const { MAX_ATTACHED_IMAGE_BYTES, MAX_ATTACHED_IMAGES, validateAgentImages } = await loadSubject();
  const oversizedData = "AAAA".repeat(Math.ceil((MAX_ATTACHED_IMAGE_BYTES + 1) / 3));

  assert.equal(validateAgentImages([image]), null);
  assert.match(validateAgentImages([{ ...image, mimeType: "text/plain" }]), /valid base64 image/);
  assert.match(validateAgentImages([{ ...image, data: oversizedData }]), /10MB/);
  assert.match(validateAgentImages(Array.from({ length: MAX_ATTACHED_IMAGES + 1 }, () => image)), /at most/);
});

test("collects flat and nested tool result images with deduplication", async () => {
  const { collectToolResultImages } = await loadSubject();

  const flat = { type: "image", data: "QUJD", mimeType: "image/png" };
  const nested = { type: "image", source: { type: "base64", data: "RUZH", media_type: "image/jpeg" } };
  const generated = { data: "SU1H", mimeType: "image/png" };
  const generatedNested = { source: { type: "base64", data: "TUVU", media_type: "image/webp" } };
  const images = collectToolResultImages({
    content: [flat, nested, { type: "text", text: "done" }, { type: "image", source: { type: "url", url: "https://x/y.png" } }],
    details: { images: [{ ...flat }, generated, generatedNested, { data: "nope", mimeType: "text/plain" }, null] },
  });

  assert.deepEqual(images, [
    { type: "image", data: "QUJD", mimeType: "image/png" },
    { type: "image", data: "RUZH", mimeType: "image/jpeg" },
    { type: "image", data: "SU1H", mimeType: "image/png" },
    { type: "image", data: "TUVU", mimeType: "image/webp" },
  ]);
});

test("collectToolResultImages tolerates malformed input", async () => {
  const { collectToolResultImages } = await loadSubject();

  assert.deepEqual(collectToolResultImages({}), []);
  assert.deepEqual(collectToolResultImages({ content: "bad", details: null }), []);
  assert.deepEqual(collectToolResultImages({ content: [null, 42, { type: "image" }], details: { images: "bad" } }), []);
});

test("deferred media limits reject counts and byte totals", async () => {
  const {
    MAX_TOOL_RESULT_IMAGES,
    MAX_TOOL_RESULT_IMAGE_BYTES,
    MAX_TOOL_RESULT_IMAGES_TOTAL_BYTES,
    TOOL_RESULT_IMAGES_TOO_LARGE_CODE,
    ToolResultImagesTooLargeError,
    assertToolResultImageSizesWithinLimits,
  } = await loadSubject();

  assertToolResultImageSizesWithinLimits([]);
  assertToolResultImageSizesWithinLimits([1, MAX_TOOL_RESULT_IMAGE_BYTES]);
  assert.throws(() => assertToolResultImageSizesWithinLimits(new Array(MAX_TOOL_RESULT_IMAGES + 1).fill(1)), (error) => error instanceof ToolResultImagesTooLargeError && error.code === TOOL_RESULT_IMAGES_TOO_LARGE_CODE && error.reason === "count");
  assert.throws(() => assertToolResultImageSizesWithinLimits([MAX_TOOL_RESULT_IMAGE_BYTES + 1]), (error) => error instanceof ToolResultImagesTooLargeError && error.reason === "per_image");
  assert.throws(
    () => assertToolResultImageSizesWithinLimits([
      MAX_TOOL_RESULT_IMAGE_BYTES,
      MAX_TOOL_RESULT_IMAGE_BYTES,
      MAX_TOOL_RESULT_IMAGES_TOTAL_BYTES - (2 * MAX_TOOL_RESULT_IMAGE_BYTES) + 1,
    ]),
    (error) => error instanceof ToolResultImagesTooLargeError && error.reason === "total",
  );
});
