/**
 * 传输无关的 RPC 分发器：Electron ipcMain 与 Web HTTP+SSE 共用同一套参数校验、只读门禁与服务调用。
 */
import type { Clock } from "@zhizhang/core/clock";
import { AppError, classify, serializeError } from "@zhizhang/core/errors";
import { COMMAND_POLICY } from "@zhizhang/workbench/contract";
import type { DesktopEvent } from "../../shared/events.js";
import type { IpcArgs, IpcChannel, IpcResult, Reply } from "../../shared/ipc.js";
import type {
  AppStateView,
  BackupResult,
  LearningView,
  Target,
  UpdateStatus,
  WorkspaceStatus,
} from "../../shared/views.js";
import { readSource } from "../../network.js";
import type { SessionManager } from "../../session/manager.js";
import { dispatchWorkbenchCommand, type CommandCtx } from "../commands.js";
import type { ModelServices } from "../models.js";
import type { HostPlatform } from "../platform.js";
import type { ConfigService } from "../services/config.js";
import { exportTarget } from "../services/export.js";
import type { createStorageHealth } from "../services/storage-health.js";
import { describeTarget, listTargets, recentTargets, rememberTarget } from "../services/targets.js";
import type { WorkspaceService } from "../services/workspace.js";
import type { WorkflowService } from "../workflow.js";
import { IPC_PARSERS } from "./parsers.js";

export interface MainServices {
  version: string;
  clock: Clock;
  host: HostPlatform;
  emit(event: DesktopEvent): void;
  config: ConfigService;
  workspace: WorkspaceService;
  openWorkspace(root: string): Promise<WorkspaceStatus>;
  workflow: WorkflowService;
  sessions: SessionManager;
  models: ModelServices;
  storage: ReturnType<typeof createStorageHealth>;
  commands: CommandCtx;
  backup: { start(output: string): Promise<BackupResult>; cancel(): void };
  diagnostics(file: string): Promise<void>;
  updates(action: "status" | "check"): UpdateStatus;
  learning(target: Target): Promise<LearningView>;
}

export interface RpcDispatcher {
  readonly channels: readonly IpcChannel[];
  has(channel: string): channel is IpcChannel;
  invoke<K extends IpcChannel>(channel: K, rawArgs: unknown[]): Promise<Reply<IpcResult<K>>>;
}

type HandlerMap = {
  [K in IpcChannel]: (...args: IpcArgs<K>) => Promise<IpcResult<K>> | IpcResult<K>;
};

function toReply<T>(error: unknown): Reply<T> {
  const serialized = serializeError(classify(error));
  return {
    ok: false,
    error: {
      code: serialized.code,
      message: serialized.message,
      ...(serialized.data !== undefined ? { data: serialized.data } : {}),
    },
  };
}

