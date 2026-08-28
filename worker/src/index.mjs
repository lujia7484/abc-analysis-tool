import { SYSTEM_PROMPT } from './prompt.mjs';
import { normalizeModelOutput, validateInput } from './schema.mjs';

const DEEPSEEK_URL = 'https://api.deepseek.com/chat/completions';
const REQUEST_LIMIT = 5;
const TIMEOUT_MS = 45_000;
const LIMIT_WINDOW_MS = 60 * 60 * 1000;
export const MAX_BODY_BYTES = 80 * 1024;

class BodyTooLargeError extends Error {}

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
      && /^[0-9a-f]{64}$/i.test(env.RATE_LIMIT_SALT)
      && env.RATE_LIMITER
      && typeof env.RATE_LIMITER.idFromName === 'function'
      && typeof env.RATE_LIMITER.get === 'function',
  );
}

async function sha256Hex(value) {
  const bytes = new TextEncoder().encode(value);
  const digest = await crypto.subtle.digest('SHA-256', bytes);
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('');
}

async function rateLimitAdmission(env, ip) {
  const hash = await sha256Hex(`${env.RATE_LIMIT_SALT}:${ip}`);
  const id = env.RATE_LIMITER.idFromName(hash);
  const stub = env.RATE_LIMITER.get(id);
  const response = await stub.fetch(new Request('https://rate-limiter/admit', { method: 'POST' }));
  if (!response.ok) throw new Error('Rate limiter unavailable');
  const result = await response.json();
  if (typeof result?.allowed !== 'boolean') throw new Error('Rate limiter response invalid');
  return result.allowed;
}

async function readBoundedJson(request) {
  const declaredLength = request.headers.get('Content-Length');
  if (declaredLength !== null) {
    const bytes = Number(declaredLength);
    if (Number.isFinite(bytes) && bytes > MAX_BODY_BYTES) throw new BodyTooLargeError();
  }

  if (!request.body) return JSON.parse('');
  const reader = request.body.getReader();
  const chunks = [];
  let total = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    total += value.byteLength;
    if (total > MAX_BODY_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(bytes));
}

export async function callDeepSeek(input, env, fetchImpl = fetch, timeoutMs = TIMEOUT_MS) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);
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
    const choice = payload?.choices?.[0];
    if (choice?.finish_reason !== 'stop') throw new Error('Upstream completion incomplete');
    const content = choice?.message?.content;
    if (typeof content !== 'string' || !content.trim()) throw new Error('Upstream content missing');
    return normalizeModelOutput(JSON.parse(content));
  } catch {
    throw new Error('AI_UPSTREAM_ERROR');
  } finally {
    clearTimeout(timeout);
  }
}

export class RateLimiter {
  constructor(ctx) {
    this.storage = ctx.storage;
  }

  async fetch(request) {
    if (request.method !== 'POST') return new Response(null, { status: 405 });
    const admission = await this.storage.transaction(async (transaction) => {
      const now = Date.now();
      const current = await transaction.get('limit');
      const windowIsActive = current && Number.isFinite(current.resetAt) && current.resetAt > now;
      const active = windowIsActive ? current : { count: 0, resetAt: now + LIMIT_WINDOW_MS };
      if (active.count >= REQUEST_LIMIT) return { allowed: false, scheduleAt: null };
      await transaction.put('limit', { count: active.count + 1, resetAt: active.resetAt });
      return { allowed: true, scheduleAt: windowIsActive ? null : active.resetAt };
    });
    if (admission.scheduleAt !== null) await this.storage.setAlarm(admission.scheduleAt);
    return Response.json({ allowed: admission.allowed });
  }

  async alarm() {
    await this.storage.deleteAlarm();
    const futureResetAt = await this.storage.transaction(async (transaction) => {
      const current = await transaction.get('limit');
      if (!current) return null;
      if (!Number.isFinite(current.resetAt) || current.resetAt <= Date.now()) {
        await transaction.delete('limit');
        return null;
      }
      return current.resetAt;
    });
    if (futureResetAt !== null) await this.storage.setAlarm(futureResetAt);
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
    input = validateInput(await readBoundedJson(request));
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return errorResponse(env.ALLOWED_ORIGIN, 413, 'PAYLOAD_TOO_LARGE', '请求内容超过大小限制。');
    }
    return errorResponse(env.ALLOWED_ORIGIN, 400, 'INVALID_INPUT', '请求内容无效。');
  }

  const ip = request.headers.get('CF-Connecting-IP');
  if (!ip) {
    return errorResponse(env.ALLOWED_ORIGIN, 500, 'CONFIG_ERROR', '服务配置不可用。');
  }

  try {
    if (!(await rateLimitAdmission(env, ip))) {
      return errorResponse(env.ALLOWED_ORIGIN, 429, 'RATE_LIMITED', '分析次数已达上限，请一小时后再试。');
    }
  } catch {
    return errorResponse(env.ALLOWED_ORIGIN, 500, 'CONFIG_ERROR', '服务配置不可用。');
  }

  try {
    const { scenes } = await callDeepSeek(input, env, fetchImpl);
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
