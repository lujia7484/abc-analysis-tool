# AI ABC Workbench Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Upgrade the public ABC workbench into a learner-facing, editable DeepSeek-assisted analyzer with a privacy-preserving Cloudflare Worker and local-rule fallback.

**Architecture:** GitHub Pages serves a dependency-free ES-module frontend. A Cloudflare Worker validates requests, applies hourly hashed-IP rate limits atomically through a Durable Object, calls DeepSeek JSON Output, validates the returned schema, and returns only normalized scenes. The Durable Object uses an alarm to remove expired window metadata. The frontend never receives the API key and falls back to the existing local analyzer when AI is unavailable.

**Tech Stack:** HTML, CSS, browser JavaScript modules, Node.js built-in test runner, Cloudflare Workers, Wrangler, Durable Objects, DeepSeek Chat Completions API.

---

## File Map

- Create `src/scene-contract.mjs`: shared scene enums, field limits, IDs, validation, and transcript grounding for Worker and browser consumers.
- Modify `index.html`: learner-facing double-column shell and privacy consent.
- Replace `styles.css`: responsive visual system and editable result cards.
- Create `src/local-analyzer.mjs`: existing deterministic parser and fallback analyzer.
- Create `src/api-client.mjs`: Worker request, timeout, and response normalization.
- Create `src/app.mjs`: page state, rendering, edits, fallback, copy, and export.
- Remove `script.js`: superseded monolithic browser script.
- Create `worker/src/prompt.mjs`: fixed ABC extraction standard and JSON example.
- Create `worker/src/schema.mjs`: input validation and shared-contract model-output normalization.
- Create `worker/src/index.mjs`: CORS, Durable Object rate limiter, alarm cleanup, DeepSeek call, and errors.
- Create `worker/wrangler.jsonc`: Worker, Durable Object binding and migration, variables, and required secret declaration.
- Create `tests/local-analyzer.test.mjs`: fallback behavior tests.
- Create `tests/api-client.test.mjs`: browser API client tests.
- Create `worker/tests/schema.test.mjs`: schema and evidence-boundary tests.
- Create `worker/tests/index.test.mjs`: Worker request, CORS, limit, and upstream tests.
- Create `package.json`: test and Wrangler commands.
- Modify `.gitignore`: exclude local secrets and Wrangler state.
- Modify `README.md`: privacy, deployment, secrets, and operations.

### Task 1: Test Scaffold and Local Analyzer Module

**Files:**
- Create: `package.json`
- Create: `src/local-analyzer.mjs`
- Create: `tests/local-analyzer.test.mjs`
- Modify: `.gitignore`

- [ ] **Step 1: Add the test runner and deployment scripts**

```json
{
  "name": "abc-analysis-tool",
  "private": true,
  "type": "module",
  "scripts": {
    "test": "node --test tests/*.test.mjs worker/tests/*.test.mjs",
    "worker:dev": "wrangler dev --config worker/wrangler.jsonc",
    "worker:deploy": "wrangler deploy --config worker/wrangler.jsonc"
  },
  "devDependencies": {
    "wrangler": "^4.36.0"
  }
}
```

- [ ] **Step 2: Write failing fallback-analyzer tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeLocally, parseTranscript } from "../src/local-analyzer.mjs";

test("parses anonymous timestamped utterances", () => {
  assert.deepEqual(parseTranscript("00:12:01 家人：请开始任务。"), [
    { timestamp: "00:12:01", speaker: "家人", text: "请开始任务。" }
  ]);
});

