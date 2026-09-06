import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url, { tsconfigPaths: true });
const { GET, POST } = await jiti.import("../app/api/files/[...path]/route.ts");
const { NextRequest } = await jiti.import("next/server");

function workspace(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), "omp-file-response-"));
  const previous = globalThis.__piAllowedRootsCache;
  globalThis.__piAllowedRootsCache = { roots: new Set([directory]), expiresAt: Infinity };
  t.after(() => {
    globalThis.__piAllowedRootsCache = previous;
    fs.rmSync(directory, { recursive: true, force: true });
  });
  return directory;
}

function getFile(file, type = "read", range) {
  return GET(new NextRequest(`http://localhost/api/files/test?type=${type}`, {
    headers: range ? { range } : {},
  }), { params: Promise.resolve({ path: file.split(path.sep).filter(Boolean) }) });
}

function upload(directory, conflict, contents = "replacement") {
  const form = new FormData();
  form.append("files", new File([contents], "existing.txt"));
  return POST(new NextRequest(`http://localhost/api/files/test?conflict=${conflict}`, {
    method: "POST", body: form,
  }), { params: Promise.resolve({ path: directory.split(path.sep).filter(Boolean) }) });
}

test("SVG bytes remain previewable but direct responses forbid scripts and receive an opaque sandbox origin", async (t) => {
  const file = path.join(workspace(t), "active.svg");
  const svg = '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(document.domain)</script><rect width="20" height="20" fill="red"/></svg>';
  fs.writeFileSync(file, svg);
  for (const type of ["read", "download"]) {
    const response = await getFile(file, type);
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/svg+xml");
    assert.equal(response.headers.get("x-content-type-options"), "nosniff");
    const directives = response.headers.get("content-security-policy").split(";").map((entry) => entry.trim());
    assert.ok(directives.includes("script-src 'none'"));
    assert.ok(directives.includes("sandbox"));
    assert.equal(await response.text(), svg);
  }
});

test("file byte ranges preserve content, suffix reads and unsatisfiable responses", async (t) => {
  const file = path.join(workspace(t), "sample.pdf");
  fs.writeFileSync(file, "0123456789");
  const middle = await getFile(file, "read", "bytes=2-5");
  assert.equal(middle.status, 206);
  assert.equal(middle.headers.get("content-range"), "bytes 2-5/10");
  assert.equal(middle.headers.get("content-length"), "4");
  assert.equal(await middle.text(), "2345");
  const suffix = await getFile(file, "read", "bytes=-3");
  assert.equal(suffix.status, 206);
  assert.equal(await suffix.text(), "789");
  const invalid = await getFile(file, "read", "bytes=10-20");
  assert.equal(invalid.status, 416);
  assert.equal(invalid.headers.get("content-range"), "bytes */10");
  assert.equal(await invalid.text(), "");
});

test("canceling a slow download closes its file descriptor before reading the whole file", async (t) => {
  const file = path.join(workspace(t), "large.bin");
  fs.writeFileSync(file, Buffer.alloc(8 * 1024 * 1024));
  const createReadStream = fs.createReadStream;
  let source;
  t.mock.method(fs, "createReadStream", (...args) => {
    source = createReadStream(...args);
    return source;
  });
  const response = await getFile(file, "download");
  const reader = response.body.getReader();
  const chunk = await reader.read();
  assert.equal(chunk.done, false);
  const closed = Promise.withResolvers();
  source.once("close", closed.resolve);
  await reader.cancel();
  await closed.promise;
  assert.equal(source.closed, true);
  assert.ok(source.bytesRead < fs.statSync(file).size);
});

test("failed overwrite retains original bytes and removes partially written staging files", async (t) => {
  const directory = workspace(t);
  const file = path.join(directory, "existing.txt");
  fs.writeFileSync(file, "original");
  const writeFileSync = fs.writeFileSync;
  t.mock.method(fs, "writeFileSync", (destination, data, options) => {
    if (typeof destination === "number" || destination === file) {
      writeFileSync(destination, data.subarray(0, 2), options);
      throw new Error("simulated disk full");
    }
    return writeFileSync(destination, data, options);
  });
  const response = await upload(directory, "overwrite");
  assert.equal(response.status, 207);
  const result = await response.json();
  assert.deepEqual(result.uploaded, []);
  assert.equal(result.errors[0].name, "existing.txt");
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  assert.deepEqual(fs.readdirSync(directory), ["existing.txt"]);
});

test("conflict error and skip retain files while successful overwrite commits replacement bytes", async (t) => {
  const directory = workspace(t);
  const file = path.join(directory, "existing.txt");
  fs.writeFileSync(file, "original");
  assert.equal((await upload(directory, "error")).status, 409);
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  const skipped = await upload(directory, "skip");
  assert.deepEqual((await skipped.json()).skipped, ["existing.txt"]);
  assert.equal(fs.readFileSync(file, "utf8"), "original");
  const replaced = await upload(directory, "overwrite");
  assert.equal(replaced.status, 200);
  assert.deepEqual((await replaced.json()).uploaded, ["existing.txt"]);
  assert.equal(fs.readFileSync(file, "utf8"), "replacement");
  assert.deepEqual(fs.readdirSync(directory), ["existing.txt"]);
});
