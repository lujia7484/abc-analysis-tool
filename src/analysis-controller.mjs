export function validateAnalysisInput({ transcript, consent }) {
  if (!transcript?.trim()) return "请先填写经历或逐字稿。";
  if (!consent) return "请阅读并勾选隐私说明后再使用 AI 分析。";
  return "";
}

function fingerprintTranscript(transcript) {
  let hash = 0x811c9dc5;
  for (const character of transcript) {
    hash ^= character.codePointAt(0);
    hash = Math.imul(hash, 0x01000193);
  }
  return `${transcript.length}:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

export function createAnalysisController(runAnalysis) {
  let generation = 0;
  let loading = false;
  let result = null;

  return {
    async submit(context) {
      if (loading) return { accepted: false, committed: false, reason: "loading" };

      const requestGeneration = ++generation;
      const analysisContext = Object.freeze({
        nickname: context.nickname,
        date: context.date,
        transcriptFingerprint: fingerprintTranscript(context.transcript),
      });
      loading = true;

      try {
        const analysis = await runAnalysis({
          nickname: context.nickname,
          date: context.date,
          transcript: context.transcript,
        });
        if (requestGeneration !== generation) {
          return { accepted: true, committed: false, reason: "stale" };
        }
        result = Object.freeze({ ...analysis, analysisContext });
        return { accepted: true, committed: true, result };
      } catch (error) {
        if (requestGeneration !== generation) {
          return { accepted: true, committed: false, reason: "stale" };
        }
        return { accepted: true, committed: true, error };
      } finally {
        if (requestGeneration === generation) loading = false;
      }
    },
    invalidate() {
      generation += 1;
      loading = false;
      result = null;
    },
    isLoading() {
      return loading;
    },
    getResult() {
      return result;
    },
  };
}
