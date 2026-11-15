/**
 * 桌面 IPC 契约（单一来源）：通道 id → 参数/结果类型，以及给渲染层直接用的类型化客户端 DesktopApi。
 * 每个通道在主进程以 "zhizhang:<id>" 注册，参数一律由主进程用 core/schema 解析；
 * 回执是 Reply<T>，失败只给错误码、消息与数据，界面文案由渲染层按码取 copy。
 *
 * 1.2 方法名 → v1.3 通道（DesktopApi 方法）
 * ─────────────────────────────────────────────────────────────────────────────
 *  state                 → app.state            (state)
 *  view(target, n, old)  → session.view         (sessionView, 参数 {conversationId?, limit?})
 *  select                → targets.select       (select)
 *  choose(mode)          → 删除：作品/文章在写作文件夹内由 targets.list 列出，直接 select
 *  projects              → targets.list         (targets)
 *  workspace             → workspace.choose     (chooseWorkspace)
 *  takeOverWorkspace     → workspace.takeOver   (takeOverWorkspace)
 *  send(text, t, focus)  → session.send         (send, 参数 {text, focus?, intent?})
 *  stop                  → session.stop         (stop)
 *  running               → workflow.running     (running；流水线与助手合并)
 *  conversations         → session.list         (conversations)
 *  newConversation       → session.new          (newConversation)
 *  export(t, focus, fmt) → export.save          (exportFile)
 *  model                 → models.save          (saveModels：连接列表 + 角色绑定)
 *  testModel             → models.test          (testModel)
 *  modelCatalog          → models.catalog       (modelCatalog)
 *  engine                → settings.save {engine}        (saveSettings)
 *  appearance            → settings.save {appearance}    (saveSettings)
 *  contextSettings       → settings.save {context}       (saveSettings)
 *  preferences / save-preferences → settings.save {assistant.preferences}
 *  writerOptions         → 删除：番茄作品设置走 workbench "fanqie.work.settings"
 *  search / testSearch   → 删除：v1.3 不含联网检索；读链接改为 source.fetch (fetchSource)
 *  learning              → learning.status      (learning；采纳由学习存储在第 3 次重复时自动晋升)
 *  continuity            → 删除：改用 workbench "fanqie.bible.get/view/decide/audit"
 *  contextUsage          → session.usage        (contextUsage)
 *  compact               → session.compact      (compact)
 *  storageHealth         → storage.health       (storageHealth)
 *  libraryStorage        → workbench "library.*"；打开目录用 app.openPath (openPath)
 *  updates               → updates.check        (updates)
 *  backup                → backup.start / backup.cancel  (backup / cancelBackup)
 *  recover               → storage.recover      (recover)
 *  diagnostics           → diagnostics.export   (diagnostics)
 *  newTarget(mode)       → workbench "fanqie.work.create" / "toutiao.article.create"
 *  request(op, opts)     → workbench.call       (workbench)
 *  workflow(t, action)   → workflow.start / control / decide / get / history
 *                          (startRun / controlRun / decideRun / getRun / runHistory)
 *  external              → app.openExternal     (openExternal)
 *  —（新增）             → workspace.status (workspaceStatus)、settings.get/reset、
 *                          dialog.openText (openText)
 */
import { AppError, type ErrorCode } from "@zhizhang/core/errors";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { DesktopEvent } from "./events.js";
import type { ModelsInput, PublicSettings, SettingsPatch } from "./settings.js";
import type {
  AppStateView,
  BackupResult,
  CompactResult,
  ContextUsageView,
  ConversationItem,
  ExportRequest,
  ExportResult,
  FetchedSource,
  LearningView,
  ModelCatalogView,
  ModelTestInput,
  ModelTestResult,
  OpenedText,
  RecoverAction,
  RunDetail,
  RunRef,
  RunSummary,
  RunningRow,
  SessionSend,
  SessionView,
  StorageHealth,
  Target,
  TargetItem,
  UpdateStatus,
  WorkflowAction,
  WorkflowDecision,
  WorkflowStart,
  WorkspaceStatus,
} from "./views.js";

export type Reply<T> =
  | { ok: true; value: T }
  | { ok: false; error: { code: ErrorCode; message: string; data?: Record<string, unknown> } };

export type WorkbenchCall = {
  [K in WorkbenchCommand]: { command: K; input: CommandInput<K> };
}[WorkbenchCommand];

