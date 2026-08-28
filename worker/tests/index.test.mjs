import test from 'node:test';
import assert from 'node:assert/strict';

import { handleRequest } from '../src/index.mjs';

const ORIGIN = 'https://lujia7484.github.io';
const TRANSCRIPT = 'private transcript marker';
const API_KEY = 'private-api-key-marker';
const RAW_UPSTREAM = 'private-upstream-marker';

function validScene() {
  return {
    title: '场景', a: '前因', b: '行为', c: '结果', sourceQuote: '原话',
    sourceLocation: '无时间戳', evidenceLevel: '高', riskType: '无', limitations: '',
  };
}

function deepSeekResponse(content = JSON.stringify({ scenes: [validScene()] })) {
  return new Response(JSON.stringify({
    id: 'chatcmpl-test',
    object: 'chat.completion',
    created: 0,
    model: 'deepseek-chat',
    choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { 'content-type': 'application/json' } });
}

function createKv(initial = 0) {
  const values = new Map();
  const puts = [];
  if (initial) values.set('initial', String(initial));
  return {
    values,
    puts,
    async get(key) {
      return initial && values.size === 1 && values.has('initial')
        ? values.get('initial')
        : values.get(key) ?? null;
    },
    async put(key, value, options) {
      values.delete('initial');
      values.set(key, value);
      puts.push({ key, value, options });
    },
  };
}

function env(overrides = {}) {
  return {
    ALLOWED_ORIGIN: ORIGIN,
    DEEPSEEK_API_KEY: API_KEY,
    RATE_LIMIT_SALT: 'rate-limit-salt',
    DEEPSEEK_MODEL: 'deepseek-chat',
    RATE_LIMIT_KV: createKv(),
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

test('sixth valid request in a UTC hour returns 429 using hashed KV metadata', async () => {
  const kv = createKv();
  const testEnv = env({ RATE_LIMIT_KV: kv });
  let calls = 0;
  const fetchImpl = async () => { calls += 1; return deepSeekResponse(); };
  for (let attempt = 0; attempt < 5; attempt += 1) {
    assert.equal((await handleRequest(request(), testEnv, fetchImpl)).status, 200);
  }
  const result = await json(await handleRequest(request(), testEnv, fetchImpl));
  assert.equal(result.response.status, 429);
  assert.equal(result.body.code, 'RATE_LIMITED');
  assert.equal(calls, 5);
  assert.equal(kv.puts.length, 5);
  assert.deepEqual(kv.puts.at(-1).options, { expirationTtl: 3600 });
  assert.match(kv.puts[0].key, /^hour:\d{4}-\d{2}-\d{2}T\d{2}:[0-9a-f]{64}$/);
  assert.doesNotMatch(kv.puts[0].key, /203\.0\.113\.7|rate-limit-salt/);
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

test('DeepSeek timeout returns safe AI_UPSTREAM_ERROR', async () => {
  const result = await json(await handleRequest(request(), env(), async (_url, init) => {
    assert.ok(init.signal instanceof AbortSignal);
    throw new DOMException('timed out with private detail', 'AbortError');
  }));
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, 'AI_UPSTREAM_ERROR');
});

test('malformed model JSON returns safe AI_UPSTREAM_ERROR', async () => {
  const result = await json(await handleRequest(request(), env(), async () => deepSeekResponse(`{${RAW_UPSTREAM}`)));
  assert.equal(result.response.status, 502);
  assert.equal(result.body.code, 'AI_UPSTREAM_ERROR');
});

test('missing required configuration fails closed without upstream call', async () => {
  for (const missing of ['ALLOWED_ORIGIN', 'DEEPSEEK_API_KEY', 'RATE_LIMIT_SALT', 'RATE_LIMIT_KV']) {
    let called = false;
    const testEnv = env({ [missing]: missing === 'RATE_LIMIT_KV' ? undefined : '' });
    const result = await json(await handleRequest(request(), testEnv, async () => { called = true; }));
    assert.equal(result.response.status, 500);
    assert.equal(result.body.code, 'CONFIG_ERROR');
    assert.equal(called, false);
  }
});

test('missing client IP fails closed without upstream call', async () => {
  let called = false;
  const result = await json(await handleRequest(request({ ip: null }), env(), async () => { called = true; }));
  assert.equal(result.response.status, 500);
  assert.equal(result.body.code, 'CONFIG_ERROR');
  assert.equal(called, false);
});

test('responses and errors never expose transcript, upstream body, stack, API key, salt, or raw IP', async () => {
  const secrets = [TRANSCRIPT, RAW_UPSTREAM, API_KEY, 'rate-limit-salt', '203.0.113.7', 'stack-marker'];
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