test("returns a basic-analysis scene without inventing timestamps", () => {
  const result = analyzeLocally("家人：请开始任务。\n学员：我不想开始。\n家人：那我们稍后再谈。");
  assert.equal(result.mode, "basic");
  assert.equal(result.scenes[0].sourceLocation, "无时间戳");
});
```

- [ ] **Step 3: Run the tests and confirm the missing-module failure**

Run: `npm test`

Expected: FAIL because `src/local-analyzer.mjs` does not exist.

- [ ] **Step 4: Move the existing parser into a pure module**

Export `parseTranscript(raw)` and `analyzeLocally(raw)`. Normalize each scene to this interface:

```js
{
  id: "scene-1",
  title: "任务开始前的互动",
  a: "家人提醒开始任务。",
  b: "学员表示暂时不想开始。",
  c: "双方稍后继续讨论。",
  sourceQuote: "家人（无时间戳）：请开始任务。\n学员（无时间戳）：我不想开始。",
  sourceLocation: "无时间戳",
  evidenceLevel: "中",
  riskType: "无",
  limitations: "基础规则分析，请结合原文修订。",
  revised: false
}
```

Return `{ mode: "basic", scenes }` and retain the existing risk keyword list.

- [ ] **Step 5: Exclude secrets and local Worker state**

Append to `.gitignore`:

```gitignore
node_modules/
.dev.vars*
.env*
.wrangler/
worker/.wrangler/
```

- [ ] **Step 6: Run tests and commit**

Run: `npm test`

Expected: both local analyzer tests PASS.

```bash
git add package.json .gitignore src/local-analyzer.mjs tests/local-analyzer.test.mjs
git commit -m "refactor: isolate local ABC analyzer"
```

### Task 2: Worker Schema and Evidence Contract

**Files:**
- Create: `worker/src/schema.mjs`
- Create: `worker/src/prompt.mjs`
- Create: `worker/tests/schema.test.mjs`

- [ ] **Step 1: Write failing schema tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { validateInput, normalizeModelOutput } from "../src/schema.mjs";

test("rejects empty and oversized transcripts", () => {
  assert.throws(() => validateInput({ transcript: "" }), /不能为空/);
  assert.throws(() => validateInput({ transcript: "字".repeat(20001) }), /20000/);
});

test("normalizes missing timestamps without inventing one", () => {
  const output = normalizeModelOutput({ scenes: [{
    title: "开始任务", a: "被提醒", b: "暂缓", c: "继续讨论",
    sourceQuote: "原句", sourceLocation: "", evidenceLevel: "中",
    riskType: "无", limitations: "结果信息有限"
  }] });
  assert.equal(output.scenes[0].sourceLocation, "无时间戳");
});
```

- [ ] **Step 2: Run the focused tests**

Run: `node --test worker/tests/schema.test.mjs`

Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement strict input and output normalization**

`validateInput` accepts only an object with `transcript`, optional `nickname`, and optional `date`. Trim all strings, reject more than 20,000 characters, and never return unknown fields.

`normalizeModelOutput` requires a `scenes` array, caps it at 20 scenes, converts all scene values to strings, restricts `evidenceLevel` to `高|中|低`, restricts `riskType` to `无|离家|自伤/轻生|暴力|安全待确认`, and supplies `无时间戳` for a blank location. Reject empty model content and malformed JSON.

- [ ] **Step 4: Define the fixed prompt**

Export `SYSTEM_PROMPT` containing these exact behavioral constraints:

```text
你是 ABC 行为观察助手。请输出 json 对象，不做诊断。
A 只写原文支持的前因或触发情境；B 只写可观察的表达和行动；C 只写随后真实发生的结果。
不得补写动机、情绪、时间戳或结果。证据不足时写“待补充”，并在 limitations 说明边界。
原文无时间戳时 sourceLocation 必须为“无时间戳”。风险内容必须独立标记。
```

Include one anonymous JSON example matching the normalized interface.

- [ ] **Step 5: Run tests and commit**

Run: `node --test worker/tests/schema.test.mjs`

Expected: all schema tests PASS.

```bash
git add worker/src/schema.mjs worker/src/prompt.mjs worker/tests/schema.test.mjs
git commit -m "feat: define AI ABC evidence contract"
```

### Task 3: Cloudflare Worker, DeepSeek, CORS, and Hourly Limits