export function createRpcHandlers(s: MainServices): RpcDispatcher {
  async function state(): Promise<AppStateView> {
    const workspace = s.workspace.status();
    const issue = s.config.issue();
    return {
      version: s.version,
      platform: s.host.platform,
      settings: s.config.publicSettings(),
      ...(issue ? { settingsIssue: issue } : {}),
      workspace,
      updates: s.updates("status"),
      recent: workspace.root ? await recentTargets(workspace.roots) : [],
    };
  }

  const handlers: HandlerMap = {
    async "workbench.call"(call) {
      const policy = COMMAND_POLICY[call.command];
      if (policy.access === "write") s.workspace.assertWritable();
      const result = await dispatchWorkbenchCommand(call, s.commands);
      if (policy.refresh) {
        const input: unknown = call.input;
        const pathOf = (key: string) =>
          typeof input === "object" && input !== null && typeof Reflect.get(input, key) === "string"
            ? String(Reflect.get(input, key))
            : "";
        const targetPath =
          pathOf("work") || pathOf("articleDir") || pathOf("root") || pathOf("libraryRoot");
        const mode = call.command.startsWith("toutiao.") ? "toutiao" : "fanqie";
        s.emit({
          kind: "workspace.changed",
          target: { mode, path: targetPath },
          revision: `${call.command}:${s.clock.now()}`,
          scope: policy.refresh,
        });
      }
      return result;
    },

    async "workflow.start"(target, start) {
      s.workspace.assertWritable();
      s.workspace.assertInside(target.path);
      return s.workflow.start(target, start.kind, start.request);
    },
    async "workflow.control"(ref, action) {
      s.workspace.assertInside(ref.target.path);
      if (action === "resume" || action === "retry") s.workspace.assertWritable();
      return s.workflow.control(ref, action);
    },
    async "workflow.decide"(ref, decision) {
      s.workspace.assertInside(ref.target.path);
      s.workspace.assertWritable();
      return s.workflow.decide(ref, decision);
    },
    "workflow.get": (ref) => s.workflow.get(ref),
    "workflow.history": (target) => s.workflow.history(target),
    "workflow.running": () => [...s.workflow.running(), ...s.sessions.running()],

    "session.view": (target, options) => s.sessions.view(target, options),
    "session.send"(target, message) {
      s.workspace.assertInside(target.path);
      return s.sessions.send(target, message);
    },
    "session.stop": (target) => s.sessions.stop(target),
    "session.list": (target) => s.sessions.list(target),
    "session.new": (target) => s.sessions.newConversation(target),
    "session.usage": (target) => s.sessions.usage(target),
    "session.compact": (target, options) => s.sessions.compact(target, options.instructions),

    "settings.get": () => s.config.publicSettings(),
    "settings.save": (patch) => s.config.savePatch(patch),
    async "settings.reset"() {
      const next = await s.config.reset();
      s.emit({ kind: "notice", code: "settings.reset" });
      return next;
    },

    "models.save": (input) => s.config.saveModels(input),
    "models.test": (input) => s.models.test(input),
    "models.catalog": (request) => s.models.catalog(request),

    "app.state": state,
    async "app.openExternal"(url) {
      const parsed = new URL(url);
      if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
        throw new AppError("input.invalid", "只能打开 HTTP(S) 链接", { field: "url" });
      }
      await s.host.openExternal(parsed.href);
    },
    async "app.openPath"(target) {
      const resolved = s.workspace.assertInside(target);
      await s.host.openPath(resolved);
    },

    "workspace.status": () => s.workspace.status(),
    async "workspace.choose"() {
      const root = await s.host.pickDirectory("选择写作文件夹");
      return root ? s.openWorkspace(root) : null;
    },
    async "workspace.takeOver"({ owner }) {
      const status = await s.workspace.takeOver(owner);
      s.emit({ kind: "workspace.status", status });
      s.emit({ kind: "notice", code: "workspace.taken_over" });
      return status;
    },

    "targets.list": () => listTargets(s.workspace.status().roots),
    async "targets.select"(target) {
      s.workspace.assertInside(target.path);
      const item = await describeTarget(target, s.workspace.status().roots);
      await rememberTarget(item, s.clock);
      return item;
    },

    "export.save": (target, request) =>
      exportTarget(target, request, s.commands, {
        pickSave: (defaultName, extension) => s.host.pickSave(defaultName, extension),
        copy: (text) => s.host.copyText(text),
      }),
    async "backup.start"() {
      if (!s.workspace.status().root)
        throw new AppError("input.invalid", "请先选择写作文件夹", { field: "workspaceRoot" });
      const output = await s.host.pickDirectory("选择备份存放位置");
      if (!output) return null;
      const result = await s.backup.start(output);
      s.emit({ kind: "notice", code: "backup.done", data: { dir: result.dir } });
      return result;
    },
    "backup.cancel": () => s.backup.cancel(),
    async "diagnostics.export"() {
      const file = await s.host.pickSave(
        `zhizhang-diagnostics-${s.clock.iso().slice(0, 10)}`,
        "json",
      );
      if (!file) return null;
      await s.diagnostics(file);
      return { file };
    },
    "storage.health": () => s.storage.inspect(),
    "storage.recover": (action) => s.storage.recover(action),
    "updates.check": (action) => s.updates(action),
    "dialog.openText": (options) => s.host.openTextFile(options),
    "source.fetch": (url) => readSource(url),
    "learning.status": (target) => s.learning(target),
  };

  const channels = Object.keys(handlers) as IpcChannel[];

  return {
    channels,
    has(channel: string): channel is IpcChannel {
      return Object.hasOwn(handlers, channel);
    },
    async invoke<K extends IpcChannel>(
      channel: K,
      rawArgs: unknown[],
    ): Promise<Reply<IpcResult<K>>> {
      try {
        if (!Object.hasOwn(handlers, channel)) {
          throw new AppError("ipc.invalid_args", `未知 RPC 通道：${String(channel)}`, {
            channel: String(channel),
          });
        }
        const parse: (args: unknown[]) => IpcArgs<K> = IPC_PARSERS[channel];
        const listener = handlers[channel];
        return { ok: true, value: await listener(...parse(rawArgs)) };
      } catch (error) {
        return toReply(error);
      }
    },
  };
}
