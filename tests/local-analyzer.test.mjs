import test from "node:test";
import assert from "node:assert/strict";

import { analyzeLocally, parseTranscript } from "../src/local-analyzer.mjs";

test("parses a timestamped anonymous utterance", () => {
  assert.deepEqual(parseTranscript("[00:12] 因为今天调整了安排"), [
    {
      timestamp: "00:12",
      speaker: "未标注",
      text: "因为今天调整了安排",
    },
  ]);
});

test("does not invent timestamps when every line lacks one", () => {
  const utterances = parseTranscript("家长：因为临时改变了计划\n孩子：我不想继续");

  assert.deepEqual(
    utterances.map(({ timestamp }) => timestamp),
    ["无时间戳", "无时间戳"],
  );
});

test("does not leak timestamp regex state across repeated parses", () => {
  assert.equal(parseTranscript("[00:01] 第一段")[0].timestamp, "00:01");
  assert.equal(parseTranscript("第二段")[0].timestamp, "无时间戳");
  assert.equal(parseTranscript("[00:03] 第三段")[0].timestamp, "00:03");
});

test("returns normalized basic scenes with existing evidence and risk labels", () => {
  const result = analyzeLocally([
    "[00:01] 家长：因为今天调整了安排",
    "[00:08] 孩子：我不想继续，还摔东西",
    "[00:15] 老师：后来情绪缓和了",
  ].join("\n"));

  assert.deepEqual(result, {
    mode: "basic",
    scenes: [
      {
        id: 1,
        title: "待命名（可在系统中补充）",
        a: "家长（00:01）：因为今天调整了安排",
        b: "孩子（00:08）：我不想继续，还摔东西",
        c: "老师（00:15）：后来情绪缓和了",
        sourceQuote: [
          "家长（00:01）：因为今天调整了安排",
          "孩子（00:08）：我不想继续，还摔东西",
          "老师（00:15）：后来情绪缓和了",
        ].join("\n"),
        sourceLocation: "00:01-00:15",
        evidenceLevel: "高",
        riskType: "摔东西",
        limitations: "",
        revised: false,
      },
    ],
  });
});

test("normalizes an untimestamped scene without inventing a source range", () => {
  const result = analyzeLocally([
    "家长：因为今天调整了安排",
    "孩子：我不想继续",
    "老师：后来情绪缓和了",
  ].join("\n"));

  assert.deepEqual(result, {
    mode: "basic",
    scenes: [
      {
        id: 1,
        title: "待命名（可在系统中补充）",
        a: "家长（无时间戳）：因为今天调整了安排",
        b: "孩子（无时间戳）：我不想继续",
        c: "老师（无时间戳）：后来情绪缓和了",
        sourceQuote: [
          "家长（无时间戳）：因为今天调整了安排",
          "孩子（无时间戳）：我不想继续",
          "老师（无时间戳）：后来情绪缓和了",
        ].join("\n"),
        sourceLocation: "无时间戳",
        evidenceLevel: "高",
        riskType: "无",
        limitations: "",
        revised: false,
      },
    ],
  });
});
