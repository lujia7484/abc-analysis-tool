const extractBtn = document.getElementById("extractBtn");
const clearBtn = document.getElementById("clearBtn");
const exportJsonBtn = document.getElementById("exportJsonBtn");
const exportCsvBtn = document.getElementById("exportCsvBtn");
const copyBtn = document.getElementById("copyBtn");
const resultsEl = document.getElementById("results");
const summaryBar = document.getElementById("summaryBar");
const readableOutput = document.getElementById("readableOutput");

const studentNameInput = document.getElementById("studentName");
const sessionDateInput = document.getElementById("sessionDate");
const sessionRoundInput = document.getElementById("sessionRound");
const transcriptInput = document.getElementById("transcript");

let lastPayload = [];

const ANCHOR = [
  "因为",
  "由于",
  "作业没",
  "没做完",
  "老师",
  "家长",
  "提醒",
  "要求",
  "说要",
  "看到",
  "当",
  "先",
  "先前",
  "刚刚",
  "然后",
];

const BEHAVIOR = [
  "不想",
  "不愿",
  "拒绝",
  "推脱",
  "没做",
  "没写",
  "推开",
  "逃",
  "沉默",
  "哭",
  "闹",
  "发火",
  "打",
  "摔",
  "抗拒",
  "走开",
  "扔",
  "发脾气",
  "说不",
  "不配合",
];

const CONSEQUENCE = [
  "结果",
  "于是",
  "于是乎",
  "随后",
  "后来",
  "最后",
  "老师说",
  "家长说",
  "马上",
  "情绪",
  "安静",
  "继续",
  "没再",
  "不再",
  "做了",
  "完成",
  "离开",
  "回到",
  "缓和",
  "升级",
];

const RISK = [
  "离家",
  "自伤",
  "轻生",
  "暴力",
  "打人",
  "摔东西",
  "无法确认安全",
  "危险",
  "逃跑",
];

const tsRegex = /(?:\[(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?)\]|\b(\d{1,2}:\d{2}(?::\d{2})?(?:\.\d+)?))\s*/g;
const lineSpeakerRegex = /^\s*([^\[\]:：]+?)(?:：|:)\s*(.*)$/;

function formatDate(dateStr) {
  if (!dateStr) return "";
  const d = new Date(dateStr);
  if (Number.isNaN(d.getTime())) return dateStr;
  return d.toISOString().slice(0, 10);
}

