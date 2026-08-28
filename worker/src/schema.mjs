const EVIDENCE_LEVELS = new Set(['高', '中', '低']);
const RISK_TYPES = new Set(['无', '离家', '自伤/轻生', '暴力', '安全待确认']);

function trimmedString(value) {
  return typeof value === 'string' ? value.trim() : '';
}

function sceneFieldString(value) {
  if (value == null) return '';
  if (!['string', 'number', 'boolean'].includes(typeof value)) {
    throw new Error('模型输出格式无效');
  }
  if (typeof value === 'number' && !Number.isFinite(value)) {
    throw new Error('模型输出格式无效');
  }
  return String(value).trim();
}

export function validateInput(input) {
  if (!input || typeof input !== 'object' || Array.isArray(input)) {
    throw new Error('输入格式无效');
  }

  const transcript = trimmedString(input.transcript);
  if (!transcript) throw new Error('逐字稿不能为空');
  if (transcript.length > 20_000) throw new Error('逐字稿不能超过 20000 字符');

  const normalized = { transcript };
  const nickname = trimmedString(input.nickname);
  const date = trimmedString(input.date);
  if (nickname.length > 50) throw new Error('昵称不能超过 50 字符');
  if (date && (date.length > 10 || !/^\d{4}-\d{2}-\d{2}$/.test(date))) {
    throw new Error('日期格式必须为 YYYY-MM-DD');
  }
  if (nickname) normalized.nickname = nickname;
  if (date) normalized.date = date;
  return normalized;
}

export function normalizeModelOutput(output) {
  if (!output || typeof output !== 'object' || Array.isArray(output)) {
    throw new Error('模型输出格式无效');
  }
  if (!Array.isArray(output.scenes)) throw new Error('模型输出格式无效');
  if (output.scenes.length === 0) throw new Error('模型未返回有效场景');

  const scenes = output.scenes.slice(0, 20).map((scene, index) => {
    if (!scene || typeof scene !== 'object' || Array.isArray(scene)) {
      throw new Error('模型输出格式无效');
    }

    const evidenceLevel = sceneFieldString(scene.evidenceLevel);
    const riskType = sceneFieldString(scene.riskType);
    return {
      id: `scene-${index + 1}`,
      title: sceneFieldString(scene.title),
      a: sceneFieldString(scene.a),
      b: sceneFieldString(scene.b),
      c: sceneFieldString(scene.c),
      sourceQuote: sceneFieldString(scene.sourceQuote),
      sourceLocation: sceneFieldString(scene.sourceLocation) || '无时间戳',
      evidenceLevel: EVIDENCE_LEVELS.has(evidenceLevel) ? evidenceLevel : '低',
      riskType: RISK_TYPES.has(riskType) ? riskType : '安全待确认',
      limitations: sceneFieldString(scene.limitations),
      revised: typeof scene.revised === 'boolean' ? scene.revised : false,
    };
  });

  return { scenes };
}
