import { analyzeWithAI, setApiEndpoint } from "./api-client.mjs";
import { analyzeLocally } from "./local-analyzer.mjs";
import { buildExportPayload, buildReadable, toCsv, updateScene } from "./result-model.mjs";

const $ = (id) => document.getElementById(id);
const el = { nickname: $("nickname"), date: $("session-date"), transcript: $("transcript"), consent: $("privacy-consent"), analyze: $("analyze-button"), clear: $("clear-button"), sample: $("sample-button"), basic: $("basic-button"), message: $("form-message"), status: $("status-region"), summary: $("summary"), risk: $("risk-support"), results: $("results"), exports: $("export-section"), json: $("json-button"), csv: $("csv-button"), copy: $("copy-button"), resultColumn: $("result-column") };
let state = { status: "empty", mode: null, scenes: [], error: "", generatedAt: null };
let endpointReady = false;
const endpoint = document.querySelector('meta[name="abc-api-endpoint"]')?.content.trim() || "";
if (endpoint) { try { setApiEndpoint(endpoint); endpointReady = true; } catch { endpointReady = false; } }

const SAMPLE = ["学员：老师提醒我今天先完成约定的练习。", "学员：我觉得计划突然被打乱了，就说不想继续，转身离开了房间。", "家人：我先停下来，没有继续催促。", "老师：后来大家等情绪缓和后，再一起确认了下一步。"].join("\n");

function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; item.textContent = text; return item; }
function button(label, className, handler) { const item = node("button", className, label); item.type = "button"; item.addEventListener("click", handler); return item; }
function setStatus(kind, message) { el.status.dataset.state = kind; el.status.replaceChildren(node("p", "", message)); }
function modeLabel(mode) { return mode === "ai" ? "AI分析" : "基础分析"; }
function payload() { return buildExportPayload({ nickname: el.nickname.value, date: el.date.value, mode: state.mode, generatedAt: state.generatedAt, scenes: state.scenes }); }
function tag(text, risk = false) { return node("span", `tag${risk ? " risk" : ""}`, text); }

function abcBlock(letter, label, value) {
  const block = node("div", "abc-block", ""); const body = document.createElement("div");
  body.append(node("strong", "", label), node("p", "", value)); block.append(node("span", "abc-letter", letter), body); return block;
}

function editCard(scene, card) {
  const form = document.createElement("form");
  [["title", "场景标题"], ["a", "A 起因"], ["b", "B 行为"], ["c", "C 结果"]].forEach(([field, label]) => {
    const wrapper = node("label", "edit-field", label); const input = field === "title" ? document.createElement("input") : document.createElement("textarea");
    if (field === "title") input.type = "text"; input.name = field; input.value = scene[field]; input.required = true; wrapper.append(input); form.append(wrapper);
  });
  const actions = node("div", "card-actions", "");
  const save = button("保存修改", "primary", () => {}); save.type = "submit";
  actions.append(save, button("取消", "secondary", render)); form.append(actions);
  form.addEventListener("submit", (event) => { event.preventDefault(); state = { ...state, scenes: updateScene(state.scenes, scene.id, Object.fromEntries(new FormData(form))) }; render(); });
  card.replaceChildren(form); form.querySelector("input").focus();
}

function renderCard(scene, index) {
  const card = node("article", "scene-card", ""); const tags = node("div", "tags", "");
  tags.append(tag(`证据：${scene.evidenceLevel}`), tag(`风险：${scene.riskType}`, scene.riskType !== "无")); if (scene.revised) tags.append(tag("已修订"));
  const evidence = document.createElement("details"); evidence.className = "evidence";
  evidence.append(node("summary", "", "查看只读原始证据"), node("blockquote", "", scene.sourceQuote), node("p", "", `原文位置：${scene.sourceLocation || "无时间戳"}`));
  const actions = node("div", "card-actions", ""); actions.append(button("编辑 A / B / C", "secondary", () => editCard(scene, card)));
  card.append(tags, node("h3", "", `${index + 1}. ${scene.title}`), abcBlock("A", "起因", scene.a), abcBlock("B", "行为", scene.b), abcBlock("C", "结果", scene.c), node("div", "details", `局限：${scene.limitations || "未注明。请结合更多情境理解这份草稿。"}`), evidence, actions);
  return card;
}