**Files:**
- Create: `worker/src/index.mjs`
- Create: `worker/tests/index.test.mjs`
- Create: `worker/wrangler.jsonc`

- [ ] **Step 1: Write failing Worker behavior tests**

Test these exact cases with mocked `fetch` and a mocked Durable Object binding:

```js
test("rejects an unapproved origin with 403", async () => {});
test("returns 405 for non-POST requests", async () => {});
test("returns 429 after five requests in an hour", async () => {});
test("does not include the transcript in error responses", async () => {});
test("returns normalized scenes from DeepSeek JSON output", async () => {});
test("returns AI_UPSTREAM_ERROR for empty model content", async () => {});
```

- [ ] **Step 2: Run the focused Worker tests**

Run: `node --test worker/tests/index.test.mjs`

Expected: FAIL because the Worker entrypoint does not exist.

- [ ] **Step 3: Implement the request boundary**

Export both `handleRequest(request, env, fetchImpl = fetch)` for tests and the Cloudflare default handler. Accept only `POST /analyze`, require `Content-Type: application/json`, and allow only `env.ALLOWED_ORIGIN`.

Use consistent responses:

```js
return Response.json(
  { ok: false, code: "RATE_LIMITED", message: "分析次数已达上限，请一小时后再试。" },
  { status: 429, headers: corsHeaders(env.ALLOWED_ORIGIN) }
);
```

Never include request bodies, model raw output, stack traces, or secrets in responses or logs.

- [ ] **Step 4: Implement atomic hourly limits without raw IP storage**

Read `CF-Connecting-IP`, hash `env.RATE_LIMIT_SALT + ip` with SHA-256, and route the hash to the `RATE_LIMITER` Durable Object. The object atomically admits at most five requests in its one-hour window. Store only hashed identity/window metadata, never the raw IP. Schedule an alarm for window expiry; the alarm removes expired metadata and clears itself, while a stale alarm preserves and reschedules a future window. Fail closed when the client IP is missing.

- [ ] **Step 5: Call DeepSeek JSON Output**

Send `POST https://api.deepseek.com/chat/completions` with:

```js
{
  model: env.DEEPSEEK_MODEL || "deepseek-chat",
  messages: [
    { role: "system", content: SYSTEM_PROMPT },
    { role: "user", content: JSON.stringify(input) }
  ],
  response_format: { type: "json_object" },
  temperature: 0.1,
  max_tokens: 4096,
  stream: false
}
```

Authorize with `Bearer ${env.DEEPSEEK_API_KEY}`. Apply a 45-second abort timeout. Parse `choices[0].message.content`, then call `normalizeModelOutput` before responding.

- [ ] **Step 6: Add Wrangler configuration**

```jsonc
{
  "$schema": "node_modules/wrangler/config-schema.json",
  "name": "abc-analysis-api",
  "main": "src/index.mjs",
  "compatibility_date": "2026-08-28",
  "workers_dev": true,
  "vars": {
    "ALLOWED_ORIGIN": "https://lujia7484.github.io",
    "DEEPSEEK_MODEL": "deepseek-chat"
  },
  "secrets": {
    "required": ["DEEPSEEK_API_KEY", "RATE_LIMIT_SALT"]
  }
}
```

Declare the `RATE_LIMITER` Durable Object binding, its `RateLimiter` class, and the required migration in public Wrangler configuration. Durable Object binding and migration metadata are configuration, not secrets.

- [ ] **Step 7: Run tests and commit**

Run: `node --test worker/tests/index.test.mjs`

Expected: all Worker tests PASS.

```bash
git add worker/src/index.mjs worker/tests/index.test.mjs worker/wrangler.jsonc
git commit -m "feat: add secure DeepSeek Worker"
```

### Task 4: Browser API Client and Fallback

**Files:**
- Create: `src/api-client.mjs`
- Create: `tests/api-client.test.mjs`

- [ ] **Step 1: Write failing API-client tests**

