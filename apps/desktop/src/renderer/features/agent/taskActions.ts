import type { Focus, Target } from "../../../context";
import type { DesktopState } from "../../state/store";
import { desktop } from "../../state/desktop";

type TaskActionDependencies = {
  selected: Target | null;
  focus: Focus;
  canLeave: () => boolean;
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
  if (!deps.canLeave()) return;
  const next = await desktop.newTarget(mode);
  await deps.selectSnapshot(next, false);
  deps.set((current) => ({
    workspaceKey: current.workspaceKey + 1,
    view: "writing",
    tab: "agent",
    drawer: true,
  }));
  if (mode === "toutiao")
    await desktop.request("/toutiao/agent/deliver", {
      method: "POST",
      body: {
        root: next.root,
        action: "new",
        note,
        confirm: true,
        requestId: crypto.randomUUID(),
      },
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
  const body =
    target.mode === "fanqie"
      ? {
          base: target.root,
          work: target.work,
          chapter: action === "continue" ? undefined : snapshot.chapter,
          action,
          note,
          confirm: true,
          requestId: crypto.randomUUID(),
        }
      : {
          root: target.root,
          id: snapshot.article,
          action,
          note,
          confirm: true,
          requestId: crypto.randomUUID(),
        };
  await desktop.request(target.mode === "fanqie" ? "/agent/deliver" : "/toutiao/agent/deliver", {
    method: "POST",
    body,
  });
  deps.set({ tab: "agent", drawer: true });
}
