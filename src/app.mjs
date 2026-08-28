import { analyzeWithAI, setApiEndpoint } from "./api-client.mjs";
import { analyzeLocally } from "./local-analyzer.mjs";
import { createAnalysisController, validateAnalysisInput } from "./analysis-controller.mjs";
import { buildExportPayload, buildReadable, toCsv, updateScene } from "./result-model.mjs";

const $ = (id) => document.getElementById(id);
const el = { nickname: $("nickname"), date: $("session-date"), transcript: $("transcript"), consent: $("privacy-consent"), analyze: $("analyze-button"), clear: $("clear-button"), sample: $("sample-button"), basic: $("basic-button"), message: $("form-message"), status: $("status-region"), summary: $("summary"), risk: $("risk-support"), results: $("results"), exports: $("export-section"), json: $("json-button"), csv: $("csv-button"), copy: $("copy-button"), resultColumn: $("result-column"), resultTitle: $("result-title") };
let state = { status: "empty", mode: null, scenes: [], error: "", generatedAt: null, analysisContext: null };
let endpointReady = false;
// Trust boundary: the AI endpoint may only come from this static deployment-owned meta tag.
const endpoint = document.querySelector('meta[name="abc-api-endpoint"]')?.content.trim() || "";
if (endpoint) { try { setApiEndpoint(endpoint); endpointReady = true; } catch { endpointReady = false; } }
const controller = createAnalysisController(analyzeWithAI);

const SAMPLE = ["学员：老师提醒我今天先完成约定的练习。", "学员：我觉得计划突然被打乱了，就说不想继续，转身离开了房间。", "家人：我先停下来，没有继续催促。", "老师：后来大家等情绪缓和后，再一起确认了下一步。"].join("\n");

function node(tag, className, text) { const item = document.createElement(tag); if (className) item.className = className; item.textContent = text; return item; }
function button(label, className, handler) { const item = node("button", className, label); item.type = "button"; item.addEventListener("click", handler); return item; }
function setStatus(kind, message) { el.status.dataset.state = kind; el.status.replaceChildren(node("p", "", message)); }
function modeLabel(mode) { return mode === "ai" ? "AI分析" : "基础分析"; }
function payload() { return buildExportPayload({ nickname: state.analysisContext?.nickname, date: state.analysisContext?.date, mode: state.mode, generatedAt: state.generatedAt, scenes: state.scenes }); }
function tag(text, risk = false) { return node("span", `tag${risk ? " risk" : ""}`, text); }

function abcBlock(letter, label, value) {
  const block = node("div", "abc-block", ""); const body = document.createElement("div");
  body.append(node("strong", "", label), node("p", "", value)); block.append(node("span", "abc-letter", letter), body); return block;
}

function focusCard(sceneId) {
  const card = [...el.results.querySelectorAll(".scene-card")].find((item) => item.dataset.sceneId === String(sceneId));
  (card?.querySelector(".edit-button") || card?.querySelector("h3"))?.focus();
}

function editCard(scene, card) {
  const form = document.createElement("form");
  [["title", "场景标题"], ["a", "A 起因"], ["b", "B 行为"], ["c", "C 结果"]].forEach(([field, label]) => {
    const wrapper = node("label", "edit-field", label); const input = field === "title" ? document.createElement("input") : document.createElement("textarea");
    if (field === "title") input.type = "text"; input.name = field; input.value = scene[field]; input.required = true; wrapper.append(input); form.append(wrapper);
  });
  const actions = node("div", "card-actions", "");
  const save = button("保存修改", "primary", () => {}); save.type = "submit";
  save.setAttribute("aria-label", `保存场景 ${scene.title} 的修改`);
  const cancel = button("取消", "secondary", () => { render("已取消编辑，内容未更改。"); focusCard(scene.id); });
  cancel.setAttribute("aria-label", `取消编辑场景 ${scene.title}`);
  actions.append(save, cancel); form.append(actions);
  form.addEventListener("submit", (event) => { event.preventDefault(); state = { ...state, scenes: updateScene(state.scenes, scene.id, Object.fromEntries(new FormData(form))) }; render("修改已保存。"); focusCard(scene.id); });
  card.replaceChildren(form); form.querySelector("input").focus();
}

function renderCard(scene, index) {
  const card = node("article", "scene-card", ""); card.dataset.sceneId = String(scene.id); const tags = node("div", "tags", "");
  tags.append(tag(`证据：${scene.evidenceLevel}`), tag(`风险：${scene.riskType}`, scene.riskType !== "无")); if (scene.revised) tags.append(tag("已修订"));
  const evidence = document.createElement("details"); evidence.className = "evidence";
  evidence.append(node("summary", "", "查看只读原始证据"), node("blockquote", "", scene.sourceQuote), node("p", "", `原文位置：${scene.sourceLocation || "无时间戳"}`));
  const actions = node("div", "card-actions", ""); const edit = button("编辑 A / B / C", "secondary edit-button", () => editCard(scene, card)); edit.setAttribute("aria-label", `编辑场景 ${scene.title} 的标题和 A B C`); actions.append(edit);
  const heading = node("h3", "", `${index + 1}. ${scene.title}`); heading.tabIndex = -1;
  card.append(tags, heading, abcBlock("A", "起因", scene.a), abcBlock("B", "行为", scene.b), abcBlock("C", "结果", scene.c), node("div", "details", `局限：${scene.limitations || "未注明。请结合更多情境理解这份草稿。"}`), evidence, actions);
  return card;
}