```js
import test from "node:test";
import assert from "node:assert/strict";
import { analyzeWithAI } from "../src/api-client.mjs";

test("returns normalized AI data", async () => {
  const fetchImpl = async () => Response.json({ ok: true, mode: "ai", scenes: [] });
  assert.equal((await analyzeWithAI({ transcript: "内容" }, fetchImpl)).mode, "ai");
});

test("throws a user-safe code for upstream failure", async () => {
  const fetchImpl = async () => Response.json({ ok: false, code: "AI_UPSTREAM_ERROR", message: "服务繁忙" }, { status: 502 });
  await assert.rejects(() => analyzeWithAI({ transcript: "内容" }, fetchImpl), /服务繁忙/);
});
```

- [ ] **Step 2: Implement the API client**

Export `setApiEndpoint(url)` and `analyzeWithAI(input, fetchImpl = fetch)`. Use a 55-second browser timeout, send JSON, reject non-success responses with a safe `Error`, and require `{ mode: "ai", scenes: [] }`.

- [ ] **Step 3: Run tests and commit**

Run: `node --test tests/api-client.test.mjs`

Expected: both API-client tests PASS.

```bash
git add src/api-client.mjs tests/api-client.test.mjs
git commit -m "feat: add AI analysis client"
```

### Task 5: Learner-Facing Double-Column UI

**Files:**
- Modify: `index.html`
- Replace: `styles.css`
- Create: `src/app.mjs`
- Remove: `script.js`

- [ ] **Step 1: Replace the page shell**

Use semantic sections for the header, privacy strip, input column, sticky result column, consent checkbox, status region with `aria-live="polite"`, result cards, and conditional export actions. Remove the course-round field and all real-name examples. Load:

```html
<script type="module" src="./src/app.mjs"></script>
```

- [ ] **Step 2: Implement the approved visual system**

Define CSS variables for deep green, warm cream, clay, amber A, clay B, and green C. Use a two-column grid above 960px and one column below it. Keep the result column sticky only on desktop. Add visible focus states, disabled states, loading state, and reduced-motion support.

- [ ] **Step 3: Implement page state and analysis flow**

Use one state object:

```js
const state = {
  status: "idle",
  mode: null,
  scenes: [],
  error: null,
  generatedAt: null
};
```

Require transcript and checked consent before AI calls. Disable the analysis button while running. On AI failure, show the reason and a separate “使用基础分析” button; do not silently disguise the fallback as AI.

- [ ] **Step 4: Implement editable A/B/C cards**

Render each scene with editable textareas for `a`, `b`, and `c`, and read-only `sourceQuote` and `sourceLocation`. Save edits into `state.scenes`, set `revised: true`, and show “学员已修订”. Escape all model text before inserting HTML, or build result nodes with `textContent`.

- [ ] **Step 5: Implement anonymous example and safe clearing**

The example uses only `学员` and `家人`. “清空” asks for confirmation only when text or results exist. After success on mobile, scroll the result heading into view.

- [ ] **Step 6: Update copy and exports**

Generate JSON, CSV, and readable text from `state.scenes`. Include `mode`, `generatedAt`, `revised`, evidence, risk, limitations, and source location. Never include the DeepSeek key or Worker internals.

- [ ] **Step 7: Run all tests and commit**

Run: `npm test`

Expected: all local, client, schema, and Worker tests PASS.

```bash
git add index.html styles.css src/app.mjs src/local-analyzer.mjs src/api-client.mjs script.js
git commit -m "feat: redesign learner ABC workbench"
```

### Task 6: Cloudflare Provisioning and Secret Entry

**Files:**
- Modify: `worker/wrangler.jsonc`

- [ ] **Step 1: Install dependencies and authenticate Wrangler**

Run: `npm install`

Expected: Wrangler installs without audit-blocking errors.

Run: `npx wrangler login`

Expected: the user completes Cloudflare browser authorization and Wrangler reports successful login.

