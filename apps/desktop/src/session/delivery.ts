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
      settleTask(host, entry || { target, focus, task: preparingTask, phase: '' }, {
        reason: cancelled ? 'cancelled' : 'failed',
        error: cancelled ? undefined : error instanceof Error ? error.message : String(error),
        primary: true, role: 'writer',
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
  const names: Record<string, string> = {
    "/candidate/accept": "采纳候选稿",
    "/chapter/review": "声明已审读",
    "/chapter/finalize": "定稿",
    "/revision/acknowledge": "核对修订影响",
    "/diagnostics/stage": "保存修订候选",
    "/chapter/save": "保存章节正文",
    "/toutiao/adopt": "采用文章",
    "/toutiao/draft": "保存作者稿",
  };
  const candidateSave = value.operation === "/chapter/save" && !!value.candidate;
  const action = candidateSave ? "保存候选正文" : names[value.operation] || "更新方法方案";
  const objects: Record<string, string> = {
    "/candidate/accept": "当前候选稿",
    "/chapter/review": "当前章节",
    "/chapter/finalize": "当前章节",
    "/revision/acknowledge": "当前修订",
    "/diagnostics/stage": "修订候选",
    "/chapter/save": "当前章节",
    "/toutiao/adopt": "当前文章",
    "/toutiao/draft": "当前文章",
  };
  const object = candidateSave ? "当前候选稿" : objects[value.operation] || "当前项目";
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
