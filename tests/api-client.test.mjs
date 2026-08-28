import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeWithAI,
  getApiEndpoint,
  setApiEndpoint,
} from "../src/api-client.mjs";

const endpoint = "https://abc-worker.example.workers.dev/analyze";

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("setApiEndpoint accepts a valid HTTPS /analyze Worker URL", () => {
  setApiEndpoint(endpoint);
  assert.equal(getApiEndpoint(), endpoint);
});

test("setApiEndpoint rejects empty, HTTP, javascript, malformed, and wrong-path URLs", () => {
  for (const value of [
    "",
    "   ",
    "http://abc-worker.example.workers.dev/analyze",
    "javascript:alert(1)",
    "not a url",
    "https://abc-worker.example.workers.dev/other",
  ]) {
    assert.throws(() => setApiEndpoint(value), /有效的 HTTPS.*\/analyze/);
  }
});

test("analyzeWithAI requires endpoint configuration", async () => {
  assert.throws(() => setApiEndpoint(""));
  await assert.rejects(
    analyzeWithAI({ nickname: "小青", date: "2026-08-28", transcript: "内容" }, async () => {}),
    /配置未完成/,
  );
});

test("analyzeWithAI posts JSON to the exact endpoint without credentials", async () => {
  setApiEndpoint(endpoint);
  const input = { nickname: "小青", date: "2026-08-28", transcript: "课堂内容" };
  let request;
  const result = await analyzeWithAI(input, async (url, options) => {
    request = { url, options };
    return jsonResponse({ ok: true, mode: "ai", scenes: [{ title: "场景" }] });
  });

  assert.equal(request.url, endpoint);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), input);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(result, { mode: "ai", scenes: [{ title: "场景" }] });
});

test("analyzeWithAI returns a fresh object containing only mode and scenes", async () => {
  setApiEndpoint(endpoint);
  const payload = { ok: true, mode: "ai", scenes: [], secret: "do not return" };
  const result = await analyzeWithAI({}, async () => jsonResponse(payload));
  assert.deepEqual(result, { mode: "ai", scenes: [] });
  assert.notEqual(result, payload);
  assert.notEqual(result.scenes, payload.scenes);
});

test("non-2xx exposes a reasonable server message but never raw response content", async () => {
  setApiEndpoint(endpoint);
  await assert.rejects(
    analyzeWithAI({}, async () => jsonResponse({ message: "今日请求次数已用完", code: "RATE_LIMIT", raw: "private transcript" }, { status: 429 })),
    (error) => {
      assert.match(error.message, /今日请求次数已用完/);
      assert.doesNotMatch(error.message, /private transcript|RATE_LIMIT|429|workers\.dev/);
      return true;
    },
  );
});

test("non-2xx rejects unsafe or oversized server messages with a generic error", async () => {
  setApiEndpoint(endpoint);
  for (const message of ["x".repeat(300), { nested: true }]) {
    await assert.rejects(
      analyzeWithAI({}, async () => jsonResponse({ message, raw: "SECRET_BODY" }, { status: 500 })),
      (error) => {
        assert.match(error.message, /AI 分析服务暂时不可用/);
        assert.doesNotMatch(error.message, /SECRET_BODY|xxx/);
        return true;
      },
    );
  }
});

test("invalid JSON throws a safe user-facing error", async () => {
  setApiEndpoint(endpoint);
  await assert.rejects(
    analyzeWithAI({}, async () => new Response("raw secret body", { status: 200 })),
    (error) => {
      assert.match(error.message, /返回数据无效/);
      assert.doesNotMatch(error.message, /raw secret body|Unexpected token/);
      return true;
    },
  );
});

test("ok:false uses only a safe short message", async () => {
  setApiEndpoint(endpoint);
  await assert.rejects(
    analyzeWithAI({}, async () => jsonResponse({ ok: false, message: "请稍后再试", code: "INTERNAL_DETAIL" })),
    (error) => {
      assert.equal(error.message, "请稍后再试");
      assert.doesNotMatch(error.message, /INTERNAL_DETAIL/);
      return true;
    },
  );
});

test("wrong mode and missing scenes throw safe response errors", async () => {
  setApiEndpoint(endpoint);
  for (const payload of [
    { ok: true, mode: "local", scenes: [] },
    { ok: true, mode: "ai" },
    { ok: true, mode: "ai", scenes: {} },
  ]) {
    await assert.rejects(
      analyzeWithAI({}, async () => jsonResponse(payload)),
      /AI 分析服务返回数据无效/,
    );
  }
});

test("timeout aborts a pending fetch and throws a safe timeout error", async () => {
  setApiEndpoint(endpoint);
  let observedSignal;
  const pendingFetch = (_url, { signal }) => {
    observedSignal = signal;
    return new Promise((_resolve, reject) => {
      signal.addEventListener("abort", () => reject(signal.reason), { once: true });
    });
  };

  await assert.rejects(analyzeWithAI({}, pendingFetch, 10), /AI 分析超时，请稍后重试/);
  assert.equal(observedSignal.aborted, true);
});

test("timer is cleared after success and failure", async () => {
  setApiEndpoint(endpoint);
  const originalSetTimeout = globalThis.setTimeout;
  const originalClearTimeout = globalThis.clearTimeout;
  const handles = [];
  const cleared = [];
  globalThis.setTimeout = (callback, delay) => {
    const handle = originalSetTimeout(callback, delay);
    handles.push(handle);
    return handle;
  };
  globalThis.clearTimeout = (handle) => {
    cleared.push(handle);
    return originalClearTimeout(handle);
  };

  try {
    await analyzeWithAI({}, async () => jsonResponse({ ok: true, mode: "ai", scenes: [] }), 1000);
    await assert.rejects(
      analyzeWithAI({}, async () => { throw new Error("network detail"); }, 1000),
      /无法连接 AI 分析服务/,
    );
    assert.equal(handles.length, 2);
    assert.deepEqual(cleared, handles);
  } finally {
    for (const handle of handles) originalClearTimeout(handle);
    globalThis.setTimeout = originalSetTimeout;
    globalThis.clearTimeout = originalClearTimeout;
  }
});
