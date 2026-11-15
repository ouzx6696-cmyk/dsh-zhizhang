/**
 * IPC 注册：每个通道 "zhizhang:<id>"；只接受主窗口主帧的调用；参数先过 IPC_PARSERS；
 * 写命令统一过只读门禁；失败回执只带错误码、消息与数据。
 */
import fs from "node:fs/promises";
import path from "node:path";
import {
  clipboard,
  dialog,
  ipcMain,
  shell,
  type BrowserWindow,
  type IpcMainInvokeEvent,
} from "electron";
import type { Clock } from "@zhizhang/core/clock";
import { AppError, classify, serializeError } from "@zhizhang/core/errors";
import { COMMAND_POLICY } from "@zhizhang/workbench/contract";
import type { DesktopEvent } from "../../shared/events.js";
import type { IpcArgs, IpcChannel, IpcResult, Reply } from "../../shared/ipc.js";
import type {
  AppStateView,
  BackupResult,
  LearningView,
  OpenedText,
  Target,
  UpdateStatus,
  WorkspaceStatus,
} from "../../shared/views.js";
import { readSource } from "../../network.js";
import type { SessionManager } from "../../session/manager.js";
import { dispatchWorkbenchCommand, type CommandCtx } from "../commands.js";
import type { ModelServices } from "../models.js";
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
  window(): BrowserWindow | undefined;
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

function fromMainFrame(window: BrowserWindow | undefined, event: IpcMainInvokeEvent): boolean {
  return (
    window !== undefined &&
    !window.isDestroyed() &&
    event.sender === window.webContents &&
    event.senderFrame === window.webContents.mainFrame
  );
}

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

function decodeText(bytes: Buffer): { content: string; encoding: OpenedText["encoding"] } {
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""),
      encoding: "utf-8",
    };
  } catch {
    return { content: new TextDecoder("gbk").decode(bytes), encoding: "gbk" };
  }
}

