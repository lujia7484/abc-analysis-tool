export const EVIDENCE_LEVELS = Object.freeze(["高", "中", "低"]);
export const RISK_TYPES = Object.freeze(["无", "离家", "自伤", "轻生", "暴力", "安全待确认"]);
export const SCENE_LIMITS = Object.freeze({
  title: 200,
  a: 5000,
  b: 5000,
  c: 5000,
  sourceQuote: 12000,
  sourceLocation: 200,
  limitations: 2000,
  maxScenes: 20,
});

export const UNGROUNDED_QUOTE = "待补充（未能在输入原文中核对）";
const REQUIRED_FIELDS = new Set(["title", "a", "b", "c", "sourceQuote"]);
const TIMESTAMP_PATTERN = /\b\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?\b/g;

function invalidScene() {
  return new Error("模型输出格式无效");
}

function normalizeField(scene, field) {
  const value = scene[field];
  if (typeof value !== "string") throw invalidScene();
  const normalized = value.trim();
  if (normalized.length > SCENE_LIMITS[field]) throw invalidScene();
  if (REQUIRED_FIELDS.has(field) && !normalized) throw invalidScene();
  return normalized;
}

function appendBoundary(limitations, boundary) {
  if (limitations.includes(boundary)) return limitations;
  return [limitations, boundary].filter(Boolean).join("；").slice(0, SCENE_LIMITS.limitations);
}

export function createSceneId(index) {
  return `scene-${index + 1}`;
}

export function normalizeEvidenceLevel(value) {
  return EVIDENCE_LEVELS.includes(value) ? value : "低";
}

export function normalizeRiskType(value) {
  return RISK_TYPES.includes(value) ? value : "安全待确认";
}

export function normalizeScene(scene, index, transcript) {
  if (!scene || typeof scene !== "object" || Array.isArray(scene)) throw invalidScene();
  const normalized = {
    id: createSceneId(index),
    title: normalizeField(scene, "title"),
    a: normalizeField(scene, "a"),
    b: normalizeField(scene, "b"),
    c: normalizeField(scene, "c"),
    sourceQuote: normalizeField(scene, "sourceQuote"),
    sourceLocation: normalizeField(scene, "sourceLocation") || "无时间戳",
    evidenceLevel: normalizeEvidenceLevel(scene.evidenceLevel),
    riskType: normalizeRiskType(scene.riskType),
    limitations: normalizeField(scene, "limitations"),
    revised: false,
  };

  if (typeof transcript !== "string") return normalized;
  const submittedTranscript = transcript.trim();
  if (!submittedTranscript.includes(normalized.sourceQuote)) {
    normalized.sourceQuote = UNGROUNDED_QUOTE;
    normalized.evidenceLevel = "低";
    normalized.limitations = appendBoundary(normalized.limitations, "原文摘录未能在输入原文中核对");
  }

  if (normalized.sourceLocation !== "无时间戳") {
    const timestamps = normalized.sourceLocation.match(TIMESTAMP_PATTERN) ?? [];
    if (!timestamps.length || timestamps.some((timestamp) => !submittedTranscript.includes(timestamp))) {
      normalized.sourceLocation = "无时间戳";
      normalized.limitations = appendBoundary(normalized.limitations, "时间戳未能在输入原文中核对");
    }
  }
  return normalized;
}

export function normalizeScenes(scenes, transcript) {
  if (!Array.isArray(scenes) || scenes.length === 0 || scenes.length > SCENE_LIMITS.maxScenes) {
    throw invalidScene();
  }
  return scenes.map((scene, index) => normalizeScene(scene, index, transcript));
}