- [ ] **Step 2: Configure the Durable Object rate limiter**

Confirm `worker/wrangler.jsonc` declares the `RATE_LIMITER` binding and the `RateLimiter` class migration:

```jsonc
"durable_objects": {
  "bindings": [{ "name": "RATE_LIMITER", "class_name": "RateLimiter" }]
},
"migrations": [{ "tag": "v1", "new_sqlite_classes": ["RateLimiter"] }]
```

No KV namespace is used or provisioned. Wrangler creates the Durable Object class storage from the migration during deployment.

- [ ] **Step 3: Deploy the Worker code**

Run: `npx wrangler deploy --config worker/wrangler.jsonc`

Expected: deployment initially reports required secrets missing, proving secret validation is active.

- [ ] **Step 4: Let the user enter secrets interactively**

Run: `npx wrangler secret put DEEPSEEK_API_KEY --config worker/wrangler.jsonc`

The user, not the agent, enters the DeepSeek key at the hidden prompt.

Run: `npx wrangler secret put RATE_LIMIT_SALT --config worker/wrangler.jsonc`

The user enters exactly 64 hexadecimal characters generated from 32 random bytes at the hidden prompt, matching Worker validation. Do not print either value.

- [ ] **Step 5: Deploy and capture the public endpoint**

Run: `npx wrangler deploy --config worker/wrangler.jsonc`

Expected: output includes `https://abc-analysis-api.<account-subdomain>.workers.dev`.

- [ ] **Step 6: Commit only public configuration**

```bash
git add worker/wrangler.jsonc package-lock.json
git commit -m "chore: configure Cloudflare deployment"
```

### Task 7: Connect, Verify, and Publish

**Files:**
- Modify: `index.html`
- Modify: `src/api-client.mjs`
- Modify: `tests/api-client.test.mjs`
- Modify: `tests/ui-bindings.test.mjs`
- Modify: `README.md`
- Modify: `docs/superpowers/plans/2026-08-28-ai-abc-workbench-implementation.md`

- [ ] **Step 1: Set and pin the public Worker endpoint**

Set `index.html` meta `abc-api-endpoint` to the exact deployed `https://abc-analysis-api.codex-ai-abc-workbench.workers.dev/analyze` URL. Pin `src/api-client.mjs` validation to that exact HTTPS hostname and `/analyze` path; reject credentials, query, fragment, and every explicit port.

- [ ] **Step 2: Run automated verification**

Run: `npm test`

Expected: all tests PASS with zero failures.

- [ ] **Step 3: Run a safe live smoke request (deployment phase only)**

Send an anonymous three-line example to the Worker. Confirm HTTP 200, `mode: "ai"`, a `scenes` array, and no API key or raw upstream metadata in the response.

- [ ] **Step 4: Verify failure paths**

Confirm an unapproved `Origin` returns 403, empty transcript returns 400, sixth request in the same hour returns 429, and the UI exposes the explicit basic-analysis fallback.

- [ ] **Step 5: Verify the public page**

Check desktop and mobile widths. Confirm there is no course-round field, no real-person example, consent blocks submission, A/B/C edits persist into JSON and CSV, original quotes are read-only, and risk copy is non-diagnostic.

- [ ] **Step 6: Update documentation**

Document the public page, Worker endpoint, privacy behavior, DeepSeek billing responsibility, secret rotation command, limit behavior, local test command, and redeploy command. Do not include secret values.

- [ ] **Step 7: Commit locally, then publish only after local approval**

```bash
git add index.html src/api-client.mjs tests/api-client.test.mjs tests/ui-bindings.test.mjs README.md docs/superpowers/plans/2026-08-28-ai-abc-workbench-implementation.md
git commit -m "docs: document AI deployment and privacy"
```

Expected for the local/code phase: all checks pass and the public-file commit is ready, with no push and no network calls. A later explicitly approved deployment phase may push and verify GitHub Pages plus the live Worker.
