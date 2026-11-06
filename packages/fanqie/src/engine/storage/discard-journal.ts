import { journal, text, validHash, requireValid } from "./journal.js";
import { sha256 } from "../../../../core/src/fsx.js";
import { assertResourceId } from "./primitives.js";
const recovery = journal({
  file: ".writer-discard-pending.json",
  label: "删卡操作",
  scope: "library",
  root: (dir: string) => dir,
  decode: (r) => {
    const cardId = assertResourceId(text(r.cardId)),
      indexContent = text(r.indexContent),
      cardFile = `cards/${cardId}.json`;
    requireValid(
      validHash(r.indexBefore) &&
        validHash(r.indexAfter) &&
        sha256(indexContent) === r.indexAfter &&
        (r.cardBefore === null || validHash(r.cardBefore)),
    );
    return {
      details: { cardId },
      targets: [{ file: "index.json" }, { file: cardFile, remove: true }],
      writes: [
        { file: "index.json", before: r.indexBefore, after: r.indexAfter, content: indexContent },
        { file: cardFile, before: r.cardBefore, after: null },
      ],
    };
  },
});
export const hasPendingDiscard = recovery.has,
  assertNoPendingDiscard = recovery.assertNone;
export function createDiscardJournal(
  dir: string,
  input: { cardId: string; indexBefore: string; indexContent: string; cardBefore: string | null },
) {
  return recovery.create(dir, { ...input, indexAfter: sha256(input.indexContent) });
}
export const finishDiscardJournal = recovery.finish,
  inspectPendingDiscard = recovery.inspect,
  resumePendingDiscard = recovery.resume;