export interface ModelCatalogRequest {
  connectionId: string;
  draft?: ModelTestInput["draft"];
  source: "pi" | "endpoint";
}

export interface IpcMap {
  "workbench.call": { args: [WorkbenchCall]; result: CommandResult<WorkbenchCommand> };

  "workflow.start": { args: [Target, WorkflowStart]; result: RunRef };
  "workflow.control": { args: [RunRef, WorkflowAction]; result: RunSummary };
  "workflow.decide": { args: [RunRef, WorkflowDecision]; result: RunSummary };
  "workflow.get": { args: [RunRef]; result: RunDetail | null };
  "workflow.history": { args: [Target]; result: RunSummary[] };
  "workflow.running": { args: []; result: RunningRow[] };

  "session.view": {
    args: [Target, { conversationId?: string; limit?: number }];
    result: SessionView;
  };
  "session.send": { args: [Target, SessionSend]; result: { conversationId: string } };
  "session.stop": { args: [Target]; result: void };
  "session.list": { args: [Target]; result: ConversationItem[] };
  "session.new": { args: [Target]; result: ConversationItem };
  "session.usage": { args: [Target]; result: ContextUsageView };
  "session.compact": { args: [Target, { instructions?: string }]; result: CompactResult };

  "settings.get": { args: []; result: PublicSettings };
  "settings.save": { args: [SettingsPatch]; result: PublicSettings };
  "settings.reset": { args: []; result: PublicSettings };

  "models.save": { args: [ModelsInput]; result: PublicSettings };
  "models.test": { args: [ModelTestInput]; result: ModelTestResult };
  "models.catalog": { args: [ModelCatalogRequest]; result: ModelCatalogView };

  "app.state": { args: []; result: AppStateView };
  "app.openExternal": { args: [string]; result: void };
  "app.openPath": { args: [string]; result: void };

  "workspace.status": { args: []; result: WorkspaceStatus };
  "workspace.choose": { args: []; result: WorkspaceStatus | null };
  "workspace.takeOver": { args: [{ owner: string }]; result: WorkspaceStatus };

  "targets.list": { args: []; result: TargetItem[] };
  "targets.select": { args: [Target]; result: TargetItem };

  "export.save": { args: [Target, ExportRequest]; result: ExportResult };
  "backup.start": { args: []; result: BackupResult | null };
  "backup.cancel": { args: []; result: void };
  "diagnostics.export": { args: []; result: { file: string } | null };
  "storage.health": { args: []; result: StorageHealth };
  "storage.recover": { args: [RecoverAction]; result: StorageHealth };
  "updates.check": { args: ["status" | "check"]; result: UpdateStatus };
  "dialog.openText": {
    args: [{ title?: string; extensions?: string[] }];
    result: OpenedText | null;
  };
  "source.fetch": { args: [string]; result: FetchedSource };
  "learning.status": { args: [Target]; result: LearningView };
}

export type IpcChannel = keyof IpcMap;
export type IpcArgs<K extends IpcChannel> = IpcMap[K]["args"];
export type IpcResult<K extends IpcChannel> = IpcMap[K]["result"];

/** preload 暴露的最小桥：只有类型化调用与事件订阅。 */
export interface DesktopBridge {
  invoke<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<Reply<IpcResult<K>>>;
  subscribe(callback: (event: DesktopEvent) => void): () => void;
}

export function unwrapReply<T>(reply: Reply<T>): T {
  if (reply.ok) return reply.value;
  throw new AppError(reply.error.code, reply.error.message, reply.error.data);
}

/** 渲染层使用的类型化客户端：方法 → 通道一一对应（见文件头对照表）。 */
export interface DesktopApi {
  subscribe(callback: (event: DesktopEvent) => void): () => void;
  workbench<K extends WorkbenchCommand>(command: K, input: CommandInput<K>): Promise<CommandResult<K>>;

  startRun(target: Target, start: WorkflowStart): Promise<RunRef>;
  controlRun(ref: RunRef, action: WorkflowAction): Promise<RunSummary>;
  decideRun(ref: RunRef, decision: WorkflowDecision): Promise<RunSummary>;
  getRun(ref: RunRef): Promise<RunDetail | null>;
  runHistory(target: Target): Promise<RunSummary[]>;
  running(): Promise<RunningRow[]>;

