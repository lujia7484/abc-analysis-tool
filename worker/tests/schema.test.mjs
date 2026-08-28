import test from 'node:test';
import assert from 'node:assert/strict';

import { normalizeModelOutput, validateInput } from '../src/schema.mjs';

test('validateInput rejects an empty transcript', () => {
  assert.throws(() => validateInput({ transcript: '   ' }), /逐字稿不能为空/);
});

test('validateInput rejects transcripts longer than 20,000 characters', () => {
  assert.throws(
    () => validateInput({ transcript: '字'.repeat(20_001) }),
    /逐字稿不能超过 20000 字符/,
  );
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
    riskType: '无',
    limitations: 'false',
    revised: false,
  });
});

test('normalizeModelOutput restricts evidence and risk enums to safe defaults', () => {
  const result = normalizeModelOutput({ scenes: [
    { evidenceLevel: '确定', riskType: '焦虑' },
    { evidenceLevel: '中', riskType: '离家' },
    { evidenceLevel: '低', riskType: '自伤' },
    { evidenceLevel: '高', riskType: '轻生' },
    { evidenceLevel: '高', riskType: '暴力' },
    { evidenceLevel: '高', riskType: '安全待确认' },
  ] });

  assert.deepEqual(result.scenes.map(({ evidenceLevel, riskType }) => ({ evidenceLevel, riskType })), [
    { evidenceLevel: '低', riskType: '无' },
    { evidenceLevel: '中', riskType: '离家' },
    { evidenceLevel: '低', riskType: '自伤' },
    { evidenceLevel: '高', riskType: '轻生' },
    { evidenceLevel: '高', riskType: '暴力' },
    { evidenceLevel: '高', riskType: '安全待确认' },
  ]);
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