function render(announcement = "") {
  const success = state.status === "success"; const hasResults = success && state.scenes.length > 0;
  const loading = state.status === "loading";
  [el.nickname, el.date, el.transcript, el.consent, el.sample, el.clear, el.analyze].forEach((item) => { item.disabled = loading; });
  el.basic.hidden = state.status !== "error" || !el.transcript.value.trim(); el.summary.hidden = !success; el.risk.hidden = true; el.exports.hidden = !hasResults;
  [el.json, el.csv, el.copy].forEach((item) => { item.disabled = !hasResults; }); el.results.replaceChildren();
  if (state.status === "empty") setStatus("empty", "你的观察草稿会出现在这里。先在左侧写下一段经历。");
  if (state.status === "loading") setStatus("loading", "正在整理文字中的起因、行为与结果，请稍候……");
  if (state.status === "error") setStatus("error", state.error);
  if (!success) return;
  setStatus("success", announcement || `${modeLabel(state.mode)}已完成，生成 ${state.scenes.length} 个场景。`);
  el.summary.replaceChildren(node("strong", "", `${modeLabel(state.mode)} · 观察草稿`), document.createTextNode(`　${state.scenes.length} 个场景`));
  if (!state.scenes.length) el.results.append(node("p", "status-card", "暂未识别到清晰的 ABC 场景。可以补充更具体的起因、行为和后续结果后重试。")); else state.scenes.forEach((scene, index) => el.results.append(renderCard(scene, index)));
  const risks = [...new Set(state.scenes.map(({ riskType }) => riskType).filter((risk) => risk && risk !== "无"))];
  if (risks.length) { el.risk.hidden = false; el.risk.textContent = `草稿中出现“${risks.join("、")}”相关线索。这不是诊断。如果你或他人可能正处于危险中，请尽快联系可信任的成年人或专业人员；情况紧急时，请立即联系当地紧急救助。`; }
}

function scrollAndFocusResults() { if (window.matchMedia("(max-width: 959px)").matches) el.resultColumn.scrollIntoView({ behavior: "smooth", block: "start" }); el.resultTitle.focus({ preventScroll: true }); }

async function analyzeAI() {
  const context = { nickname: el.nickname.value.trim(), date: el.date.value, transcript: el.transcript.value.trim(), consent: el.consent.checked };
  const validation = validateAnalysisInput(context); el.message.textContent = validation; if (validation || controller.isLoading()) return;
  if (!endpointReady) { state = { status: "error", mode: null, scenes: [], error: "AI 分析服务尚未配置。你可以稍后再试，或使用基础分析在本机整理。", generatedAt: null, analysisContext: null }; render(); return; }
  state = { status: "loading", mode: null, scenes: [], error: "", generatedAt: null, analysisContext: null }; render();
  const outcome = await controller.submit(context);
  if (!outcome.committed) return;
  if (outcome.error) { state = { status: "error", mode: null, scenes: [], error: "AI 分析暂时没有完成。可以重试，或选择不发送文本的基础分析。", generatedAt: null, analysisContext: null }; render(); return; }
  const result = outcome.result;
  state = { status: "success", mode: result.mode, scenes: result.scenes, error: "", generatedAt: new Date().toISOString(), analysisContext: result.analysisContext }; render(); scrollAndFocusResults();
}

function analyzeBasic() { if (!el.transcript.value.trim()) return; controller.invalidate(); const analysisContext = { nickname: el.nickname.value.trim(), date: el.date.value }; const result = analyzeLocally(el.transcript.value.trim()); state = { status: "success", mode: result.mode, scenes: result.scenes, error: "", generatedAt: new Date().toISOString(), analysisContext }; render(); scrollAndFocusResults(); }
function download(content, type, filename) { const url = URL.createObjectURL(new Blob([content], { type })); const link = document.createElement("a"); link.href = url; link.download = filename; document.body.append(link); link.click(); link.remove(); setTimeout(() => URL.revokeObjectURL(url), 0); }

el.analyze.addEventListener("click", analyzeAI); el.basic.addEventListener("click", analyzeBasic);
el.sample.addEventListener("click", () => { el.transcript.value = SAMPLE; el.message.textContent = ""; });
el.clear.addEventListener("click", () => { const hasData = el.nickname.value || el.date.value || el.transcript.value || el.consent.checked || state.status !== "empty"; if (hasData && !window.confirm("要清空输入和当前观察草稿吗？")) return; controller.invalidate(); el.nickname.value = ""; el.date.value = ""; el.transcript.value = ""; el.consent.checked = false; el.message.textContent = ""; state = { status: "empty", mode: null, scenes: [], error: "", generatedAt: null, analysisContext: null }; render(); });
el.json.addEventListener("click", () => download(JSON.stringify(payload(), null, 2), "application/json;charset=utf-8", "abc-observation-draft.json"));
el.csv.addEventListener("click", () => download(toCsv(payload()), "text/csv;charset=utf-8", "abc-observation-draft.csv"));
el.copy.addEventListener("click", async () => { try { await navigator.clipboard.writeText(buildReadable(payload())); el.message.textContent = "已复制当前观察草稿。"; } catch { el.message.textContent = "复制失败，请检查浏览器的剪贴板权限后重试。"; } });
render();