function toCsvField(value) {
  if (value === undefined || value === null) return '""';
  const escaped = String(value).replace(/"/g, '""');
  return `"${escaped}"`;
}

function hasWord(text, arr) {
  const t = text.toLowerCase();
  return arr.some((k) => t.includes(k));
}

function extractTimestamp(line) {
  const matches = [...line.matchAll(tsRegex)];
  if (!matches.length) return "";
  const hit = matches[0][1] || matches[0][2];
  return hit || "";
}

function parseTranscript(raw) {
  const lines = raw.split(/\r?\n/);
  const utterances = [];
  for (const ln of lines) {
    const line = ln.trim();
    if (!line) continue;

    const ts = extractTimestamp(line);
    let body = line.replace(tsRegex, "").trim();
    let speaker = "未标注";
    let text = body;
    const m = body.match(lineSpeakerRegex);
    if (m) {
      speaker = m[1].trim();
      text = m[2].trim();
    }
    if (!text) continue;
    utterances.push({ timestamp: ts || "无时间戳", speaker, text });
  }
  return utterances;
}

function scoreEvidence(item) {
  let hasA = hasWord(item.aText.join(""), ANCHOR) ? 1 : 0;
  let hasB = hasWord(item.bText.join(""), BEHAVIOR) ? 1 : 0;
  let hasC = hasWord(item.cText.join(""), CONSEQUENCE) ? 1 : 0;
  const n = [hasA, hasB, hasC].filter(Boolean).length;
  if (n >= 2 && hasB) return "高";
  if (n >= 2) return "中";
  return "低";
}

function detectRisk(text) {
  const t = text.toLowerCase();
  const matched = RISK.filter((k) => t.includes(k));
  if (!matched.length) return "无";
  if (matched.includes("无法确认安全")) return "安全待确认";
  if (matched.includes("自伤") || matched.includes("轻生")) return "自伤/轻生";
  if (matched.includes("暴力") || matched.includes("打人")) return "暴力风险";
  if (matched.includes("离家")) return "离家风险";
  return matched.join("、");
}

function buildScenarios(utterances) {
  const scenarios = [];
  let i = 0;
  let sceneNo = 1;

  const maxLookahead = 9;

  while (i < utterances.length) {
    const u = utterances[i];
    if (!hasWord(u.text, ANCHOR)) {
      i += 1;
      continue;
    }

    const aIndex = i;
    let bIndex = -1;
    let cIndex = -1;
    for (let j = aIndex + 1; j < Math.min(utterances.length, aIndex + maxLookahead); j++) {
      if (bIndex === -1 && hasWord(utterances[j].text, BEHAVIOR)) {
        bIndex = j;
      }
      if (bIndex !== -1 && j > bIndex && hasWord(utterances[j].text, CONSEQUENCE)) {
        cIndex = j;
        break;
      }
    }

    if (bIndex === -1 && cIndex === -1) {
      i += 1;
      continue;
    }

    const aText = [utterances[aIndex]];
    const bText = bIndex >= 0 ? [utterances[bIndex]] : [];
    const cText = cIndex >= 0 ? [utterances[cIndex]] : [];

    const anchorText = aText.map((x) => `${x.speaker}（${x.timestamp}）：${x.text}`).join("\n");
    const behText = bText.map((x) => `${x.speaker}（${x.timestamp}）：${x.text}`).join("\n");
    const consText = cText.map((x) => `${x.speaker}（${x.timestamp}）：${x.text}`).join("\n");
    const allText = [anchorText, behText, consText].filter(Boolean).join("\n");

    const evidence = scoreEvidence({ aText: aText.map((x) => x.text), bText: bText.map((x) => x.text), cText: cText.map((x) => x.text) });
    const risk = detectRisk(allText);

    scenarios.push({
      场景序号: sceneNo++,
      课堂标题: "待命名（可在系统中补充）",
      起因: {
        text: anchorText || "未标注",
      },
      经过: {
        text: behText || "待补充（未识别到明确行为）",
      },
      结果: {
        text: consText || "待补充（未识别到明确后果）",
      },
      孩子表达: behText.includes("孩子") ? behText : "待补录（建议二次核查原文）",
      孩子行动: bText.length ? bText.map((x) => x.text).join("；") : "",
      家长想法: aText
        .filter((x) => /家长|妈妈|爸爸|父亲|母亲/.test(x.speaker))
        .map((x) => `${x.speaker}：${x.text}`)
        .join("\n") || "待补录（如有家长原话请补齐）",
      家长情绪: consText.includes("哭") || consText.includes("着急") ? "可能有情绪波动" : "未直接命中",
      家长回应: cText.map((x) => `${x.speaker}：${x.text}`).join("\n") || "待补录",
      老师现场点评: cText.filter((x) => /老师|导师/.test(x.speaker)).map((x) => `${x.speaker}：${x.text}`).join("\n") || "缺失",
      原文定位: `${utterances[aIndex]?.timestamp || "无"}-${utterances[cIndex]?.timestamp || utterances[bIndex]?.timestamp || "无"}`,
      原文摘录: allText,
      证据等级: evidence,
      风险标记: risk,
      关系建议: {
        关联长期事件: "",
        关联指导轮次: "",
      },
    });

    i = Math.max(aIndex + 1, cIndex + 1, bIndex + 1);
  }

  if (!scenarios.length) {
    return [];
  }
  return scenarios;
}

function buildReadable(sessions, summary) {
  const header = `学员：${summary.studentName || "未填写"}
课程日期：${summary.date}
课程期次：${summary.round}
识别场景数：${sessions.length}
-------------------------------------------------`;

  const body = sessions
    .map((s) => {
      return `
场景 ${s.场景序号}
- A（起因）：${s.起因.text}
- B（经过）：${s.经过.text}
- C（结果）：${s.结果.text}
- 证据等级：${s.证据等级}
- 风险标记：${s.风险标记}
-------------------------------------------------`;
    })
    .join("\n");

  return `${header}\n${body}`.trim();
}

function render(scenarios) {
  resultsEl.innerHTML = "";
  if (!scenarios.length) {
    resultsEl.innerHTML = `<div class="card"><p>当前逐字稿中未匹配到完整 ABC 场景。建议补充“起因-行为-结果”原文线索后再重试。</p></div>`;
    exportJsonBtn.disabled = true;
    exportCsvBtn.disabled = true;
    copyBtn.disabled = true;
    readableOutput.value = "";
    summaryBar.textContent = "未识别到符合条件的场景（或需手动补充线索）";
    return;
  }

  summaryBar.textContent = `已提取 ${scenarios.length} 个候选场景，生成时间：${new Date().toLocaleString("zh-CN", { hour12: false })}`;

  for (const s of scenarios) {
    const card = document.createElement("section");
    card.className = "card";
    const tagClass =
      s.证据等级 === "高" ? "high" : s.证据等级 === "中" ? "middle" : "low";
    card.innerHTML = `
      <div class="tagrow">
        <span class="tag ${tagClass}">证据等级：${s.证据等级}</span>
        <span class="tag low">风险：${s.风险标记}</span>
        <span class="tag middle">原文定位：${s.原文定位}</span>
      </div>
      <h3>场景 ${s.场景序号}：${s.课堂标题}</h3>
      <div class="meta">原文摘录（只读）</div>
      <div class="block"><b>A（起因）</b><div class="quote">${s.起因.text}</div></div>
      <div class="block"><b>B（经过）</b><div class="quote">${s.经过.text}</div></div>
      <div class="block"><b>C（结果）</b><div class="quote">${s.结果.text}</div></div>
      <div class="block"><b>老师现场点评</b><div class="quote">${s.老师现场点评}</div></div>
    `;
    resultsEl.appendChild(card);
  }

  exportJsonBtn.disabled = false;
  exportCsvBtn.disabled = false;
  copyBtn.disabled = false;
  readableOutput.value = buildReadable(scenarios, {
    studentName: studentNameInput.value.trim(),
    date: formatDate(sessionDateInput.value),
    round: sessionRoundInput.value.trim() || "未填写",
  });
}

function onExtract() {
  const raw = transcriptInput.value.trim();
  if (!raw) {
    alert("请先粘贴逐字稿内容。");
    return;
  }
  const utterances = parseTranscript(raw);
  const scenarios = buildScenarios(utterances);
  lastPayload = scenarios;
  render(scenarios);
}

function toJSONExport() {
  const payload = {
    学员: studentNameInput.value.trim() || "未填写",
    课程日期: formatDate(sessionDateInput.value),
    课程期次: sessionRoundInput.value.trim() || "未填写",
    提取时间: new Date().toLocaleString("zh-CN", { hour12: false }),
    场景: lastPayload,
  };
  const blob = new Blob([JSON.stringify(payload, null, 2)], { type: "application/json;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "abc-extract-result.json";
  a.click();
  URL.revokeObjectURL(url);
}

function toCsvExport() {
  const header = [
    "场景序号",
    "起因",
    "经过",
    "结果",
    "原文定位",
    "证据等级",
    "风险标记",
    "孩子表达",
    "老师现场点评",
  ];

  const rows = lastPayload.map((s) => [
    s.场景序号,
    s.起因.text,
    s.经过.text,
    s.结果.text,
    s.原文定位,
    s.证据等级,
    s.风险标记,
    s.孩子表达,
    s.老师现场点评,
  ]);

  const csv = [header.map(toCsvField).join(","), ...rows.map((r) => r.map(toCsvField).join(","))].join("\n");
  const blob = new Blob(["\uFEFF" + csv], { type: "text/csv;charset=utf-8;" });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = "abc-extract-result.csv";
  a.click();
  URL.revokeObjectURL(url);
}

function onCopy() {
  if (!readableOutput.value) return;
  navigator.clipboard.writeText(readableOutput.value);
  alert("已复制到剪贴板。");
}

function onClear() {
  transcriptInput.value = "";
  studentNameInput.value = "";
  sessionDateInput.value = "";
  sessionRoundInput.value = "";
  resultsEl.innerHTML = "";
  readableOutput.value = "";
  lastPayload = [];
  summaryBar.textContent = "等待解析...";
  exportJsonBtn.disabled = true;
  exportCsvBtn.disabled = true;
  copyBtn.disabled = true;
}

extractBtn.addEventListener("click", onExtract);
exportJsonBtn.addEventListener("click", toJSONExport);
exportCsvBtn.addEventListener("click", toCsvExport);
copyBtn.addEventListener("click", onCopy);
clearBtn.addEventListener("click", onClear);
