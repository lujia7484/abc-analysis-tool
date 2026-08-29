import test from 'node:test';
import assert from 'node:assert/strict';

import { RateLimiter, callDeepSeek, handleRequest } from '../src/index.mjs';

const ORIGIN = 'https://lujia7484.github.io';
const TRANSCRIPT = 'private transcript marker';
const API_KEY = 'private-api-key-marker';
const RAW_UPSTREAM = 'private-upstream-marker';

function validScene() {
  return {
    title: '场景', a: '前因', b: '行为', c: '结果', sourceQuote: TRANSCRIPT,
    sourceLocation: '无时间戳', evidenceLevel: '高', riskType: '无', limitations: '',
  };
}

function deepSeekResponse(content = JSON.stringify({ scenes: [validScene()] }), finishReason = 'stop') {
  return new Response(JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'deepseek-chat',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: finishReason }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function createStorage() {
  const values = new Map();
  let transactionTail = Promise.resolve();
  let scheduledAlarm = null;
  return {
    values,
    get scheduledAlarm() { return scheduledAlarm; },
    async get(key) {
      return values.get(key);
    },
    async put(key, value) {
      values.set(key, value);
    },
    async delete(key) {
      values.delete(key);
    },
    async deleteAll() {
      values.clear();
    },
    async setAlarm(timestamp) {
      scheduledAlarm = timestamp;
    },
    async deleteAlarm() {
      scheduledAlarm = null;
    },
    transaction(callback) {
      const result = transactionTail.then(() => callback(this));
      transactionTail = result.catch(() => {});
      return result;
    },
  };
}

function createDurableNamespace() {
  const instances = new Map();
  const names = [];
  let fetchCalls = 0;
  return {
    names,
    get fetchCalls() { return fetchCalls; },
    idFromName(name) {
      names.push(name);
      return name;
    },
    get(id) {
      if (!instances.has(id)) {
        const limiter = new RateLimiter({ storage: createStorage() });
        instances.set(id, { fetch: (request) => { fetchCalls += 1; return limiter.fetch(request); } });
      }
      return instances.get(id);
    },
  };
}

function env(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    DEEPSEEK_API_KEY: API_KEY,
    RATE_LIMIT_SALT: 'a'.repeat(64),
    DEEPSEEK_MODEL: 'deepseek-chat',
    RATE_LIMITER: createDurableNamespace(),
    ...overrides,
  };
}

function request({ method = 'POST', path = '/analyze', origin = ORIGIN, body, contentType = 'application/json', ip = '203.0.113.7' } = {}) {
  const headers = new Headers();
  if (origin !== null) headers.set('origin', origin);
  if (contentType !== null) headers.set('content-type', contentType);
  if (ip !== null) headers.set('cf-connecting-ip', ip);
  return new Request(`https://worker.example${path}`, {
    method,
    headers,
    body: method === 'GET' || method === 'HEAD' || method === 'OPTIONS'
      ? undefined
      : body ?? JSON.stringify({ transcript: TRANSCRIPT }),
  });
}

async function json(response) {
  return { response, body: await response.json() };
}

test('approved OPTIONS preflight returns 204 with exact CORS headers', async () => {
  const response = await handleRequest(request({ method: 'OPTIONS', contentType: null, ip: null }), env(), assert.fail);
  assert.equal(response.status, 204);
  assert.equal(response.headers.get('access-control-allow-origin'), ORIGIN);
  assert.equal(response.headers.get('access-control-allow-methods'), 'POST, OPTIONS');
  assert.match(response.headers.get('access-control-allow-headers'), /Content-Type/i);
  assert.equal(response.headers.get('vary'), 'Origin');
  assert.notEqual(response.headers.get('access-control-allow-origin'), '*');
});

test('unapproved origin returns 403 without calling upstream', async () => {
  let called = false;
  const result = await json(await handleRequest(request({ origin: 'https://evil.example' }), env(), async () => { called = true; }));
  assert.equal(result.response.status, 403);
  assert.equal(result.body.ok, false);
  assert.equal(called, false);
  assert.equal(result.response.headers.get('access-control-allow-origin'), null);
});

