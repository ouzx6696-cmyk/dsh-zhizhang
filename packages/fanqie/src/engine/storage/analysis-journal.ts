import { journal, text, requireValid, type InputWrite } from "./journal.js";
import { assertSourceId } from "./primitives.js";
const allowed = new Set(["chapters.jsonl", "plots.jsonl", "rhythms.json", "characters.json"]);
const recovery = journal({
  file: ".writer-analysis-pending.json",
  label: "拆书分析更新",
  scope: "library",
  root: (dir: string) => dir,
  decode: (r) => {
    const sourceId = assertSourceId(r.sourceId),
      dataFile = text(r.dataFile);
    requireValid(allowed.has(dataFile));
    return {
      details: { sourceId, dataFile },
      targets: [`analyses/${sourceId}/${dataFile}`, `analyses/${sourceId}/meta.json`].map(
        (file) => ({ file }),
      ),
    };
  },
});
export const hasPendingAnalysis = recovery.has,
  assertNoPendingAnalysis = recovery.assertNone;
export function createAnalysisJournal(
  dir: string,
  input: { sourceId: string; dataFile: string; writes: InputWrite[] },
) {
  return recovery.create(dir, input);
}
export const finishAnalysisJournal = recovery.finish,
  inspectPendingAnalysis = recovery.inspect,
  resumePendingAnalysis = recovery.resume;
