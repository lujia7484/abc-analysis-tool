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
        id: "scene-1",
        title: "行为循环场景",
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
        riskType: "暴力",
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
        id: "scene-1",
        title: "行为循环场景",
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

test("maps fallback risk keywords only to the shared enum", () => {
  const cases = [
    ["离家", "离家"], ["自伤", "自伤"], ["轻生", "轻生"], ["打人", "暴力"],
    ["摔东西", "暴力"], ["危险", "安全待确认"], ["无法确认安全", "安全待确认"],
  ];
  for (const [keyword, expected] of cases) {
    const result = analyzeLocally(`因为被提醒\n我拒绝并${keyword}\n后来暂停`);
    assert.equal(result.scenes[0].riskType, expected, keyword);
  }
});