test('wrong path returns 404', async () => {
  const result = await json(await handleRequest(request({ path: '/wrong' }), env(), assert.fail));
  assert.equal(result.response.status, 404);
});

test('non-POST method returns 405 and Allow header', async () => {
  const result = await json(await handleRequest(request({ method: 'GET', contentType: null }), env(), assert.fail));
  assert.equal(result.response.status, 405);
  assert.equal(result.response.headers.get('allow'), 'POST, OPTIONS');
});

test('wrong content type returns 415', async () => {
  const result = await json(await handleRequest(request({ contentType: 'text/plain' }), env(), assert.fail));
  assert.equal(result.response.status, 415);
});

test('malformed and schema-invalid JSON return 400 without calling upstream', async () => {
  for (const body of ['{broken', JSON.stringify({ transcript: '   ' })]) {
    let called = false;
    const result = await json(await handleRequest(request({ body }), env(), async () => { called = true; }));
    assert.equal(result.response.status, 400);
    assert.equal(result.body.ok, false);
    assert.equal(called, false);
  }
});

test('sixth valid request in an hour returns 429 through a hash-keyed Durable Object', async () => {
  const namespace = createDurableNamespace();
  const testEnv = env({ RATE_LIMITER: namespace });
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return deepSeekResponse(); };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await handleRequest(request(), testEnv, fetchImpl)).status, 200);
  }
  const result = await json(await handleRequest(request(), testEnv, fetchImpl));
  assert.equal(result.response.status, 429);
  assert.equal(result.body.code, 'RATE_LIMITED');
  assert.equal(calls, 5);
  assert.equal(namespace.fetchCalls, 6);
  assert.match(namespace.names[0], /^[0-9a-f]{64}$/);
  assert.doesNotMatch(namespace.names[0], /203\.0\.113\.7|rate-limit-salt/);
});

test('RateLimiter atomically admits only five concurrent requests', async () => {
  const limiter = new RateLimiter({ storage: createStorage() });
  const responses = await Promise.all(Array.from({ length: 12 }, () => limiter.fetch(new Request('https://limiter/admit', { method: 'POST' }))));
  const results = await Promise.all(responses.map((response) => response.json()));
  assert.equal(results.filter(({ allowed }) => allowed).length, 5);
  assert.equal(results.filter(({ allowed }) => !allowed).length, 7);
});

test('RateLimiter resets count after its one-hour window', async () => {
  const storage = createStorage();
  const limiter = new RateLimiter({ storage });
  storage.values.set('limit', { count: 5, resetAt: Date.now() - 1 });
  const response = await limiter.fetch(new Request('https://limiter/admit', { method: 'POST' }));
  assert.deepEqual(await response.json(), { allowed: true });
  const metadata = storage.values.get('limit');
  assert.equal(metadata.count, 1);
  assert.ok(metadata.resetAt > Date.now());
  assert.equal(storage.scheduledAlarm, metadata.resetAt);
  assert.deepEqual(Object.keys(metadata).sort(), ['count', 'resetAt']);
});

test('RateLimiter alarm removes stored metadata and clears the scheduled alarm', async () => {
  const storage = createStorage();
  const limiter = new RateLimiter({ storage });
  storage.values.set('limit', { count: 5, resetAt: Date.now() - 1 });
  await storage.setAlarm(Date.now() - 1);
  assert.ok(storage.values.has('limit'));
  assert.ok(storage.scheduledAlarm);
  await limiter.alarm();
  assert.equal(storage.values.size, 0);
  assert.equal(storage.scheduledAlarm, null);
});

test('RateLimiter stale alarm preserves a future window and reschedules it', async () => {
  const storage = createStorage();
  const limiter = new RateLimiter({ storage });
  const futureResetAt = Date.now() + 30_000;
  const metadata = { count: 4, resetAt: futureResetAt };
  storage.values.set('limit', metadata);
  await storage.setAlarm(Date.now() - 1);
  await limiter.alarm();
  assert.deepEqual(storage.values.get('limit'), metadata);
  assert.equal(storage.scheduledAlarm, futureResetAt);
});

