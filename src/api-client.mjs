let apiEndpoint = "";

const GENERIC_SERVICE_ERROR = "AI 分析服务暂时不可用，请稍后重试";
const INVALID_RESPONSE_ERROR = "AI 分析服务返回数据无效，请稍后重试";

function isValidEndpoint(value) {
  if (typeof value !== "string" || value.trim() === "") return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.pathname === "/analyze";
  } catch {
    return false;
  }
}

function safeServerMessage(payload, fallback = GENERIC_SERVICE_ERROR) {
  const message = payload?.message;
  if (typeof message !== "string") return fallback;

  const trimmed = message.trim();
  if (trimmed.length === 0 || trimmed.length > 200 || /[\u0000-\u001f\u007f]/.test(trimmed)) {
    return fallback;
  }
  return trimmed;
}

export function setApiEndpoint(url) {
  apiEndpoint = "";
  if (!isValidEndpoint(url)) {
    throw new Error("请配置有效的 HTTPS Worker /analyze 地址");
  }
  apiEndpoint = url.trim();
}

export function getApiEndpoint() {
  return apiEndpoint;
}

export async function analyzeWithAI(input, fetchImpl = fetch, timeoutMs = 55_000) {
  if (!apiEndpoint) {
    throw new Error("AI 分析服务配置未完成");
  }

  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
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
      payload = await response.json();
    } catch {
      throw new Error(INVALID_RESPONSE_ERROR);
    }

    if (!response.ok) {
      throw new Error(safeServerMessage(payload));
    }
    if (payload?.ok === false) {
      throw new Error(safeServerMessage(payload));
    }
    if (payload?.ok !== true || payload.mode !== "ai" || !Array.isArray(payload.scenes)) {
      throw new Error(INVALID_RESPONSE_ERROR);
    }

    return { mode: "ai", scenes: [...payload.scenes] };
  } finally {
    clearTimeout(timer);
  }
}
