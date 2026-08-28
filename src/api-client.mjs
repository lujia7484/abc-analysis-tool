let apiEndpoint = "";

const GENERIC_SERVICE_ERROR = "AI 分析服务暂时不可用，请稍后重试";
const INVALID_RESPONSE_ERROR = "AI 分析服务返回数据无效，请稍后重试";
const ERROR_MESSAGES = new Map([
  ["RATE_LIMITED", "请求过于频繁，请稍后重试"],
  ["VALIDATION_ERROR", "提交内容无效，请检查后重试"],
  ["CONFIG_ERROR", "AI 分析服务配置异常，请联系管理员"],
  ["AI_UPSTREAM_ERROR", GENERIC_SERVICE_ERROR],
  ["BODY_TOO_LARGE", "提交内容过长，请精简后重试"],
]);

function isValidEndpoint(value) {
  if (typeof value !== "string" || value.trim() === "") return false;

  try {
    const parsed = new URL(value);
    return parsed.protocol === "https:" && parsed.pathname === "/analyze";
  } catch {
    return false;
  }
}

function messageForErrorCode(payload) {
  return ERROR_MESSAGES.get(payload?.code) ?? GENERIC_SERVICE_ERROR;
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
      throw new Error(messageForErrorCode(payload));
    }
    if (payload?.ok === false) {
      throw new Error(messageForErrorCode(payload));
    }
    if (payload?.ok !== true || payload.mode !== "ai" || !Array.isArray(payload.scenes)) {
      throw new Error(INVALID_RESPONSE_ERROR);
    }

    return { mode: "ai", scenes: [...payload.scenes] };
  } finally {
    clearTimeout(timer);
  }
}