test('oversized Content-Length is rejected before rate limiter and upstream', async () => {
  const namespace = createDurableNamespace();
  let upstreamCalled = false;
  const oversized = request();
  oversized.headers.set('content-length', String(80 * 1024 + 1));
  const result = await json(await handleRequest(oversized, env({ RATE_LIMITER: namespace }), async () => { upstreamCalled = true; }));
  assert.equal(result.response.status, 413);
  assert.equal(namespace.fetchCalls, 0);
  assert.equal(upstreamCalled, false);
});

test('oversized chunked body is rejected before rate limiter and upstream', async () => {
  const namespace = createDurableNamespace();
  let upstreamCalled = false;
  const oversized = request({ body: JSON.stringify({ transcript: '字'.repeat(80 * 1024) }) });
  assert.equal(oversized.headers.get('content-length'), null);
  const result = await json(await handleRequest(oversized, env({ RATE_LIMITER: namespace }), async () => { upstreamCalled = true; }));
  assert.equal(result.response.status, 413);
  assert.equal(namespace.fetchCalls, 0);
  assert.equal(upstreamCalled, false);
});

test('successful DeepSeek JSON output returns normalized AI scenes and correct request shape', async () => {
  let upstreamRequest;
  const result = await json(await handleRequest(request(), env({ DEEPSEEK_MODEL: '' }), async (url, init) => {
    upstreamRequest = { url, init };
    return deepSeekResponse();
  }));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.ok, true);
  assert.equal(result.body.mode, 'ai');
  assert.deepEqual(result.body.scenes[0], {
    id: 'scene-1', ...validScene(), revised: false,
  });
  assert.equal(upstreamRequest.url, 'https://api.deepseek.com/chat/completions');
  assert.equal(upstreamRequest.init.method, 'POST');
  assert.equal(upstreamRequest.init.headers.Authorization, `Bearer ${API_KEY}`);
  const payload = JSON.parse(upstreamRequest.init.body);
  assert.equal(payload.model, 'deepseek-chat');
  assert.equal(payload.messages[1].content, JSON.stringify({ transcript: TRANSCRIPT }));
  assert.deepEqual(payload.response_format, { type: 'json_object' });
  assert.equal(payload.temperature, 0.1);
  assert.equal(payload.max_tokens, 4096);
  assert.equal(payload.stream, false);
  assert.ok(upstreamRequest.init.signal instanceof AbortSignal);
});

test('Worker grounds model evidence against the submitted transcript', async () => {
  const modelScene = validScene();
  modelScene.sourceQuote = 'fabricated quote';
  modelScene.sourceLocation = '09:59';
  const result = await json(await handleRequest(request(), env(), async () => deepSeekResponse(JSON.stringify({ scenes: [modelScene] }))));
  assert.equal(result.response.status, 200);
  assert.equal(result.body.scenes[0].sourceQuote, '待补充（未能在输入原文中核对）');
  assert.equal(result.body.scenes[0].sourceLocation, '无时间戳');
  assert.equal(result.body.scenes[0].evidenceLevel, '低');
});

test('Worker rejects oversized model fields as AI_UPSTREAM_ERROR', async () => {
  const modelScene = validScene();
  modelScene.a = 'x'.repeat(5001);
  const result = await json(await handleRequest(request(), env(), async () => deepSeekResponse(JSON.stringify({ scenes: [modelScene] }))));
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, 'AI_UPSTREAM_ERROR');
});

test('empty model content returns safe AI_UPSTREAM_ERROR', async () => {
  const result = await json(await handleRequest(request(), env(), async () => deepSeekResponse('')));
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, 'AI_UPSTREAM_ERROR');
});

