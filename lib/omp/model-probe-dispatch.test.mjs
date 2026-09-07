import assert from "node:assert/strict";
import { createServer, request } from "node:http";
import test from "node:test";
import { createJiti } from "jiti";

const jiti = createJiti(import.meta.url);
const { createModelProbeDispatch, resolveModelProbeEndpoint } = await jiti.import("./model-probe-dispatch.ts");

test("Anthropic root and versioned bases produce one native messages version segment", () => {
  const root = resolveModelProbeEndpoint("https://api.anthropic.com", "anthropic-messages", "claude-sonnet");
  const versioned = resolveModelProbeEndpoint("https://api.anthropic.com/v1/", "anthropic-messages", "claude-sonnet");
  assert.equal(root.href, "https://api.anthropic.com/");
  assert.equal(versioned.href, root.href);
  assert.equal(new URL("v1/messages", versioned).pathname, "/v1/messages");
});

test("Azure chat resource bases retain an encoded deployment and API version before loopback routing", () => {
  const endpoint = resolveModelProbeEndpoint("https://resource.openai.azure.com/openai/", "openai-completions", "team/model name");
  assert.equal(endpoint.origin, "https://resource.openai.azure.com");
  assert.equal(endpoint.pathname, "/openai/deployments/team%2Fmodel%20name");
  assert.equal(endpoint.searchParams.get("api-version"), "2024-10-21");
});

test("a bare Azure origin receives one separator before its deployment path", () => {
  const endpoint = resolveModelProbeEndpoint("https://resource.openai.azure.com", "openai-completions", "probe-exact");
  assert.equal(endpoint.href, "https://resource.openai.azure.com/deployments/probe-exact?api-version=2024-10-21");
});

test("Azure chat explicit deployment bases are not replaced by the model ID", () => {
  const endpoint = resolveModelProbeEndpoint("https://resource.openai.azure.com/openai/deployments/existing/", "openai-completions", "different-model");
  assert.equal(endpoint.pathname, "/openai/deployments/existing");
  assert.equal(endpoint.searchParams.get("api-version"), "2024-10-21");
});

async function fixture(t, handler) {
  const server = createServer(handler);
  const listening = Promise.withResolvers();
  server.once("error", listening.reject);
  server.listen(0, "127.0.0.1", listening.resolve);
  await listening.promise;
  t.after(async () => {
    const closed = Promise.withResolvers();
    server.close(closed.resolve);
    server.closeAllConnections();
    await closed.promise;
  });
  return `http://127.0.0.1:${server.address().port}`;
}

function post(url, options = {}) {
  const response = Promise.withResolvers();
  const outgoing = request(url, { method: "POST", ...options, agent: false }, (incoming) => {
    let body = "";
    incoming.setEncoding("utf8");
    incoming.on("data", (chunk) => { body += chunk; });
    incoming.on("error", response.reject);
    incoming.on("end", () => response.resolve({ status: incoming.statusCode, body, headers: incoming.headers }));
  });
  outgoing.on("error", response.reject);
  outgoing.end("probe");
  return response.promise;
}

test("concurrent requests consume one upstream dispatch even when the provider asks for a retry", async (t) => {
  const received = [];
  const target = await fixture(t, (incoming, outgoing) => {
    received.push(incoming.url);
    incoming.resume();
    outgoing.writeHead(429, { "retry-after": "0" });
    outgoing.end("retry requested");
  });
  const gate = await createModelProbeDispatch(`${target}/v1`);
  t.after(() => gate.close());
  const responses = await Promise.all([post(`${gate.baseUrl}/chat/completions`), post(`${gate.baseUrl}/chat/completions`)]);
  assert.deepEqual(responses.map((response) => response.status).sort(), [403, 429]);
  assert.deepEqual(received, ["/v1/chat/completions"]);
  assert.equal((await post(`${gate.baseUrl}/chat/completions`)).status, 403);
  assert.equal(received.length, 1);
});

test("rejected authorization preserves the single dispatch for a later authorized prompt", async (t) => {
  let requests = 0;
  let authorized = false;
  const target = await fixture(t, (incoming, outgoing) => {
    requests++;
    incoming.resume();
    outgoing.end("accepted");
  });
  const gate = await createModelProbeDispatch(target, {
    expectedPath: "/completion",
    authorizeDispatch() { if (!authorized) throw new Error("prompt not authorized"); },
  });
  t.after(() => gate.close());
  assert.equal((await post(`${gate.baseUrl}/completion`)).status, 502);
  assert.equal(requests, 0);
  authorized = true;
  assert.equal((await post(`${gate.baseUrl}/completion`)).status, 200);
  assert.equal((await post(`${gate.baseUrl}/completion`)).status, 403);
  assert.equal(requests, 1);
});