function render() {
  const success = state.status === "success"; const hasResults = success && state.scenes.length > 0;
  el.analyze.disabled = state.status === "loading"; el.basic.hidden = state.status !== "error" || !el.transcript.value.trim(); el.status.hidden = success; el.summary.hidden = !success; el.risk.hidden = true; el.exports.hidden = !hasResults;
  [el.json, el.csv, el.copy].forEach((item) => { item.disabled = !hasResults; }); el.results.replaceChildren();
  if (state.status === "empty") setStatus("empty", "你的观察草稿会出现在这里。先在左侧写下一段经历。");
  if (state.status === "loading") setStatus("loading", "正在整理文字中的起因、行为与结果，请稍候……");
  if (state.status === "error") setStatus("error", state.error);
  if (!success) return;
  el.status.replaceChildren(); el.status.removeAttribute("data-state");
  el.summary.replaceChildren(node("strong", "", `${modeLabel(state.mode)} · 观察草稿`), document.createTextNode(`　${state.scenes.length} 个场景`));
  if (!state.scenes.length) el.results.append(node("p", "status-card", "暂未识别到清晰的 ABC 场景。可以补充更具体的起因、行为和后续结果后重试。")); else state.scenes.forEach((scene, index) => el.results.append(renderCard(scene, index)));
  const risks = [...new Set(state.scenes.map(({ riskType }) => riskType).filter((risk) => risk && risk !== "无"))];
  if (risks.length) { el.risk.hidden = false; el.risk.textContent = `草稿中出现“${risks.join("、")}”相关线索。这不是诊断。如果你或他人可能正处于危险中，请尽快联系可信任的成年人或专业人员；情况紧急时，请立即联系当地紧急救助。`; }
}

function validationMessage() { if (!el.transcript.value.trim()) return "请先填写经历或逐字稿。"; if (!el.consent.checked) return "请阅读并勾选隐私说明后再使用 AI 分析。"; return ""; }
function scrollMobile() { if (window.matchMedia("(max-width: 959px)").matches) el.resultColumn.scrollIntoView({ behavior: "smooth", block: "start" }); }

async function analyzeAI() {
  const validation = validationMessage(); el.message.textContent = validation; if (validation || state.status === "loading") return;
  if (!endpointReady) { state = { status: "error", mode: null, scenes: [], error: "AI 分析服务尚未配置。你可以稍后再试，或使用基础分析在本机整理。", generatedAt: null }; render(); return; }
  state = { status: "loading", mode: null, scenes: [], error: "", generatedAt: null }; render();
  try { const result = await analyzeWithAI({ nickname: el.nickname.value.trim(), date: el.date.value, transcript: el.transcript.value.trim() }); state = { status: "success", mode: result.mode, scenes: result.scenes, error: "", generatedAt: new Date().toISOString() }; render(); scrollMobile(); }
  catch { state = { status: "error", mode: null, scenes: [], error: "AI 分析暂时没有完成。你的文字未被本服务保存，可以重试或选择基础分析。", generatedAt: null }; render(); }
}

function analyzeBasic() { if (!el.transcript.value.trim()) return; const result = analyzeLocally(el.transcript.value.trim()); state = { status: "success", mode: result.mode, scenes: result.scenes, error: "", generatedAt: new Date().toISOString() }; render(); scrollMobile(); }
function download(content, type, filename) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; link.click(); URL.revokeObjectURL(url); }

el.analyze.addEventListener("click", analyzeAI); el.basic.addEventListener("click", analyzeBasic);
el.sample.addEventListener("click", () => { el.transcript.value = SAMPLE; el.message.textContent = ""; });
el.clear.addEventListener("click", () => { const hasData = el.nickname.value || el.date.value || el.transcript.value || el.consent.checked || state.status !== "empty"; if (hasData && !window.confirm("要清空输入和当前观察草稿吗？")) return; el.nickname.value = ""; el.date.value = ""; el.transcript.value = ""; el.consent.checked = false; el.message.textContent = ""; state = { status: "empty", mode: null, scenes: [], error: "", generatedAt: null }; render(); });
el.json.addEventListener("click", () => download(JSON.stringify(payload(), null, 2), "application/json;charset=utf-8", "abc-observation-draft.json"));
el.csv.addEventListener("click", () => download(toCsv(payload()), "text/csv;charset=utf-8", "abc-observation-draft.csv"));
el.copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(buildReadable(payload())); el.message.textContent = "已复制当前观察草稿。"; } catch { el.message.textContent = "复制失败，请检查浏览器的剪贴板权限后重试。"; } });
render();
