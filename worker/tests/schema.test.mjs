import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeModelOutput, validateInput } from '../src/schema.mjs';
import { SYSTEM_PROMPT } from '../src/prompt.mjs';

test('validateInput rejects an empty transcript', () => {
  assert.throws(() => validateInput({ transcript: '   ' }), /逐字稿不能为空/);
});

test('validateInput rejects transcripts longer than 20,000 characters', () => {
  assert.throws(
    () => validateInput({ transcript: '字'.repeat(20_001) }),
    /逐字稿不能超过 20000 字符/,
  );
});

test('validateInput accepts a transcript of exactly 20,000 characters', () => {
  assert.equal(validateInput({ transcript: '字'.repeat(20_000) }).transcript.length, 20_000);
});

test('validateInput trims allowed values and removes unknown fields', () => {
  assert.deepEqual(
    validateInput({ transcript: '  内容  ', nickname: ' 学员甲 ', date: ' 2026-08-28 ', ignored: true }),
    { transcript: '内容', nickname: '学员甲', date: '2026-08-28' },
  );
});

test('validateInput does not coerce a non-string transcript', () => {
  assert.throws(() => validateInput({ transcript: 123 }), /逐字稿不能为空/);
});

test('validateInput bounds nickname and validates date format', () => {
  assert.equal(validateInput({ transcript: '内容', nickname: '甲'.repeat(50) }).nickname.length, 50);
  assert.throws(
    () => validateInput({ transcript: '内容', nickname: '甲'.repeat(51) }),
    /昵称不能超过 50 字符/,
  );
  for (const date of ['2026/08/28', '2026-8-28', '2026-08-280', '明天']) {
    assert.throws(() => validateInput({ transcript: '内容', date }), /日期格式必须为 YYYY-MM-DD/);
  }
  assert.deepEqual(validateInput({ transcript: '内容', date: '   ' }), { transcript: '内容' });
  assert.equal(validateInput({ transcript: '内容', date: '2026-08-28' }).date, '2026-08-28');
});

test('validateInput rejects non-string optional fields', () => {
  assert.throws(() => validateInput({ transcript: '内容', nickname: 123 }), /昵称必须是字符串/);
  assert.throws(() => validateInput({ transcript: '内容', date: 20260828 }), /日期必须是字符串/);
});

test('validateInput rejects impossible calendar dates', () => {
  for (const date of ['2026-99-99', '2026-02-30', '2025-02-29']) {
    assert.throws(() => validateInput({ transcript: '内容', date }), /日期必须是真实日期/);
  }
  assert.equal(validateInput({ transcript: '内容', date: '2024-02-29' }).date, '2024-02-29');
});

test('normalizeModelOutput normalizes scene fields and blank source locations', () => {
  const result = normalizeModelOutput({
    scenes: [{
      title: ' 场景一 ', a: ' 前因 ', b: ' 行为 ', c: ' 结果 ',
      sourceQuote: ' 原话 ', sourceLocation: '  ', evidenceLevel: '高',
      riskType: '无', limitations: ' 无 ', unknown: 'drop me',
    }],
    unknown: true,
  });

  assert.deepEqual(result, {
    scenes: [{
      id: 'scene-1', title: '场景一', a: '前因', b: '行为', c: '结果',
      sourceQuote: '原话', sourceLocation: '无时间戳', evidenceLevel: '高',
      riskType: '无', limitations: '无', revised: false,
    }],
  });
});

test('normalizeModelOutput ignores model-provided scene IDs', () => {
  const result = normalizeModelOutput({ scenes: [{ id: 'model-id', title: '场景' }] });
  assert.equal(result.scenes[0].id, 'scene-1');
});

test('normalizeModelOutput ignores model-provided revised provenance', () => {
  const result = normalizeModelOutput({ scenes: [{ revised: true, title: '场景' }] });
  assert.equal(result.scenes[0].revised, false);
});

test('normalizeModelOutput stringifies primitive scene fields but controls revised as boolean', () => {
  const result = normalizeModelOutput({ scenes: [{
    title: 123,
    a: false,
    b: 0,
    c: null,
    sourceQuote: true,
    sourceLocation: 456,
    evidenceLevel: 1,
    riskType: false,
    limitations: false,
    revised: 'true',
  }] });

  assert.deepEqual(result.scenes[0], {
    id: 'scene-1',
    title: '123',
    a: 'false',
    b: '0',
    c: '',
    sourceQuote: 'true',
    sourceLocation: '456',
    evidenceLevel: '低',
    riskType: '安全待确认',
    limitations: 'false',
    revised: false,
  });
});

test('normalizeModelOutput restricts evidence and risk enums to safe defaults', () => {
  const result = normalizeModelOutput({ scenes: [
    { evidenceLevel: '确定', riskType: '焦虑' },
    { evidenceLevel: '中', riskType: '离家' },
    { evidenceLevel: '低', riskType: '自伤/轻生' },
    { evidenceLevel: '高', riskType: '暴力' },
    { evidenceLevel: '高', riskType: '安全待确认' },
    { evidenceLevel: '高', riskType: '无' },
  ] });

  assert.deepEqual(result.scenes.map(({ evidenceLevel, riskType }) => ({ evidenceLevel, riskType })), [
    { evidenceLevel: '低', riskType: '安全待确认' },
    { evidenceLevel: '中', riskType: '离家' },
    { evidenceLevel: '低', riskType: '自伤/轻生' },
    { evidenceLevel: '高', riskType: '暴力' },
    { evidenceLevel: '高', riskType: '安全待确认' },
    { evidenceLevel: '高', riskType: '无' },
  ]);
});

test('normalizeModelOutput rejects object and array scene-field values', () => {
  for (const value of [{ nested: true }, ['文本']]) {
    assert.throws(
      () => normalizeModelOutput({ scenes: [{ title: value }] }),
      /模型输出格式无效/,
    );
  }
});

test('normalizeModelOutput rejects malformed, empty, and non-array scenes', () => {
  for (const output of [null, '', {}, { scenes: [] }, { scenes: {} }]) {
    assert.throws(() => normalizeModelOutput(output), /模型输出格式无效|模型未返回有效场景/);
  }
});

test('normalizeModelOutput caps scenes at 20', () => {
  const result = normalizeModelOutput({
    scenes: Array.from({ length: 25 }, (_, index) => ({ title: `场景${index + 1}` })),
  });

  assert.equal(result.scenes.length, 20);
  assert.equal(result.scenes.at(-1).id, 'scene-20');
});

test('SYSTEM_PROMPT uses an exact anonymous transcript quote and the contracted risk enum', () => {
  assert.match(SYSTEM_PROMPT, /匿名逐字稿：学员：家人提醒我以后，我把书放回桌上了。/);
  assert.match(SYSTEM_PROMPT, /"sourceQuote":"学员：家人提醒我以后，我把书放回桌上了。"/);
  assert.match(SYSTEM_PROMPT, /“无”“离家”“自伤\/轻生”“暴力”“安全待确认”/);
  assert.doesNotMatch(SYSTEM_PROMPT, /“自伤”“轻生”/);
});
