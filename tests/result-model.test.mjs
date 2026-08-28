import test from "node:test";
import assert from "node:assert/strict";

import {
  buildExportPayload,
  buildReadable,
  toCsv,
  updateScene,
} from "../src/result-model.mjs";

function scene(overrides = {}) {
  return {
    id: "scene-1",
    title: "安排变化后的冲突",
    a: "家人临时调整了计划",
    b: "学员拒绝继续并离开房间",
    c: "双方暂停沟通",
    sourceQuote: "家人：今天计划有变。\n学员：我不想继续。",
    sourceLocation: "00:01-00:18",
    evidenceLevel: "高",
    riskType: "无",
    limitations: "仅依据本段文字",
    revised: false,
    ...overrides,
  };
}

test("updateScene returns a new collection and marks only the saved scene revised", () => {
  const original = [scene(), scene({ id: "scene-2", title: "第二个场景" })];
  const updated = updateScene(original, "scene-1", {
    title: "修订后的标题",
    a: "修订后的起因",
    b: "修订后的行为",
    c: "修订后的结果",
  });

  assert.notEqual(updated, original);
  assert.notEqual(updated[0], original[0]);
  assert.equal(updated[1], original[1]);
  assert.equal(updated[0].title, "修订后的标题");
  assert.equal(updated[0].a, "修订后的起因");
  assert.equal(updated[0].revised, true);
  assert.equal(original[0].title, "安排变化后的冲突");
  assert.equal(original[0].revised, false);
});

test("buildExportPayload uses current revised scenes and anonymous defaults", () => {
  const revised = updateScene([scene()], "scene-1", { c: "学员稍后恢复了沟通" });
  const payload = buildExportPayload({
    nickname: "   ",
    date: "",
    mode: "ai",
    generatedAt: "2026-08-28T04:05:06.000Z",
    scenes: revised,
  });

  assert.equal(payload.nickname, "匿名学员");
  assert.equal(payload.date, "未填写");
  assert.equal(payload.mode, "ai");
  assert.equal(payload.generatedAt, "2026-08-28T04:05:06.000Z");
  assert.equal(payload.scenes[0].c, "学员稍后恢复了沟通");
  assert.equal(payload.scenes[0].revised, true);
  assert.deepEqual(Object.keys(payload.scenes[0]), [
    "id", "title", "a", "b", "c", "evidenceLevel", "riskType",
    "limitations", "sourceLocation", "sourceQuote", "revised",
  ]);
});

test("buildReadable reports mode, observation status, provenance, and current edits", () => {
  const payload = buildExportPayload({
    nickname: "小树",
    date: "2026-08-28",
    mode: "basic",
    generatedAt: "2026-08-28T04:05:06.000Z",
    scenes: [scene({ a: "修订起因", revised: true })],
  });
  const readable = buildReadable(payload);

  assert.match(readable, /基础分析 · 观察草稿/);
  assert.match(readable, /学员：小树/);
  assert.match(readable, /A（起因）：修订起因/);
  assert.match(readable, /已由学员修订：是/);
  assert.match(readable, /证据等级：高/);
  assert.match(readable, /局限：仅依据本段文字/);
  assert.match(readable, /原文位置：00:01-00:18/);
});

test("toCsv includes BOM and escapes commas, quotes, and line breaks", () => {
  const payload = buildExportPayload({
    nickname: "匿名,学员",
    date: "",
    mode: "ai",
    generatedAt: "2026-08-28T04:05:06.000Z",
    scenes: [scene({ title: "他说\"暂停\"", a: "第一行\n第二行" })],
  });
  const csv = toCsv(payload);

  assert.equal(csv.charCodeAt(0), 0xfeff);
  assert.match(csv, /^\uFEFF"昵称","日期","分析方式"/);
  assert.match(csv, /"匿名,学员"/);
  assert.match(csv, /"他说""暂停"""/);
  assert.match(csv, /"第一行\n第二行"/);
  assert.match(csv, /"ai"/);
  assert.match(csv, /"false"/);
});