test("GET discovery does not spend the POST budget and eligible query parameters survive forwarding", async (t) => {
  const received = [];
  const target = await fixture(t, (incoming, outgoing) => {
    received.push({ method: incoming.method, url: incoming.url });
    incoming.resume();
    outgoing.end("accepted");
  });
  const gate = await createModelProbeDispatch(target, { expectedPath: "/v1/messages" });
  t.after(() => gate.close());
  assert.equal((await post(`${gate.baseUrl}/v1/messages`, { method: "GET" })).status, 403);
  assert.deepEqual(received, []);
  assert.equal((await post(`${gate.baseUrl}/v1/messages?beta=true`)).status, 200);
  assert.deepEqual(received, [{ method: "POST", url: "/v1/messages?beta=true" }]);
});

test("approved target query survives native query forwarding and wins conflicting values", async (t) => {
  const received = [];
  const target = await fixture(t, (incoming, outgoing) => {
    received.push(new URL(incoming.url, "http://localhost"));
    incoming.resume();
    outgoing.end("accepted");
  });
  const gate = await createModelProbeDispatch(`${target}/openai/deployments/approved?api-version=2024-10-21&target-only=approved`, {
    expectedPath: "/chat/completions",
  });
  t.after(() => gate.close());
  assert.equal((await post(`${gate.baseUrl}/chat/completions?api-version=native&api-version=other&beta=true`)).status, 200);
  assert.equal(received.length, 1);
  assert.equal(received[0].pathname, "/openai/deployments/approved/chat/completions");
  assert.deepEqual([...received[0].searchParams].sort(), [
    ["api-version", "2024-10-21"],
    ["beta", "true"],
    ["target-only", "approved"],
  ]);
});

test("candidate upstream credentials override mixed-case native credentials without overriding transport headers", async (t) => {
  let received;
  const target = await fixture(t, (incoming, outgoing) => {
    received = incoming.headers;
    incoming.resume();
    outgoing.end("accepted");
  });
  const gate = await createModelProbeDispatch(target, {
    upstreamHeaders: { aUtHoRiZaTiOn: "Bearer candidate-secret", "X-Api-Key": "candidate-key", Host: "wrong.example", Connection: "keep-alive" },
  });
  t.after(() => gate.close());
  assert.equal((await post(`${gate.baseUrl}/completion`, {
    headers: { AUTHORIZATION: "Bearer native-secret", "x-API-key": "native-key" },
  })).status, 200);
  assert.equal(received.authorization, "Bearer candidate-secret");
  assert.equal(received["x-api-key"], "candidate-key");
  assert.equal(received.host, new URL(target).host);
  assert.equal(received.connection, "close");
  assert.doesNotMatch(JSON.stringify(received), /native-secret|native-key|wrong\.example/);
});

test("redirect responses cannot expose a route around the dispatch gate", async (t) => {
  let redirectedRequests = 0;
  const destination = await fixture(t, (incoming, outgoing) => {
    redirectedRequests++;
    incoming.resume();
    outgoing.end("escaped");
  });
  let requests = 0;
  const target = await fixture(t, (incoming, outgoing) => {
    requests++;
    incoming.resume();
    outgoing.writeHead(307, { location: `${destination}/escape` });
    outgoing.end();
  });
  const gate = await createModelProbeDispatch(target);
  t.after(() => gate.close());
  const response = await post(`${gate.baseUrl}/completion`);
  assert.equal(response.status, 502);
  assert.equal(response.headers.location, undefined);
  assert.equal(requests, 1);
  assert.equal(redirectedRequests, 0);
});

test("synchronous cancellation at dispatch checkpoint sends nothing upstream", async (t) => {
  let requests = 0;
  const target = await fixture(t, (incoming, outgoing) => {
    requests++;
    incoming.resume();
    outgoing.end("must not arrive");
  });
  const controller = new AbortController();
  let cancelAtDispatch = false;
  const gate = await createModelProbeDispatch(target, {
    signal: controller.signal,
    assertActive() { if (cancelAtDispatch) controller.abort(); },
  });
  t.after(() => gate.close());
  cancelAtDispatch = true;
  const response = await post(`${gate.baseUrl}/completion`).catch(() => null);
  if (response) assert.equal(response.status, 502);
  await gate.close();
  assert.equal(requests, 0);
});
