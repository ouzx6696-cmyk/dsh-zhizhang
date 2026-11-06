import { journal, object, text, validHash, requireValid, type InputWrite } from "./journal.js";
import { assertResourceId, assertSourceId } from "./primitives.js";
import { assertNoPendingSource } from "./source-journal.js";
import { assertNoPendingDiscard } from "./discard-journal.js";
import { assertNoPendingAnalysis } from "./analysis-journal.js";
import { assertNoPendingPlan } from "./plan-journal.js";
type SourceGuard = { sourceId: string; sourceFile: string; metaHash: string; sourceHash: string };
const recovery = journal({
  file: ".writer-card-pending.json",
  label: "卡采纳",
  scope: "library",
  root: (dir: string) => dir,
  decode: (r) => {
    const candidateId = assertResourceId(text(r.candidateId)),
      cardId = assertResourceId(text(r.cardId)),
      guards = [];
    if (r.sourceGuard) {
      const g = object(r.sourceGuard),
        sourceId = assertSourceId(g.sourceId),
        sourceFile = text(g.sourceFile);
      requireValid(
        /^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(sourceFile) &&
          validHash(g.metaHash) &&
          validHash(g.sourceHash),
      );
      guards.push(
        { file: `sources/${sourceId}.json`, before: g.metaHash },
        { file: `sources/${sourceFile}`, before: g.sourceHash },
      );
    }
    return {
      details: { candidateId, cardId },
      targets: [
        { file: `cards/${cardId}.json`, absent: true },
        { file: "index.json" },
        { file: `candidates/${candidateId}.json` },
      ],
      guards,
    };
  },
});
export async function assertNoPendingCard(dir: string) {
  await assertNoPendingSource(dir);
  await assertNoPendingDiscard(dir);
  await assertNoPendingAnalysis(dir);
  await assertNoPendingPlan(dir);
  await recovery.assertNone(dir);
}
export function createCardJournal(
  dir: string,
  input: { candidateId: string; cardId: string; writes: InputWrite[]; sourceGuard?: SourceGuard },
) {
  return recovery.create(dir, input);
}
export const finishCardJournal = recovery.finish,
  inspectPendingCard = recovery.inspect,
  resumePendingCard = recovery.resume;
