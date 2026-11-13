import { journal, text, requireValid, type InputWrite } from "./journal.js";
import { assertResourceId } from "./primitives.js";
type Kind = "save" | "brief" | "payoff" | "lint" | "stage";
const recovery = journal({
  file: ".writer-chapter-pending.json",
  label: "章节、候选或留痕操作",
  root: (dir: string) => dir,
  decode: (r) => {
    const kind = r.kind;
    requireValid(
      kind === "save" ||
        kind === "brief" ||
        kind === "payoff" ||
        kind === "lint" ||
        kind === "stage",
    );
    const chapterId = text(r.chapterId),
      candidateId =
        kind === "lint" || kind === "stage" ? assertResourceId(text(r.candidateId)) : undefined;
    const ledger = kind === "save" && Array.isArray(r.writes) && r.writes.length === 3;
    const files =
      kind === "save"
        ? [
            `chapters/${assertResourceId(chapterId)}.md`,
            "meta.json",
            ...(ledger ? ["ledger.json"] : []),
          ]
        : kind === "brief" || kind === "payoff"
          ? [kind === "brief" ? "brief-crumbs.json" : "payoff-audits.json", "ledger.json"]
          : kind === "lint"
            ? [`candidates/${candidateId}.json`, "ledger.json"]
            : [`candidates/${candidateId}.md`, `candidates/${candidateId}.json`];
    return {
      details: { chapterId, candidateId, kind },
      targets: files.map((file) => ({ file, absent: kind === "stage" })),
    };
  },
});
export const hasPendingChapterSave = recovery.has,
  assertNoPendingChapterSave = recovery.assertNone;
export function createChapterJournal(
  dir: string,
  input: { chapterId: string; writes: InputWrite[] },
) {
  return recovery.create(dir, { ...input, kind: "save" });
}
export function createWorkRecordJournal(
  dir: string,
  input: {
    kind: Exclude<Kind, "save">;
    chapterId: string;
    candidateId?: string;
    writes: InputWrite[];
  },
) {
  return recovery.create(dir, input);
}
export const finishChapterJournal = recovery.finish,
  inspectPendingChapterSave = recovery.inspect,
  resumePendingChapterSave = recovery.resume;
