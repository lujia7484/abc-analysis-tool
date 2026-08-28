import { SYSTEM_PROMPT } from './prompt.mjs';
import { normalizeModelOutput, validateInput } from './schema.mjs';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_LIMIT = 5;
const TIMEOUT_MS = 45_000;

function corsHeaders(origin) {
  return {
    'Access-Control-Allow-Origin': origin,
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
    Vary: 'Origin',
  };
}

function jsonResponse(origin, status, code, message, extra = {}) {
  const headers = { 'Content-Type': 'application/json; charset=utf-8' };
  if (origin) Object.assign(headers, corsHeaders(origin));
  return new Response(JSON.stringify({ ok: status < 400, ...(code ? { code, message } : {}), ...extra }), {
    status,
    headers,
  });
}

function errorResponse(origin, status, code, message) {
  return jsonResponse(origin, status, code, message);
}

function hasRequiredConfig(env) {
  return Boolean(
    env
      && typeof env.ALLOWED_ORIGIN === 'string'
      && env.ALLOWED_ORIGIN
      && typeof env.DEEPSEEK_API_KEY === 'string'
      && env.DEEPSEEK_API_KEY
      && typeof env.RATE_LIMIT_SALT === 'string'
      && env.RATE_LIMIT_SALT
      && env.RATE_LIMIT_KV
      && typeof env.RATE_LIMIT_KV.get === 'function'
      && typeof env.RATE_LIMIT_KV.put === 'function',
  );
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function consumeRateLimit(env, ip) {
  const hash = await sha256Hex(`${env.RATE_LIMIT_SALT}:${ip}`);
  const utcHour = new Date().toISOString().slice(0, 13);
  const key = `hour:${utcHour}:${hash}`;
  const stored = await env.RATE_LIMIT_KV.get(key);
  const parsed = Number.parseInt(stored ?? '0', 10);
  const count = Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
  if (count >= REQUEST_LIMIT) return false;
  await env.RATE_LIMIT_KV.put(key, String(count + 1), { expirationTtl: 3600 });
  return true;
}

async function analyzeWithDeepSeek(input, env, fetchImpl) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetchImpl(DEEPSEEK_URL, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${env.DEEPSEEK_API_KEY}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        model: env.DEEPSEEK_MODEL || 'deepseek-chat',
        messages: [
          { role: 'system', content: SYSTEM_PROMPT },
          { role: 'user', content: JSON.stringify(input) },
        ],
        response_format: { type: 'json_object' },
        temperature: 0.1,
        max_tokens: 4096,
        stream: false,
      }),
      signal: controller.signal,
    });
    if (!response.ok) throw new Error('Upstream request failed');
    const payload = await response.json();
    const content = payload?.choices?.[0]?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Upstream content missing');
    return normalizeModelOutput(JSON.parse(content));
  } finally {
    clearTimeout(timeout);
  }
}

export async function handleRequest(request, env, fetchImpl = fetch) {
  const configuredOrigin = typeof env?.ALLOWED_ORIGIN === 'string' && env.ALLOWED_ORIGIN
    ? env.ALLOWED_ORIGIN
    : null;
  if (!hasRequiredConfig(env)) {
    return errorResponse(configuredOrigin, 500, 'CONFIG_ERROR', '服务配置不可用。');
  }

  const requestOrigin = request.headers.get('Origin');
  if (requestOrigin !== env.ALLOWED_ORIGIN) {
    return errorResponse(null, 403, 'ORIGIN_FORBIDDEN', '请求来源不被允许。');
  }

  const url = new URL(request.url);
  if (url.pathname !== '/analyze') {
    return errorResponse(env.ALLOWED_ORIGIN, 404, 'NOT_FOUND', '请求路径不存在。');
  }

  if (request.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: corsHeaders(env.ALLOWED_ORIGIN) });
  }
  if (request.method !== 'POST') {
    const response = errorResponse(env.ALLOWED_ORIGIN, 405, 'METHOD_NOT_ALLOWED', '仅支持 POST 请求。');
    response.headers.set('Allow', 'POST, OPTIONS');
    return response;
  }

  const mediaType = request.headers.get('Content-Type')?.split(';', 1)[0].trim().toLowerCase();
  if (mediaType !== 'application/json') {
    return errorResponse(env.ALLOWED_ORIGIN, 415, 'UNSUPPORTED_MEDIA_TYPE', '请求内容必须是 JSON。');
  }

  let input;
  try {
    input = validateInput(await request.json());
  } catch {
    return errorResponse(env.ALLOWED_ORIGIN, 400, 'INVALID_INPUT', '请求内容无效。');
  }

  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return errorResponse(env.ALLOWED_ORIGIN, 500, 'CONFIG_ERROR', '服务配置不可用。');
  }

  try {
    if (!(await consumeRateLimit(env, ip))) {
      return errorResponse(env.ALLOWED_ORIGIN, 429, 'RATE_LIMITED', '分析次数已达上限，请一小时后再试。');
    }
  } catch {
    return errorResponse(env.ALLOWED_ORIGIN, 500, 'CONFIG_ERROR', '服务配置不可用。');
  }

  try {
    const { scenes } = await analyzeWithDeepSeek(input, env, fetchImpl);
    return jsonResponse(env.ALLOWED_ORIGIN, 200, null, null, { mode: 'ai', scenes });
  } catch {
    return errorResponse(env.ALLOWED_ORIGIN, 502, 'AI_UPSTREAM_ERROR', 'AI 分析服务暂时不可用，请稍后重试。');
  }
}

export default {
  fetch(request, env) {
    return handleRequest(request, env);
  },
};
