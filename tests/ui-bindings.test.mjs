import test from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

import {
  REQUIRED_ELEMENT_IDS,
  attachTopLevelListeners,
  collectRequiredElements,
  setLoadingDisabled,
} from "../src/ui-bindings.mjs";

class FakeControl extends EventTarget {
  constructor(id) { super(); this.id = id; this.disabled = false; }
}

function fakeDocument(missingId = "") {
  const controls = new Map(Object.values(REQUIRED_ELEMENT_IDS).filter((id) => id !== missingId).map((id) => [id, new FakeControl(id)]));
  return { controls, getElementById(id) { return controls.get(id) ?? null; } };
}

test("collectRequiredElements collects every required index control and reports a missing ID", () => {
  const complete = fakeDocument();
  const elements = collectRequiredElements(complete);
  assert.deepEqual(Object.keys(elements), Object.keys(REQUIRED_ELEMENT_IDS));
  for (const [name, id] of Object.entries(REQUIRED_ELEMENT_IDS)) assert.equal(elements[name].id, id);

  assert.throws(() => collectRequiredElements(fakeDocument("transcript")), /Missing required element #transcript/);
});

test("index contains every required ID, trusted endpoint meta, and module script", async () => {
  const html = await readFile(new URL("../index.html", import.meta.url), "utf8");
  for (const id of Object.values(REQUIRED_ELEMENT_IDS)) assert.match(html, new RegExp(`id=["']${id}["']`));
  assert.match(html, /<meta name="abc-api-endpoint" content="">/);
  assert.match(html, /<script type="module" src="\.\/src\/app\.mjs"><\/script>/);
});

test("setLoadingDisabled freezes all mutable submission controls and restores them", () => {
  const elements = collectRequiredElements(fakeDocument());
  const names = ["nickname", "date", "transcript", "consent", "sample", "clear", "analyze"];
  setLoadingDisabled(elements, true);
  for (const name of names) assert.equal(elements[name].disabled, true, name);
  setLoadingDisabled(elements, false);
  for (const name of names) assert.equal(elements[name].disabled, false, name);
});

test("top-level listeners invoke each injected handler exactly once", () => {
  const elements = collectRequiredElements(fakeDocument());
  const calls = { analyze: 0, fallback: 0, clear: 0, sample: 0, input: 0, json: 0, csv: 0, copy: 0 };
  attachTopLevelListeners(elements, {
    onAnalyze: () => calls.analyze++, onFallback: () => calls.fallback++, onClear: () => calls.clear++, onSample: () => calls.sample++,
    onInput: () => calls.input++, onExportJson: () => calls.json++, onExportCsv: () => calls.csv++, onCopy: () => calls.copy++,
  });

  elements.analyze.dispatchEvent(new Event("click"));
  elements.basic.dispatchEvent(new Event("click"));
  elements.clear.dispatchEvent(new Event("click"));
  elements.sample.dispatchEvent(new Event("click"));
  elements.consent.dispatchEvent(new Event("change"));
  elements.transcript.dispatchEvent(new Event("input"));
  elements.json.dispatchEvent(new Event("click"));
  elements.csv.dispatchEvent(new Event("click"));
  elements.copy.dispatchEvent(new Event("click"));

  assert.deepEqual(calls, { analyze: 1, fallback: 1, clear: 1, sample: 1, input: 2, json: 1, csv: 1, copy: 1 });
});
