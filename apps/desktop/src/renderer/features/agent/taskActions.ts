import { newRequestId } from "@writer/ui/request";
import { fanqie, toutiao } from "../../../../../../packages/workbench/src/client/shared/api.js";
import type { Focus, Target } from "../../../context";
import type { DesktopState } from "../../state/store";
import { desktop } from "../../state/desktop";

type TaskActionDependencies = {
  selected: Target | null;
  focus: Focus;
  canLeave: () => Promise<boolean>;
  selectSnapshot: (
    next: Target & { focus?: Focus },
    persist?: boolean,
    reopen?: boolean,
  ) => Promise<void>;
  sendText: (value: string, snapshot?: Focus) => Promise<void>;
  set: (patch: Partial<DesktopState> | ((state: DesktopState) => Partial<DesktopState>)) => void;
};

export async function startNewWork(
  deps: TaskActionDependencies,
  mode: "fanqie" | "toutiao",
  note = "",
) {
  if (!(await deps.canLeave())) return;
  const next = await desktop.newTarget(mode);
  await deps.selectSnapshot(next, false);
  deps.set((current) => ({
    workspaceKey: current.workspaceKey + 1,
    view: "writing",
    tab: "agent",
    drawer: true,
  }));
  if (mode === "toutiao")
    await toutiao.deliver({
      root: next.root,
      action: "new",
      note,
      requestId: newRequestId("desktop"),
    });
  else
    await deps.sendText(
      "【写作台】创建一本新的长篇作品。" +
        (note ? "书名、题材或想法：" + note : "先和我确定书名与一句话题材。") +
        "作品创建后先完成开书规划，不自动写正文。",
      { intent: "plan" },
    );
  deps.set({ picker: false, onboarding: false });
}

export async function deliverAction(deps: TaskActionDependencies, action: string, note = "") {
  const target = deps.selected,
    snapshot = { ...deps.focus };
  if (!target) throw new Error("请先选择作品");
  if (target.mode === "toutiao" && action !== "new" && !snapshot.article && !target.article)
    throw new Error("请先选择一篇文章，再执行此操作");
  const body =
    target.mode === "fanqie"
      ? {
          base: target.root,
          work: target.work,
          chapter: action === "continue" ? undefined : snapshot.chapter,
          action,
          note,
          confirm: true,
          requestId: newRequestId("desktop"),
        }
      : {
          root: target.root,
          id: snapshot.article || target.article,
          action,
          note,
          confirm: true,
          requestId: newRequestId("desktop"),
        };
  if (target.mode === "fanqie") await fanqie.deliver(body);
  else await toutiao.deliver(body);
  deps.set({ tab: "agent", drawer: true });
}