test('non-2xx DeepSeek response returns safe AI_UPSTREAM_ERROR', async () => {
  const result = await json(await handleRequest(request(), env(), async () => new Response(RAW_UPSTREAM, { status: 503 })));
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, 'AI_UPSTREAM_ERROR');
});

test('callDeepSeek actually aborts a pending fetch at the injected timeout', async () => {
  let aborted = false;
  const pendingFetch = async (_url, init) => new Promise((_resolve, reject) => {
    init.signal.addEventListener('abort', () => {
      aborted = true;
      reject(new DOMException('private timeout detail', 'AbortError'));
    }, { once: true });
  });
  await assert.rejects(callDeepSeek({ transcript: TRANSCRIPT }, env(), pendingFetch, 5), /AI_UPSTREAM_ERROR/);
  assert.equal(aborted, true);
});

test('malformed model JSON returns safe AI_UPSTREAM_ERROR', async () => {
  const result = await json(await handleRequest(request(), env(), async () => deepSeekResponse(`{${RAW_UPSTREAM}`)));
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, 'AI_UPSTREAM_ERROR');
});

test('non-stop DeepSeek finish reasons return safe AI_UPSTREAM_ERROR despite valid JSON', async () => {
  for (const reason of ['length', 'content_filter', 'insufficient_system_resource']) {
    const result = await json(await handleRequest(request(), env(), async () => deepSeekResponse(undefined, reason)));
    assert.equal(result.response.status, 502);
    assert.equal(result.body.code, 'AI_UPSTREAM_ERROR');
  }
});

test('missing required configuration fails closed without upstream call', async () => {
  for (const missing of ['ALLOWED_ORIGIN', 'DEEPSEEK_API_KEY', 'RATE_LIMIT_SALT', 'RATE_LIMITER']) {
    let called = false;
    const testEnv = env({ [missing]: missing === 'RATE_LIMITER' ? undefined : '' });
    const result = await json(await handleRequest(request(), testEnv, async () => { called = true; }));
    assert.equal(result.response.status, 500);
    assert.equal(result.body.code, 'CONFIG_ERROR');
    assert.equal(called, false);
  }
});

test('RATE_LIMIT_SALT requires exactly 64 hexadecimal characters', async () => {
  for (const salt of ['too-short', 'a'.repeat(63), 'a'.repeat(65), 'g'.repeat(64), `${'a'.repeat(63)}-`]) {
    let called = false;
    const result = await json(await handleRequest(request(), env({ RATE_LIMIT_SALT: salt }), async () => { called = true; }));
    assert.equal(result.response.status, 500);
    assert.equal(result.body.code, 'CONFIG_ERROR');
    assert.equal(called, false);
  }
  const validUppercaseSalt = 'ABCDEF0123456789'.repeat(4);
  const result = await handleRequest(request(), env({ RATE_LIMIT_SALT: validUppercaseSalt }), async () => deepSeekResponse());
  assert.equal(result.status, 200);
});

test('missing client IP fails closed without upstream call', async () => {
  let called = false;
  const result = await json(await handleRequest(request({ ip: null }), env(), async () => { called = true; }));
  assert.equal(result.response.status, 500);
  assert.equal(result.body.code, 'CONFIG_ERROR');
  assert.equal(called, false);
});

test('responses and errors never expose transcript, upstream body, stack, API key, salt, or raw IP', async () => {
  const secrets = [TRANSCRIPT, RAW_UPSTREAM, API_KEY, 'a'.repeat(64), '203.0.113.7', 'stack-marker'];
  const cases = [
    handleRequest(request({ body: '{broken' }), env(), assert.fail),
    handleRequest(request(), env(), async () => new Response(`${RAW_UPSTREAM} ${API_KEY}`, { status: 500 })),
    handleRequest(request(), env(), async () => { const error = new Error(`${TRANSCRIPT} stack-marker`); error.stack = `stack-marker ${API_KEY}`; throw error; }),
  ];
  for (const pending of cases) {
    const responseText = await (await pending).text();
    for (const secret of secrets) assert.doesNotMatch(responseText, new RegExp(secret.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')));
  }
});
