import { errorText } from "../../../../packages/core/src/errors.js";
import { createTask, settleTask } from "./task-tracker";
import type { Focus, Target } from "../context";
import { explainError } from "../diagnostics";
import { promptAccepted } from "./pi-adapter";
import { taskPrompt } from "./prompt";
import type { Sessions } from "./manager";
import type { AuthorAction } from "./types";
import { statusLabel } from "../../../../packages/ui/src/status";

export async function sendPrompt(
  host: Sessions,
  targetInput: Target,
  text: string,
  focusInput: Focus = {},
) {
  const target = {
    ...targetInput,
    ...(targetInput.mode === "toutiao" && focusInput.article
      ? { article: focusInput.article }
      : {}),
  };
  const focus = { ...focusInput };
  const key = host.key(target),
    generation = host.generations.get(key) || 0;
  if (host.compactions.has(key)) throw new Error("当前会话正在压缩，请等待完成后发送消息");
  const preparation = Symbol("preparing");
  const preparingTask = createTask();
  preparingTask.name = text.slice(0, 100);
  preparingTask.startedAt = Date.now();
  host.preparations.set(preparation, { target, focus, generation });
  try {
    const session = await host.open(target);
    if ((host.generations.get(key) || 0) !== generation) throw new Error("任务已取消");
    const entry = host.sessions.get(key)!;
    if (session.isIdle) {
      Object.assign(entry.task, preparingTask);
    }
    host.emit({
      target,
      task: entry.task,
      phase: session.isIdle ? "正在准备任务…" : "正在准备追加要求，随后排队…",
      event: { type: "task_preparing" },
    });
    host.emit({ running: host.running() });
    const prepared = await taskPrompt(host, target, text, focus);
    if ((host.generations.get(key) || 0) !== generation) throw new Error("任务已取消");
    await promptAccepted(session, prepared, (error) => {
      const current =
        [...host.sessions.values()].find((entry) => entry.session === session)?.target || target;
      host.emit({ target: current, error: explainError(error) });
      host.extras.log?.("model_error", { role: "writer" });
    });
  } catch (error) {
    const cancelled = (host.generations.get(key) || 0) !== generation;
    const entry = host.sessions.get(host.key(target));
    if (!entry || entry.session.isIdle)
      settleTask(host, entry || { target, focus, task: preparingTask, phase: "" }, {
        reason: cancelled ? "cancelled" : "failed",
        error: cancelled ? undefined : errorText(error),
        role: "writer",
      });
    throw error;
  } finally {
    host.preparations.delete(preparation);
    host.emit({ running: host.running() });
  }
}

export async function notifyAuthor(host: Sessions, target: Target, value: AuthorAction) {
  const session = host.sessions.get(host.key(target))?.session;
  if (!session) return;
  const operations: Record<string, { action: string; object: string }> = {
    "/candidate/accept": { action: "采纳候选稿", object: "当前候选稿" },
    "/chapter/review": { action: "声明已审读", object: "当前章节" },
    "/chapter/finalize": { action: "定稿", object: "当前章节" },
    "/revision/acknowledge": { action: "核对修订影响", object: "当前修订" },
    "/diagnostics/stage": { action: "保存修订候选", object: "修订候选" },
    "/chapter/save": { action: "保存章节正文", object: "当前章节" },
    "/toutiao/adopt": { action: "采用文章", object: "当前文章" },
    "/toutiao/draft": { action: "保存作者稿", object: "当前文章" },
  };
  const { action, object } =
    value.operation === "/chapter/save" && value.candidate
      ? { action: "保存候选正文", object: "当前候选稿" }
      : (operations[value.operation] ?? { action: "更新方法方案", object: "当前项目" });
  const revision = typeof value.revision === "number" ? `；版本：${value.revision}` : "";
  const status = value.status ? `；状态：${statusLabel(target.mode, value.status)}` : "";
  const content = `作者已${action}；对象：${object}${revision}${status}。`;
  await session.sendCustomMessage(
    {
      customType: "writer-author",
      content,
      display: true,
    },
    { triggerTurn: false },
  );
}
