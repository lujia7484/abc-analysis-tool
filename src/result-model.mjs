const EXPORTED_SCENE_FIELDS = [
  "id",
  "title",
  "a",
  "b",
  "c",
  "evidenceLevel",
  "riskType",
  "limitations",
  "sourceLocation",
  "sourceQuote",
  "revised",
];

const CSV_HEADERS = [
  ["昵称", "nickname"],
  ["日期", "date"],
  ["分析方式", "mode"],
  ["生成时间", "generatedAt"],
  ["场景编号", "id"],
  ["标题", "title"],
  ["A 起因", "a"],
  ["B 行为", "b"],
  ["C 结果", "c"],
  ["证据等级", "evidenceLevel"],
  ["风险标记", "riskType"],
  ["局限", "limitations"],
  ["原文位置", "sourceLocation"],
  ["原文摘录", "sourceQuote"],
  ["是否修订", "revised"],
];

export function updateScene(scenes, sceneId, draft) {
  return scenes.map((scene) => (
    scene.id === sceneId
      ? { ...scene, title: draft.title, a: draft.a, b: draft.b, c: draft.c, revised: true }
      : scene
  ));
}

export function buildExportPayload({ nickname, date, mode, generatedAt, scenes }) {
  return {
    nickname: nickname?.trim() || "匿名学员",
    date: date || "未填写",
    mode,
    generatedAt,
    scenes: scenes.map((scene) => Object.fromEntries(
      EXPORTED_SCENE_FIELDS.map((field) => [field, scene[field]]),
    )),
  };
}

export function buildReadable(payload) {
  const modeLabel = payload.mode === "ai" ? "AI分析" : "基础分析";
  const scenes = payload.scenes.map((scene, index) => [
    `场景 ${index + 1}：${scene.title}`,
    `A（起因）：${scene.a}`,
    `B（行为）：${scene.b}`,
    `C（结果）：${scene.c}`,
    `证据等级：${scene.evidenceLevel}`,
    `风险标记：${scene.riskType}`,
    `局限：${scene.limitations || "未注明"}`,
    `原文位置：${scene.sourceLocation || "无时间戳"}`,
    `原文摘录：${scene.sourceQuote}`,
    `已由学员修订：${scene.revised ? "是" : "否"}`,
  ].join("\n")).join("\n\n");

  return [
    `${modeLabel} · 观察草稿`,
    `学员：${payload.nickname}`,
    `日期：${payload.date}`,
    `生成时间：${payload.generatedAt}`,
    "本结果用于帮助整理观察，不构成诊断。",
    "",
    scenes,
  ].join("\n").trim();
}

function csvField(value) {
  return `"${String(value ?? "").replaceAll('"', '""')}"`;
}

export function toCsv(payload) {
  const header = CSV_HEADERS.map(([label]) => csvField(label)).join(",");
  const rows = payload.scenes.map((scene) => {
    const record = { ...scene, ...payload };
    return CSV_HEADERS.map(([, field]) => csvField(record[field])).join(",");
  });
  return `\uFEFF${[header, ...rows].join("\r\n")}`;
}
