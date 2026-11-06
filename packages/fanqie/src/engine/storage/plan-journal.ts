import { journal, requireValid, type InputWrite } from "./journal.js";
import { assertSourceId } from "./primitives.js";
const recovery = journal({
  file: ".writer-plan-pending.json",
  label: "拆书计划更新",
  scope: "library",
  root: (dir: string) => dir,
  completed: "已完成",
  pending: "待处理",
  decode: (r) => {
    const sourceId = assertSourceId(r.sourceId),
      base = `analyses/${sourceId}`;
    requireValid(typeof r.clearConfirm === "boolean");
    return {
      details: { sourceId },
      targets: [
        { file: `${base}/plan.json` },
        { file: `${base}/plan.md` },
        { file: `${base}/meta.json` },
        ...(r.clearConfirm ? [{ file: `${base}/plan-confirm.json`, remove: true }] : []),
      ],
    };
  },
});
export const hasPendingPlan = recovery.has,
  assertNoPendingPlan = recovery.assertNone;
export function createPlanJournal(
  dir: string,
  input: { sourceId: string; clearConfirm: boolean; writes: InputWrite[] },
) {
  return recovery.create(dir, input);
}
export const finishPlanJournal = recovery.finish,
  inspectPendingPlan = recovery.inspect,
  resumePendingPlan = recovery.resume;
