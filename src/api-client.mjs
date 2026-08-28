let apiEndpoint = "";

const PRODUCTION_ENDPOINT = "https://abc-analysis-api.codex-ai-abc-workbench.workers.dev/analyze";
const GENERIC_SERVICE_ERROR = "AI 分析服务暂时不可用，请稍后重试";
const INVALID_RESPONSE_ERROR = "AI 分析服务返回数据无效，请稍后重试";
const MAX_RESPONSE_BYTES = 256 * 1024;
const EVIDENCE_LEVELS = new Set(["高", "中", "低"]);
const RISK_TYPES = new Set(["无", "离家", "自伤/轻生", "暴力", "安全待确认"]);
const SCENE_STRING_LIMITS = Object.freeze({
  title: 200,
  a: 5000,
  b: 5000,
  c: 5000,
  sourceQuote: 12000,
  sourceLocation: 200,
  limitations: 2000,
});
const ERROR_MESSAGES = new Map([
  ["RATE_LIMITED", "请求过于频繁，请稍后重试"],
  ["VALIDATION_ERROR", "提交内容无效，请检查后重试"],
  ["CONFIG_ERROR", "AI 分析服务配置异常，请联系管理员"],
  ["AI_UPSTREAM_ERROR", GENERIC_SERVICE_ERROR],
  ["BODY_TOO_LARGE", "提交内容过长，请精简后重试"],
]);

function normalizeEndpoint(value) {
  return typeof value === "string" && value === PRODUCTION_ENDPOINT
    ? PRODUCTION_ENDPOINT
    : null;
}

function messageForErrorCode(payload) {
  return ERROR_MESSAGES.get(payload?.code) ?? GENERIC_SERVICE_ERROR;
}

async function readBoundedResponse(response, signal) {
  const declaredLength = response.headers?.get?.("Content-Length");
  if (/^\d+$/.test(declaredLength ?? "") && Number(declaredLength) > MAX_RESPONSE_BYTES) {
    throw new Error(INVALID_RESPONSE_ERROR);
  }
  if (!response.body) return "";

  const reader = response.body.getReader();
  const chunks = [];
  let totalBytes = 0;
  let rejectAbort;
  const aborted = new Promise((_resolve, reject) => { rejectAbort = reject; });
  const onAbort = () => {
    void reader.cancel().catch(() => {});
    rejectAbort(new DOMException("Aborted", "AbortError"));
  };
  signal.addEventListener("abort", onAbort, { once: true });

  try {
    if (signal.aborted) onAbort();
    while (true) {
      const { done, value } = await Promise.race([reader.read(), aborted]);
      if (done) break;
      if (!(value instanceof Uint8Array)) throw new Error(INVALID_RESPONSE_ERROR);
      totalBytes += value.byteLength;
      if (totalBytes > MAX_RESPONSE_BYTES) {
        void reader.cancel().catch(() => {});
        throw new Error(INVALID_RESPONSE_ERROR);
      }
      chunks.push(value);
    }
  } finally {
    signal.removeEventListener("abort", onAbort);
    try {
      reader.releaseLock();
    } catch {
      // Cancellation may still own the lock after an aborted pending read.
    }
  }

  const bytes = new Uint8Array(totalBytes);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder("utf-8", { fatal: true }).decode(bytes);
}

function isPlainObject(value) {
  if (value === null || typeof value !== "object" || Array.isArray(value)) return false;
  const prototype = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function normalizeScene(scene, index) {
  if (!isPlainObject(scene)) throw new Error(INVALID_RESPONSE_ERROR);
  const normalized = { id: `scene-${index + 1}` };
  for (const [field, limit] of Object.entries(SCENE_STRING_LIMITS)) {
    const value = scene[field];
    if (typeof value !== "string" || value.length > limit) {
      throw new Error(INVALID_RESPONSE_ERROR);
    }
    normalized[field] = value;
  }
  if (!EVIDENCE_LEVELS.has(scene.evidenceLevel) || !RISK_TYPES.has(scene.riskType)) {
    throw new Error(INVALID_RESPONSE_ERROR);
  }
  normalized.evidenceLevel = scene.evidenceLevel;
  normalized.riskType = scene.riskType;
  normalized.revised = false;
  return normalized;
}

export function setApiEndpoint(url) {
  const normalized = normalizeEndpoint(url);
  if (!normalized) throw new Error("请配置有效的 HTTPS Worker /analyze 地址");
  apiEndpoint = normalized;
}

export function getApiEndpoint() {
  return apiEndpoint;
}

export async function analyzeWithAI(input, fetchImpl = fetch, timeoutMs = 55_000, timers = {}) {
  if (!apiEndpoint) throw new Error("AI 分析服务配置未完成");

  const controller = new AbortController();
  let timedOut = false;
  const setTimeoutImpl = timers.setTimeoutImpl ?? globalThis.setTimeout;
  const clearTimeoutImpl = timers.clearTimeoutImpl ?? globalThis.clearTimeout;
  const timer = setTimeoutImpl(() => {
    timedOut = true;
    controller.abort();
  }, timeoutMs);

  try {
    let response;
    try {
      response = await fetchImpl(apiEndpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "omit",
        body: JSON.stringify({
          nickname: input?.nickname,
          date: input?.date,
          transcript: input?.transcript,
        }),
        signal: controller.signal,
      });
    } catch {
      if (timedOut) throw new Error("AI 分析超时，请稍后重试");
      throw new Error("无法连接 AI 分析服务，请稍后重试");
    }

    let payload;
    try {
      const body = await readBoundedResponse(response, controller.signal);
      payload = JSON.parse(body);
    } catch {
      if (timedOut) throw new Error("AI 分析超时，请稍后重试");
      throw new Error(INVALID_RESPONSE_ERROR);
    }

    if (!response.ok) throw new Error(messageForErrorCode(payload));
    if (payload?.ok === false) throw new Error(messageForErrorCode(payload));
    if (
      payload?.ok !== true ||
      payload.mode !== "ai" ||
      !Array.isArray(payload.scenes) ||
      payload.scenes.length > 20
    ) throw new Error(INVALID_RESPONSE_ERROR);

    return { mode: "ai", scenes: payload.scenes.map(normalizeScene) };
  } finally {
    clearTimeoutImpl(timer);
  }
}
