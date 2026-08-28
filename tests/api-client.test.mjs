import test from "node:test";
import assert from "node:assert/strict";

import {
  analyzeWithAI,
  getApiEndpoint,
  setApiEndpoint,
} from "../src/api-client.mjs";

const endpoint = "https://abc-analysis-api.codex-ai-abc-workbench.workers.dev/analyze";

function validScene(overrides = {}) {
  return {
    title: "场景",
    a: "起因",
    b: "行动",
    c: "结果",
    sourceQuote: "原文",
    sourceLocation: "无时间戳",
    evidenceLevel: "高",
    riskType: "无",
    limitations: "",
    ...overrides,
  };
}

function jsonResponse(payload, { status = 200 } = {}) {
  return new Response(JSON.stringify(payload), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}

test("analyzeWithAI requires endpoint configuration", async () => {
  await assert.rejects(
    analyzeWithAI({ nickname: "小青", date: "2026-08-28", transcript: "内容" }, async () => {}),
    /配置未完成/,
  );
});

test("setApiEndpoint accepts only the exact production endpoint", () => {
  setApiEndpoint(endpoint);
  assert.equal(getApiEndpoint(), endpoint);
});

test("setApiEndpoint rejects disallowed URL forms and preserves the prior endpoint", () => {
  for (const value of [
    "",
    "   ",
    "http://abc-worker.example.workers.dev/analyze",
    "javascript:alert(1)",
    "not a url",
    "https://abc-worker.example.workers.dev/other",
    "https://workers.dev/analyze",
    "https://127.0.0.1/analyze",
    "https://10.0.0.1/analyze",
    "https://localhost/analyze",
    "https://example.com/analyze",
    "https://abc-worker.example.workers.dev/analyze",
    "https://workers.dev.example.com/analyze",
    "https://user:password@abc-analysis-api.codex-ai-abc-workbench.workers.dev/analyze",
    "https://abc-analysis-api.codex-ai-abc-workbench.workers.dev:443/analyze",
    "https://abc-analysis-api.codex-ai-abc-workbench.workers.dev:8443/analyze",
    "https://abc-analysis-api.codex-ai-abc-workbench.workers.dev/analyze?debug=1",
    "https://abc-analysis-api.codex-ai-abc-workbench.workers.dev/analyze#details",
  ]) {
    assert.throws(() => setApiEndpoint(value), /有效的 HTTPS.*\/analyze/);
    assert.equal(getApiEndpoint(), endpoint);
  }
});

test("analyzeWithAI posts JSON to the exact endpoint without credentials", async () => {
  setApiEndpoint(endpoint);
  const input = { nickname: "小青", date: "2026-08-28", transcript: "课堂内容包含原文" };
  let request;
  const result = await analyzeWithAI(input, async (url, options) => {
    request = { url, options };
    return jsonResponse({ ok: true, mode: "ai", scenes: [validScene()] });
  });

  assert.equal(request.url, endpoint);
  assert.equal(request.options.method, "POST");
  assert.equal(request.options.credentials, "omit");
  assert.equal(request.options.headers["Content-Type"], "application/json");
  assert.deepEqual(JSON.parse(request.options.body), input);
  assert.ok(request.options.signal instanceof AbortSignal);
  assert.deepEqual(result, { mode: "ai", scenes: [{ id: "scene-1", ...validScene(), revised: false }] });
});

test("analyzeWithAI returns a fresh object containing only mode and scenes", async () => {
  setApiEndpoint(endpoint);
  const payload = { ok: true, mode: "ai", scenes: [], secret: "do not return" };
  const result = await analyzeWithAI({}, async () => jsonResponse(payload));
  assert.deepEqual(result, { mode: "ai", scenes: [] });
  assert.notEqual(result, payload);
  assert.notEqual(result.scenes, payload.scenes);
});

test("non-2xx maps a known server code to a local message", async () => {
  setApiEndpoint(endpoint);
  await assert.rejects(
    analyzeWithAI({}, async () => jsonResponse({ message: "private transcript", code: "RATE_LIMITED" }, { status: 429 })),
    (error) => {
      assert.equal(error.message, "请求过于频繁，请稍后重试");
      assert.doesNotMatch(error.message, /private transcript|RATE_LIMITED|429|workers\.dev/);
      return true;
    },
  );
});

test("known error codes use only locally defined Chinese messages", async () => {
  setApiEndpoint(endpoint);
  const cases = [
    ["RATE_LIMITED", "请求过于频繁，请稍后重试"],
    ["INVALID_INPUT", "提交内容无效，请检查后重试"],
    ["CONFIG_ERROR", "AI 分析服务配置异常，请联系管理员"],
    ["AI_UPSTREAM_ERROR", "AI 分析服务暂时不可用，请稍后重试"],
    ["PAYLOAD_TOO_LARGE", "提交内容过长，请精简后重试"],
  ];
  for (const [code, expected] of cases) {
    await assert.rejects(
      analyzeWithAI({}, async () => jsonResponse({ code, message: "DO_NOT_EXPOSE" }, { status: 400 })),
      (error) => {
        assert.equal(error.message, expected);
        assert.doesNotMatch(error.message, /DO_NOT_EXPOSE/);
        return true;
      },
    );
  }
});

test("browser defense-in-depth grounds evidence against its submitted transcript", async () => {
  setApiEndpoint(endpoint);
  const transcript = "[00:12] 学员：真实原话";
  const grounded = await analyzeWithAI({ transcript }, async () => jsonResponse({
    ok: true, mode: "ai", scenes: [validScene({ sourceQuote: "学员：真实原话", sourceLocation: "00:12" })],
  }));
  assert.equal(grounded.scenes[0].sourceQuote, "学员：真实原话");
  assert.equal(grounded.scenes[0].sourceLocation, "00:12");

  const fabricated = await analyzeWithAI({ transcript }, async () => jsonResponse({
    ok: true, mode: "ai", scenes: [validScene({ sourceQuote: "伪造原话", sourceLocation: "09:59" })],
  }));
  assert.equal(fabricated.scenes[0].sourceQuote, "待补充（未能在输入原文中核对）");
  assert.equal(fabricated.scenes[0].sourceLocation, "无时间戳");
  assert.equal(fabricated.scenes[0].evidenceLevel, "低");
});

test("unknown errors never leak endpoint, stack, or transcript from payload.message", async () => {
  setApiEndpoint(endpoint);
  const leaks = [
    "Failed at https://internal.example.com/analyze",
    "Error: upstream failed at worker.js:42",
    "Transcript excerpt: 孩子说我不想去学校",
  ];
  for (const message of leaks) {
    await assert.rejects(
      analyzeWithAI({}, async () => jsonResponse({ code: "UNKNOWN", message }, { status: 500 })),
      (error) => {
        assert.equal(error.message, "AI 分析服务暂时不可用，请稍后重试");
        assert.doesNotMatch(error.message, /internal\.example|worker\.js|孩子说|不想去学校/);
        return true;
      },
    );
  }
});

test("prototype property names are not accepted as known error codes", async () => {
  setApiEndpoint(endpoint);
  for (const code of ["constructor", "toString", "__proto__"]) {
    await assert.rejects(
      analyzeWithAI({}, async () => jsonResponse({ code, message: "INHERITED_VALUE" }, { status: 500 })),
      (error) => {
        assert.equal(error.message, "AI 分析服务暂时不可用，请稍后重试");
        assert.doesNotMatch(error.message, /INHERITED_VALUE|function|native code|Object/);
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

test("declared oversized response is rejected before its body is parsed", async () => {
  setApiEndpoint(endpoint);
  const response = new Response("{}", {
    headers: { "Content-Length": String(256 * 1024 + 1) },
  });
  await assert.rejects(analyzeWithAI({}, async () => response), /返回数据无效/);
});

test("chunked response exceeding 256 KiB is rejected without leaking body", async () => {
  setApiEndpoint(endpoint);
  const secret = "SECRET_TRANSCRIPT";
  const chunk = new TextEncoder().encode("x".repeat(128 * 1024) + secret);
  const response = new Response(new ReadableStream({
    start(controller) {
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.enqueue(chunk);
      controller.close();
    },
  }));
  await assert.rejects(analyzeWithAI({}, async () => response), (error) => {
    assert.match(error.message, /返回数据无效/);
    assert.doesNotMatch(error.message, /SECRET_TRANSCRIPT|xxx/);
    return true;
  });
});

test("ok:false maps a known code without using its free-form message", async () => {
  setApiEndpoint(endpoint);
  await assert.rejects(
    analyzeWithAI({}, async () => jsonResponse({ ok: false, message: "private stack", code: "CONFIG_ERROR" })),
    (error) => {
      assert.equal(error.message, "AI 分析服务配置异常，请联系管理员");
      assert.doesNotMatch(error.message, /private stack|CONFIG_ERROR/);
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

test("success scenes are rebuilt from an allowlist with stable IDs", async () => {
  setApiEndpoint(endpoint);
  const scene = validScene({
    id: "hostile-id",
    revised: true,
    forbidden: "secret",
    nested: { secret: true },
  });
  const result = await analyzeWithAI({ transcript: "原文" }, async () => jsonResponse({ ok: true, mode: "ai", scenes: [scene] }));
  assert.deepEqual(result.scenes, [{ id: "scene-1", ...validScene(), revised: false }]);
  assert.notEqual(result.scenes[0], scene);
});

test("success rejects primitive scenes, more than 20 scenes, and oversized strings", async () => {
  setApiEndpoint(endpoint);
  const invalidScenes = [
    ["primitive"],
    Array.from({ length: 21 }, () => validScene()),
    [validScene({ title: "x".repeat(201) })],
    [validScene({ sourceLocation: "x".repeat(201) })],
    [validScene({ a: "x".repeat(5001) })],
    [validScene({ b: "x".repeat(5001) })],
    [validScene({ c: "x".repeat(5001) })],
    [validScene({ sourceQuote: "x".repeat(12001) })],
    [validScene({ limitations: "x".repeat(2001) })],
    [validScene({ title: 42 })],
  ];
  for (const scenes of invalidScenes) {
    await assert.rejects(
      analyzeWithAI({}, async () => jsonResponse({ ok: true, mode: "ai", scenes })),
      /返回数据无效/,
    );
  }
});

test("success normalizes hostile enum values conservatively", async () => {
  setApiEndpoint(endpoint);
  const result = await analyzeWithAI({ transcript: "原文" }, async () => jsonResponse({
    ok: true, mode: "ai", scenes: [validScene({ evidenceLevel: "确定", riskType: "焦虑" })],
  }));
  assert.equal(result.scenes[0].evidenceLevel, "低");
  assert.equal(result.scenes[0].riskType, "安全待确认");
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

test("timeout during a stalled response body read reports timeout", async () => {
  setApiEndpoint(endpoint);
  let observedSignal;
  const fetchWithStalledBody = async (_url, { signal }) => {
    observedSignal = signal;
    return new Response(new ReadableStream({ pull() { return new Promise(() => {}); } }));
  };
  await assert.rejects(analyzeWithAI({}, fetchWithStalledBody, 10), /AI 分析超时，请稍后重试/);
  assert.equal(observedSignal.aborted, true);
});

test("timer is cleared after success and failure", async () => {
  setApiEndpoint(endpoint);
  const handles = [];
  const cleared = [];
  const timers = {
    setTimeoutImpl(callback, delay) {
    const handle = { callback, delay };
    handles.push(handle);
    return handle;
    },
    clearTimeoutImpl(handle) {
    cleared.push(handle);
    },
  };

  await analyzeWithAI({}, async () => jsonResponse({ ok: true, mode: "ai", scenes: [] }), 1000, timers);
  await assert.rejects(
    analyzeWithAI({}, async () => { throw new Error("network detail"); }, 1000, timers),
    /无法连接 AI 分析服务/,
  );
  assert.equal(handles.length, 2);
  assert.deepEqual(cleared, handles);
});
