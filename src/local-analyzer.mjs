import { normalizeScene, SCENE_LIMITS } from "./scene-contract.mjs";

const ANCHOR = [
  "因为", "由于", "作业没", "没做完", "老师", "家长", "提醒", "要求",
  "说要", "看到", "当", "先", "先前", "刚刚", "然后",
];

const BEHAVIOR = [
  "不想", "不愿", "拒绝", "推脱", "没做", "没写", "推开", "逃", "沉默",
  "哭", "闹", "发火", "打", "摔", "抗拒", "走开", "扔", "发脾气",
  "说不", "不配合",
];

const CONSEQUENCE = [
  "结果", "于是", "于是乎", "随后", "后来", "最后", "老师说", "家长说",
  "马上", "情绪", "安静", "继续", "没再", "不再", "做了", "完成",
  "离开", "回到", "缓和", "升级",
];

const RISK = [
  "离家", "自伤", "轻生", "暴力", "打人", "摔东西", "无法确认安全",
  "危险", "逃跑",
];

const TIMESTAMP_PATTERN = /(?:\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]|\b(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?))\s*/g;
const SPEAKER_PATTERN = /^\s*([^\[\]:：]+?)(?:：|:)\s*(.*)$/;

function hasWord(text, words) {
  const normalized = text.toLowerCase();
  return words.some((word) => normalized.includes(word));
}

function extractTimestamp(line) {
  const match = [...line.matchAll(TIMESTAMP_PATTERN)][0];
  return match ? match[1] || match[2] || "" : "";
}

export function parseTranscript(raw) {
  const utterances = [];

  for (const rawLine of raw.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line) continue;

    const timestamp = extractTimestamp(line);
    const body = line.replace(TIMESTAMP_PATTERN, "").trim();
    const speakerMatch = body.match(SPEAKER_PATTERN);
    const speaker = speakerMatch ? speakerMatch[1].trim() : "未标注";
    const text = speakerMatch ? speakerMatch[2].trim() : body;

    if (text) {
      const utterance = {
        timestamp: timestamp || "无时间戳",
        speaker,
        text,
      };
      Object.defineProperty(utterance, "sourceLine", { value: line });
      utterances.push(utterance);
    }
  }

  return utterances;
}

function scoreEvidence(aText, bText, cText) {
  const hasA = hasWord(aText.join(""), ANCHOR);
  const hasB = hasWord(bText.join(""), BEHAVIOR);
  const hasC = hasWord(cText.join(""), CONSEQUENCE);
  const matchedParts = [hasA, hasB, hasC].filter(Boolean).length;

  if (matchedParts >= 2 && hasB) return "高";
  if (matchedParts >= 2) return "中";
  return "低";
}

function detectRisk(text) {
  const normalized = text.toLowerCase();
  const matched = RISK.filter((keyword) => normalized.includes(keyword));

  if (!matched.length) return "无";
  if (matched.includes("无法确认安全")) return "安全待确认";
  if (matched.includes("自伤")) return "自伤";
  if (matched.includes("轻生")) return "轻生";
  if (matched.includes("暴力") || matched.includes("打人") || matched.includes("摔东西")) return "暴力";
  if (matched.includes("离家") || matched.includes("逃跑")) return "离家";
  return "安全待确认";
}

function formatUtterances(utterances) {
  return utterances
    .map(({ speaker, timestamp, text }) => `${speaker}（${timestamp}）：${text}`)
    .join("\n");
}

function formatSourceLocation(start, end) {
  const timestamps = [start, end].filter((timestamp) => timestamp && timestamp !== "无时间戳");
  if (!timestamps.length) return "无时间戳";
  if (timestamps.length === 1) return timestamps[0];
  return `${timestamps[0]}-${timestamps[1]}`;
}

function buildScenes(utterances, sourceTranscript) {
  const scenes = [];
  const maxLookahead = 9;
  let index = 0;

  while (index < utterances.length) {
    if (!hasWord(utterances[index].text, ANCHOR)) {
      index += 1;
      continue;
    }

    const aIndex = index;
    let bIndex = -1;
    let cIndex = -1;

    for (let next = aIndex + 1; next < Math.min(utterances.length, aIndex + maxLookahead); next += 1) {
      if (bIndex === -1 && hasWord(utterances[next].text, BEHAVIOR)) bIndex = next;
      if (bIndex !== -1 && next > bIndex && hasWord(utterances[next].text, CONSEQUENCE)) {
        cIndex = next;
        break;
      }
    }

    if (bIndex === -1 && cIndex === -1) {
      index += 1;
      continue;
    }

    const aItems = [utterances[aIndex]];
    const bItems = bIndex >= 0 ? [utterances[bIndex]] : [];
    const cItems = cIndex >= 0 ? [utterances[cIndex]] : [];
    const a = formatUtterances(aItems);
    const b = formatUtterances(bItems);
    const c = formatUtterances(cItems);
    const sourceQuote = [a, b, c].filter(Boolean).join("\n");
    const limitations = [
      bItems.length ? "" : "未识别到明确行为",
      cItems.length ? "" : "未识别到明确后果",
    ].filter(Boolean).join("；");

    const candidate = {
      title: "行为循环场景",
      a: a || "未标注",
      b: b || "待补充（未识别到明确行为）",
      c: c || "待补充（未识别到明确后果）",
      sourceQuote: utterances[aIndex].sourceLine,
      sourceLocation: formatSourceLocation(
        utterances[aIndex].timestamp,
        utterances[cIndex]?.timestamp || utterances[bIndex]?.timestamp,
      ),
      evidenceLevel: scoreEvidence(
        aItems.map(({ text }) => text),
        bItems.map(({ text }) => text),
        cItems.map(({ text }) => text),
      ),
      riskType: detectRisk(sourceQuote),
      limitations,
    };

    try {
      scenes.push(normalizeScene(candidate, scenes.length, sourceTranscript));
    } catch {
      // A single malformed or oversized candidate must not break local analysis.
    }

    index = Math.max(aIndex + 1, cIndex + 1, bIndex + 1);
    if (scenes.length === SCENE_LIMITS.maxScenes) break;
  }

  return scenes;
}

export function analyzeLocally(raw) {
  return {
    mode: "basic",
    scenes: buildScenes(parseTranscript(raw), raw),
  };
}
