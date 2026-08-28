export const REQUIRED_ELEMENT_IDS = Object.freeze({
  nickname: "nickname",
  date: "session-date",
  transcript: "transcript",
  consent: "privacy-consent",
  analyze: "analyze-button",
  clear: "clear-button",
  sample: "sample-button",
  basic: "basic-button",
  message: "form-message",
  status: "status-region",
  summary: "summary",
  risk: "risk-support",
  results: "results",
  exports: "export-section",
  json: "json-button",
  csv: "csv-button",
  copy: "copy-button",
  resultColumn: "result-column",
  resultTitle: "result-title",
});

export function collectRequiredElements(documentObject) {
  return Object.fromEntries(Object.entries(REQUIRED_ELEMENT_IDS).map(([name, id]) => {
    const element = documentObject.getElementById(id);
    if (!element) throw new Error(`Missing required element #${id}`);
    return [name, element];
  }));
}

export function setLoadingDisabled(elements, loading) {
  for (const name of ["nickname", "date", "transcript", "consent", "sample", "clear", "analyze"]) {
    elements[name].disabled = loading;
  }
}

export function attachTopLevelListeners(elements, handlers) {
  elements.analyze.addEventListener("click", handlers.onAnalyze);
  elements.basic.addEventListener("click", handlers.onFallback);
  elements.clear.addEventListener("click", handlers.onClear);
  elements.sample.addEventListener("click", handlers.onSample);
  elements.consent.addEventListener("change", handlers.onInput);
  for (const name of ["nickname", "date", "transcript"]) elements[name].addEventListener("input", handlers.onInput);
  elements.json.addEventListener("click", handlers.onExportJson);
  elements.csv.addEventListener("click", handlers.onExportCsv);
  elements.copy.addEventListener("click", handlers.onCopy);
}
