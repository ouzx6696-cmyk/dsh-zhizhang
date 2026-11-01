import type { Focus, Target } from "../context";
import { explainError } from "../diagnostics";
import { promptAccepted } from "./pi-adapter";
import { taskPrompt } from "./prompt";
import type { Sessions } from "./manager";
import type { AuthorAction } from "./types";

export async function sendPrompt(
  host: Sessions,
  targetInput: Target,
  text: string,
  focusInput: Focus = {},
) {
  const target = { ...targetInput };
  const focus = { ...focusInput };
  const key = host.key(target),
    generation = host.generations.get(key) || 0;
  const preparation = Symbol("preparing");
  host.preparations.add(preparation);
  try {
    const session = await host.open(target);
    if ((host.generations.get(key) || 0) !== generation) throw new Error("任务已取消");
    const prepared = await taskPrompt(host, target, text, focus);
    if ((host.generations.get(key) || 0) !== generation) throw new Error("任务已取消");
    await promptAccepted(session, prepared, (error) => {
      const current =
        [...host.sessions.values()].find((entry) => entry.session === session)?.target ||
        target;
      host.emit({ target: current, error: explainError(error) });
      host.extras.log?.("model_error", { role: "writer" });
    });
  } finally {
    host.preparations.delete(preparation);
  }
}

export async function notifyAuthor(
  host: Sessions,
  target: Target,
  value: AuthorAction,
) {
  const session = host.sessions.get(host.key(target))?.session;
  if (!session) return;
  const names: Record<string, string> = {
    "/candidate/accept": "采纳候选稿",
    "/chapter/review": "声明已审读",
    "/chapter/finalize": "定稿",
    "/revision/acknowledge": "核对修订影响",
    "/diagnostics/stage": "保存修订候选",
    "/toutiao/adopt": "采用文章",
  };
  const action = names[value.operation] || "更新方法方案";
  const content = `作者已${action}；对象：${value.article || value.chapter || value.candidate || target.work || "当前项目"}${value.revision !== undefined ? `；版本：${value.revision}` : ""}${value.status ? `；状态：${value.status}` : ""}${value.profile ? `；方案：${value.profile}` : ""}。`;
  await session.sendCustomMessage(
    {
      customType: "writer-author",
      content,
      display: true,
    },
    { triggerTurn: false },
  );
}
