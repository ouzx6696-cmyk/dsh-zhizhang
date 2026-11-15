/** IPC 参数边界解析：每个通道的参数元组都在这里经 core/schema 校验，失败报 input.invalid。 */
import { AppError } from "@zhizhang/core/errors";
import { arr, bool, int, lit, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import type { IpcArgs, IpcChannel, WorkbenchCall } from "../../shared/ipc.js";
import {
  ConnectionInputSchema,
  parseModelsInput,
  parseSettingsPatch,
  THINKING_LEVELS,
} from "../../shared/settings.js";
import type { Focus, RecoverAction, RunRef, SessionSend, Target } from "../../shared/views.js";
import { isWorkbenchCommand } from "../commands.js";

const mode = lit("fanqie", "toutiao");

const target: Parser<Target> = obj({ mode, path: str({ min: 1, max: 1000 }), subId: opt(str({ max: 200 })) });

const runRef: Parser<RunRef> = obj({ runId: str({ min: 1, max: 200 }), target });

const focus: Parser<Focus> = obj({
  chapter: opt(str({ max: 200 })),
  candidate: opt(str({ max: 200 })),
  article: opt(str({ max: 200 })),
  title: opt(str({ max: 200 })),
  workTitle: opt(str({ max: 200 })),
  source: opt(lit("chapter", "candidate", "article", "split")),
  dirty: opt(bool),
});

const sessionSend: Parser<SessionSend> = obj({
  text: str({ min: 1, max: 40000 }),
  focus: opt(focus),
  intent: opt(lit("chat", "continue", "revise", "review", "plan", "check")),
});

const draftConnection = ConnectionInputSchema;

const recoverAction: Parser<RecoverAction> = (value, at = "$") => {
  const head = obj({ kind: lit("clear-lock", "replay-intents", "discard-run") }, { strict: false })(value, at);
  if (head.kind === "clear-lock") return obj({ kind: lit("clear-lock"), lockDir: str({ min: 1 }) })(value, at);
  if (head.kind === "replay-intents") return obj({ kind: lit("replay-intents"), dir: str({ min: 1 }) })(value, at);
  return obj({ kind: lit("discard-run"), runId: str({ min: 1 }), target })(value, at);
};

const workbenchCall: Parser<WorkbenchCall> = (value, at = "$") => {
  const raw = obj({ command: str({ min: 1 }), input: (v: unknown) => v })(value, at);
  if (!isWorkbenchCommand(raw.command)) {
    throw new AppError("input.invalid", `${at}.command: 未知命令 ${raw.command}`, { path: `${at}.command` });
  }
  // 命令输入的逐字段解析在 dispatchWorkbenchCommand 内按命令进行
  return { command: raw.command, input: raw.input } as WorkbenchCall;
};

const none = (args: unknown[]): [] => {
  if (args.length > 0) throw new AppError("ipc.invalid_args", "该调用不接受参数");
  return [];
};

const one =
  <A>(p: Parser<A>) =>
  (args: unknown[]): [A] => [p(args[0], "$args[0]")];

const two =
  <A, B>(pa: Parser<A>, pb: Parser<B>) =>
  (args: unknown[]): [A, B] => [pa(args[0], "$args[0]"), pb(args[1], "$args[1]")];

export const IPC_PARSERS: { [K in IpcChannel]: (args: unknown[]) => IpcArgs<K> } = {
  "workbench.call": one(workbenchCall),
  "workflow.start": two(target, obj({ kind: str({ min: 1, max: 80 }), request: (v: unknown) => v })),
  "workflow.control": two(runRef, lit("pause", "resume", "stop", "retry")),
  "workflow.decide": two(runRef, lit("apply", "discard")),
  "workflow.get": one(runRef),
  "workflow.history": one(target),
  "workflow.running": none,
  "session.view": two(target, obj({ conversationId: opt(str({ min: 1, max: 80 })), limit: opt(int({ min: 1, max: 2000 })) })),
  "session.send": two(target, sessionSend),
  "session.stop": one(target),
  "session.list": one(target),
  "session.new": one(target),
  "session.usage": one(target),
  "session.compact": two(target, obj({ instructions: opt(str({ max: 4000 })) })),
  "settings.get": none,
  "settings.save": one(parseSettingsPatch),
  "settings.reset": none,
  "models.save": one(parseModelsInput),
  "models.test": one(
    obj({
      connectionId: str({ min: 1, max: 40 }),
      model: str({ min: 1, max: 200 }),
      thinking: opt(lit(...THINKING_LEVELS)),
      draft: opt(draftConnection),
    }),
  ),
  "models.catalog": one(
    obj({ connectionId: str({ min: 1, max: 40 }), draft: opt(draftConnection), source: lit("pi", "endpoint") }),
  ),
  "app.state": none,
  "app.openExternal": one(str({ min: 1, max: 2000 })),
  "app.openPath": one(str({ min: 1, max: 1000 })),
  "workspace.status": none,
  "workspace.choose": none,
  "workspace.takeOver": one(obj({ owner: str({ min: 1, max: 200 }) })),
  "targets.list": none,
  "targets.select": one(target),
  "export.save": two(
    target,
    obj({ format: lit("txt", "docx", "md", "copy"), finalOnly: opt(bool), includeDelivery: opt(bool) }),
  ),
  "backup.start": none,
  "backup.cancel": none,
  "diagnostics.export": none,
  "storage.health": none,
  "storage.recover": one(recoverAction),
  "updates.check": one(lit("status", "check")),
  "dialog.openText": one(obj({ title: opt(str({ max: 100 })), extensions: opt(arr(str({ min: 1, max: 10 }), { max: 10 })) })),
  "source.fetch": one(str({ min: 1, max: 2000 })),
  "learning.status": one(target),
};