  sessionView(target: Target, options?: { conversationId?: string; limit?: number }): Promise<SessionView>;
  send(target: Target, message: SessionSend): Promise<{ conversationId: string }>;
  stop(target: Target): Promise<void>;
  conversations(target: Target): Promise<ConversationItem[]>;
  newConversation(target: Target): Promise<ConversationItem>;
  contextUsage(target: Target): Promise<ContextUsageView>;
  compact(target: Target, instructions?: string): Promise<CompactResult>;

  getSettings(): Promise<PublicSettings>;
  saveSettings(patch: SettingsPatch): Promise<PublicSettings>;
  resetSettings(): Promise<PublicSettings>;
  saveModels(input: ModelsInput): Promise<PublicSettings>;
  testModel(input: ModelTestInput): Promise<ModelTestResult>;
  modelCatalog(request: ModelCatalogRequest): Promise<ModelCatalogView>;

  state(): Promise<AppStateView>;
  openExternal(url: string): Promise<void>;
  openPath(target: string): Promise<void>;
  workspaceStatus(): Promise<WorkspaceStatus>;
  chooseWorkspace(): Promise<WorkspaceStatus | null>;
  takeOverWorkspace(owner: string): Promise<WorkspaceStatus>;
  targets(): Promise<TargetItem[]>;
  select(target: Target): Promise<TargetItem>;

  exportFile(target: Target, request: ExportRequest): Promise<ExportResult>;
  backup(): Promise<BackupResult | null>;
  cancelBackup(): Promise<void>;
  diagnostics(): Promise<{ file: string } | null>;
  storageHealth(): Promise<StorageHealth>;
  recover(action: RecoverAction): Promise<StorageHealth>;
  updates(action?: "status" | "check"): Promise<UpdateStatus>;
  openText(options?: { title?: string; extensions?: string[] }): Promise<OpenedText | null>;
  fetchSource(url: string): Promise<FetchedSource>;
  learning(target: Target): Promise<LearningView>;
}

export function createDesktopApi(bridge: () => DesktopBridge): DesktopApi {
  async function call<K extends IpcChannel>(channel: K, ...args: IpcArgs<K>): Promise<IpcResult<K>> {
    return unwrapReply(await bridge().invoke(channel, ...args));
  }
  return {
    subscribe: (callback) => bridge().subscribe(callback),
    async workbench<K extends WorkbenchCommand>(command: K, input: CommandInput<K>) {
      const payload = { command, input } as WorkbenchCall;
      return (await call("workbench.call", payload)) as CommandResult<K>;
    },
    startRun: (target, start) => call("workflow.start", target, start),
    controlRun: (ref, action) => call("workflow.control", ref, action),
    decideRun: (ref, decision) => call("workflow.decide", ref, decision),
    getRun: (ref) => call("workflow.get", ref),
    runHistory: (target) => call("workflow.history", target),
    running: () => call("workflow.running"),
    sessionView: (target, options = {}) => call("session.view", target, options),
    send: (target, message) => call("session.send", target, message),
    stop: (target) => call("session.stop", target),
    conversations: (target) => call("session.list", target),
    newConversation: (target) => call("session.new", target),
    contextUsage: (target) => call("session.usage", target),
    compact: (target, instructions) =>
      call("session.compact", target, instructions === undefined ? {} : { instructions }),
    getSettings: () => call("settings.get"),
    saveSettings: (patch) => call("settings.save", patch),
    resetSettings: () => call("settings.reset"),
    saveModels: (input) => call("models.save", input),
    testModel: (input) => call("models.test", input),
    modelCatalog: (request) => call("models.catalog", request),
    state: () => call("app.state"),
    openExternal: (url) => call("app.openExternal", url),
    openPath: (target) => call("app.openPath", target),
    workspaceStatus: () => call("workspace.status"),
    chooseWorkspace: () => call("workspace.choose"),
    takeOverWorkspace: (owner) => call("workspace.takeOver", { owner }),
    targets: () => call("targets.list"),
    select: (target) => call("targets.select", target),
    exportFile: (target, request) => call("export.save", target, request),
    backup: () => call("backup.start"),
    cancelBackup: () => call("backup.cancel"),
    diagnostics: () => call("diagnostics.export"),
    storageHealth: () => call("storage.health"),
    recover: (action) => call("storage.recover", action),
    updates: (action = "status") => call("updates.check", action),
    openText: (options = {}) => call("dialog.openText", options),
    fetchSource: (url) => call("source.fetch", url),
    learning: (target) => call("learning.status", target),
  };
}