export function registerIpc(s: MainServices): void {
  function handle<K extends IpcChannel>(
    channel: K,
    listener: (...args: IpcArgs<K>) => Promise<IpcResult<K>> | IpcResult<K>,
  ): void {
    const parse: (args: unknown[]) => IpcArgs<K> = IPC_PARSERS[channel];
    ipcMain.removeHandler(`zhizhang:${channel}`);
    ipcMain.handle(
      `zhizhang:${channel}`,
      async (event, ...raw: unknown[]): Promise<Reply<IpcResult<K>>> => {
        try {
          if (!fromMainFrame(s.window(), event)) {
            throw new AppError("ipc.invalid_args", `拒绝非主窗口发来的调用：${channel}`, {
              channel,
            });
          }
          return { ok: true, value: await listener(...parse(raw)) };
        } catch (error) {
          return toReply(error);
        }
      },
    );
  }

  const parentWindow = () => {
    const win = s.window();
    return win && !win.isDestroyed() ? win : undefined;
  };

  async function pickDirectory(title: string): Promise<string | null> {
    const win = parentWindow();
    const options = { title, properties: ["openDirectory" as const, "createDirectory" as const] };
    const result = win
      ? await dialog.showOpenDialog(win, options)
      : await dialog.showOpenDialog(options);
    return result.canceled ? null : (result.filePaths[0] ?? null);
  }

  async function pickSave(defaultName: string, extension: string): Promise<string | null> {
    const win = parentWindow();
    const options = {
      title: "导出",
      defaultPath: `${defaultName}.${extension}`,
      filters: [{ name: extension.toUpperCase(), extensions: [extension] }],
    };
    const result = win
      ? await dialog.showSaveDialog(win, options)
      : await dialog.showSaveDialog(options);
    return result.canceled || !result.filePath ? null : result.filePath;
  }

  async function state(): Promise<AppStateView> {
    const workspace = s.workspace.status();
    const issue = s.config.issue();
    return {
      version: s.version,
      platform: process.platform,
      settings: s.config.publicSettings(),
      ...(issue ? { settingsIssue: issue } : {}),
      workspace,
      updates: s.updates("status"),
      recent: workspace.root ? await recentTargets(workspace.roots) : [],
    };
  }

  handle("workbench.call", async (call) => {
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
  });

  handle("workflow.start", async (target, start) => {
    s.workspace.assertWritable();
    s.workspace.assertInside(target.path);
    return s.workflow.start(target, start.kind, start.request);
  });
  handle("workflow.control", async (ref, action) => {
    s.workspace.assertInside(ref.target.path);
    if (action === "resume" || action === "retry") s.workspace.assertWritable();
    return s.workflow.control(ref, action);
  });
  handle("workflow.decide", async (ref, decision) => {
    s.workspace.assertInside(ref.target.path);
    s.workspace.assertWritable();
    return s.workflow.decide(ref, decision);
  });
  handle("workflow.get", (ref) => s.workflow.get(ref));
  handle("workflow.history", (target) => s.workflow.history(target));
  handle("workflow.running", () => [...s.workflow.running(), ...s.sessions.running()]);

  handle("session.view", (target, options) => s.sessions.view(target, options));
  handle("session.send", (target, message) => {
    s.workspace.assertInside(target.path);
    return s.sessions.send(target, message);
  });
  handle("session.stop", (target) => s.sessions.stop(target));
  handle("session.list", (target) => s.sessions.list(target));
  handle("session.new", (target) => s.sessions.newConversation(target));
  handle("session.usage", (target) => s.sessions.usage(target));
  handle("session.compact", (target, options) => s.sessions.compact(target, options.instructions));

  handle("settings.get", () => s.config.publicSettings());
  handle("settings.save", (patch) => s.config.savePatch(patch));
  handle("settings.reset", async () => {
    const next = await s.config.reset();
    s.emit({ kind: "notice", code: "settings.reset" });
    return next;
  });

  handle("models.save", (input) => s.config.saveModels(input));
  handle("models.test", (input) => s.models.test(input));
  handle("models.catalog", (request) => s.models.catalog(request));

  handle("app.state", state);
  handle("app.openExternal", async (url) => {
    const parsed = new URL(url);
    if (parsed.protocol !== "https:" && parsed.protocol !== "http:") {
      throw new AppError("input.invalid", "只能打开 HTTP(S) 链接", { field: "url" });
    }
    await shell.openExternal(parsed.href);
  });
  handle("app.openPath", async (target) => {
    const resolved = s.workspace.assertInside(target);
    const failure = await shell.openPath(resolved);
    if (failure) throw new AppError("input.not_found", failure, { path: resolved });
  });

  handle("workspace.status", () => s.workspace.status());
  handle("workspace.choose", async () => {
    const root = await pickDirectory("选择写作文件夹");
    return root ? s.openWorkspace(root) : null;
  });
  handle("workspace.takeOver", async ({ owner }) => {
    const status = await s.workspace.takeOver(owner);
    s.emit({ kind: "workspace.status", status });
    s.emit({ kind: "notice", code: "workspace.taken_over" });
    return status;
  });

  handle("targets.list", () => listTargets(s.workspace.status().roots));
  handle("targets.select", async (target) => {
    s.workspace.assertInside(target.path);
    const item = await describeTarget(target, s.workspace.status().roots);
    await rememberTarget(item, s.clock);
    return item;
  });

  handle("export.save", (target, request) =>
    exportTarget(target, request, s.commands, {
      pickSave,
      copy: (text) => clipboard.writeText(text),
    }),
  );
  handle("backup.start", async () => {
    if (!s.workspace.status().root)
      throw new AppError("input.invalid", "请先选择写作文件夹", { field: "workspaceRoot" });
    const output = await pickDirectory("选择备份存放位置");
    if (!output) return null;
    const result = await s.backup.start(output);
    s.emit({ kind: "notice", code: "backup.done", data: { dir: result.dir } });
    return result;
  });
  handle("backup.cancel", () => s.backup.cancel());
  handle("diagnostics.export", async () => {
    const file = await pickSave(`zhizhang-diagnostics-${s.clock.iso().slice(0, 10)}`, "json");
    if (!file) return null;
    await s.diagnostics(file);
    return { file };
  });
  handle("storage.health", () => s.storage.inspect());
  handle("storage.recover", (action) => s.storage.recover(action));
  handle("updates.check", (action) => s.updates(action));
  handle("dialog.openText", async (options) => {
    const win = parentWindow();
    const extensions = options.extensions ?? ["txt", "md"];
    const dialogOptions = {
      title: options.title ?? "选择文本文件",
      properties: ["openFile" as const],
      filters: [{ name: extensions.join("/").toUpperCase(), extensions }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    const file = result.canceled ? undefined : result.filePaths[0];
    if (!file) return null;
    const stat = await fs.stat(file);
    if (stat.size > 20 * 1024 * 1024)
      throw new AppError("input.invalid", "文件超过 20 MB", { field: "file" });
    const decoded = decodeText(await fs.readFile(file));
    return { path: file, name: path.basename(file), ...decoded };
  });
  handle("source.fetch", (url) => readSource(url));
  handle("learning.status", (target) => s.learning(target));
}
