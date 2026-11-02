import { resolveWorkDir } from "../engine/work-store.js";
import { runAccept, type AcceptInput } from "../engine/services/accept.js";
import { toErrorResult } from "../engine/errors.js";
import type { StoragePaths } from "../engine/types.js";
type PanelAcceptInput = Omit<AcceptInput, "paths" | "dir" | "workKey" | "candidateId" | "panel"> & {
  work: string;
  candidate: string;
  confirm: boolean;
};
export async function runPanelAccept(paths: StoragePaths, req: PanelAcceptInput) {
  if (!req.work || !req.candidate)
    return { ok: false as const, code: "bad_args", error: "work 与 candidate 不能为空" };
  if (!req.confirm)
    return {
      ok: false as const,
      code: "confirm_required",
      error: "面板采纳须二次确认：传 confirm=true。禁止静默成功。",
      needConfirm: true,
    };
  try {
    const { work, candidate, confirm: _confirm, ...options } = req;
    const dir = await resolveWorkDir(paths, work);
    return runAccept({
      ...options,
      paths,
      dir,
      workKey: work,
      candidateId: candidate,
      panel: true,
    });
  } catch (error) {
    return toErrorResult(error, "work_not_found");
  }
}
