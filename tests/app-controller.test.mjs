import test from "node:test";
import assert from "node:assert/strict";

import { createAnalysisController, safeAnalysisErrorMessage, validateAnalysisInput, validateBasicAnalysisInput } from "../src/analysis-controller.mjs";

function deferred() {
  let resolve;
  let reject;
  const promise = new Promise((res, rej) => { resolve = res; reject = rej; });
  return { promise, resolve, reject };
}

test("validation requires transcript text and consent", () => {
  assert.equal(validateAnalysisInput({ transcript: "", consent: true }), "请先填写经历或逐字稿。");
  assert.equal(validateAnalysisInput({ transcript: "经历", consent: false }), "请阅读并勾选隐私说明后再使用 AI 分析。");
  assert.equal(validateAnalysisInput({ transcript: " 经历 ", consent: true }), "");
});

test("basic analysis validation requires text but never AI consent", () => {
  assert.equal(validateBasicAnalysisInput({ transcript: "", consent: false }), "请先填写经历或逐字稿。");
  assert.equal(validateBasicAnalysisInput({ transcript: "经历", consent: false }), "");
});

test("safe API failure reasons are preserved and unsafe messages fall back", () => {
  for (const message of [
    "请求过于频繁，请稍后重试",
    "AI 分析超时，请稍后重试",
    "提交内容过长，请精简后重试",
  ]) assert.equal(safeAnalysisErrorMessage(new Error(message)), message);

  const fallback = "AI 分析暂时没有完成。可以重试，或选择不发送文本的基础分析。";
  assert.equal(safeAnalysisErrorMessage("请求失败"), fallback);
  assert.equal(safeAnalysisErrorMessage({ message: "伪造消息" }), fallback);
  assert.equal(safeAnalysisErrorMessage(new Error(" ")), fallback);
  assert.equal(safeAnalysisErrorMessage(new Error("x".repeat(201))), fallback);
});

test("duplicate analysis is suppressed while a request is loading", async () => {
  const pending = deferred();
  let calls = 0;
  const controller = createAnalysisController(async () => { calls += 1; return pending.promise; });
  const first = controller.submit({ nickname: "一", date: "2026-08-28", transcript: "内容" });
  const duplicate = await controller.submit({ nickname: "二", date: "2026-08-29", transcript: "另一段" });

  assert.deepEqual(duplicate, { accepted: false, committed: false, reason: "loading" });
  assert.equal(calls, 1);
  pending.resolve({ mode: "ai", scenes: [] });
  await first;
});

test("clear invalidates a pending request so its completion is ignored", async () => {
  const pending = deferred();
  const controller = createAnalysisController(() => pending.promise);
  const request = controller.submit({ nickname: "旧昵称", date: "2026-08-28", transcript: "旧内容" });

  controller.invalidate();
  pending.resolve({ mode: "ai", scenes: [{ id: "old" }] });

  assert.deepEqual(await request, { accepted: true, committed: false, reason: "stale" });
  assert.equal(controller.isLoading(), false);
  assert.equal(controller.getResult(), null);
});

test("a stale completion cannot overwrite a newer successful request", async () => {
  const oldRequest = deferred();
  const newRequest = deferred();
  let call = 0;
  const controller = createAnalysisController(() => (++call === 1 ? oldRequest.promise : newRequest.promise));
  const oldSubmit = controller.submit({ nickname: "旧", date: "2026-08-27", transcript: "旧内容" });
  controller.invalidate();
  const newSubmit = controller.submit({ nickname: "新", date: "2026-08-28", transcript: "新内容" });
  newRequest.resolve({ mode: "ai", scenes: [{ id: "new" }] });
  await newSubmit;
  oldRequest.resolve({ mode: "ai", scenes: [{ id: "old" }] });

  assert.equal((await oldSubmit).committed, false);
  assert.equal(controller.getResult().scenes[0].id, "new");
});

test("successful result retains a submit-time context snapshot", async () => {
  const context = { nickname: "提交昵称", date: "2026-08-28", transcript: "原始内容" };
  const controller = createAnalysisController(async () => ({ mode: "ai", scenes: [] }));
  const result = await controller.submit(context);
  context.nickname = "后来修改";
  context.date = "2026-09-01";

  assert.equal(result.committed, true);
  assert.equal(controller.getResult().analysisContext.nickname, "提交昵称");
  assert.equal(controller.getResult().analysisContext.date, "2026-08-28");
  assert.match(controller.getResult().analysisContext.transcriptFingerprint, /^4:[0-9a-f]{8}$/);
  assert.equal("transcript" in controller.getResult().analysisContext, false);
});
