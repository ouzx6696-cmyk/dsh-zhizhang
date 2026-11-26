/**
 * 宿主无关的组合根：装配核心服务（配置、写作区、模型、流水线、助手会话、健康与备份）。
 * Electron 主进程与 Web 预览服务器共同复用此组合根，零 Electron 依赖。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "@zhizhang/core/clock";
import { AppError, classify } from "@zhizhang/core/errors";
import { createLockService } from "@zhizhang/core/lock";
import { APP_VERSION } from "@zhizhang/core/version";
import { commands as fanqie, createLearningStore } from "@zhizhang/fanqie";
import type { DesktopEvent } from "../shared/events.js";
import type {
  Focus,
  Mode,
  Target,
  UpdateAction,
  UpdateStatus,
  WorkspaceStatus,
} from "../shared/views.js";
import { createConversationStore } from "../session/history.js";
import { createSessionManager } from "../session/manager.js";
import { formatRunDebrief } from "../session/prompt.js";
import type { CommandCtx } from "./commands.js";
import type { MainServices } from "./ipc/handlers.js";
import { createModelServices } from "./models.js";
import { ModeRegistry } from "./modes.js";
import type { HostPlatform } from "./platform.js";
import { createConfigService } from "./services/config.js";
import { createDiagnostics } from "./services/diagnostics.js";
import { createRunStore } from "./services/runs.js";
import { createStorageHealth } from "./services/storage-health.js";
import { createWorkspaceService } from "./services/workspace.js";
import { createWorkflowService } from "./workflow.js";

export interface AppRuntimeOptions {
  stateRoot: string;
  builtinProfilesDir(mode: Mode): string;
  toutiaoProfileDir: string;
  backupScriptPath: string;
  host: HostPlatform;
  emit(event: DesktopEvent): void;
  clock?: Clock;
  initialWorkspaceRoot?: string;
}

export interface AppRuntime {
  services: MainServices;
  startupNotice?: DesktopEvent;
  openWorkspace(root: string): Promise<WorkspaceStatus>;
  dispose(): Promise<void>;
}

function focusOf(raw: Record<string, string>): Focus {
  const source = raw.source;
  return {
    ...(raw.chapter ? { chapter: raw.chapter } : {}),
    ...(raw.candidate ? { candidate: raw.candidate } : {}),
    ...(raw.article ? { article: raw.article } : {}),
    ...(source === "chapter" || source === "candidate" || source === "article" || source === "split"
      ? { source }
      : {}),
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export async function createAppRuntime(opts: AppRuntimeOptions): Promise<AppRuntime> {
  const clock = opts.clock ?? systemClock;
  await fs.mkdir(opts.stateRoot, { recursive: true });
  const locks = createLockService(clock);
  const diagnostics = createDiagnostics(path.join(opts.stateRoot, "logs"), clock);
  diagnostics.write("start", {
    version: APP_VERSION,
    host: opts.host.kind,
    packaged: opts.host.packaged,
  });

  const config = await createConfigService({
    stateRoot: opts.stateRoot,
    cipher: opts.host.cipher,
  });
  const issue = config.issue();
  if (issue) diagnostics.write("settings_invalid", { code: issue.code, path: issue.path });

  const workspace = createWorkspaceService({ locks, clock });
  const models = createModelServices({
    config,
    clock,
    authPath: path.join(opts.stateRoot, "pi", "auth.json"),
    allowPrivateEndpoints: opts.host.allowPrivateModelEndpoints ?? opts.host.kind !== "web",
  });
  const unbindModels = config.onChange(() => models.rebuild());

  const profileDirs = {
    builtin: opts.builtinProfilesDir,
    userDir: path.join(opts.stateRoot, "profiles"),
  };
  const profileRoots = (mode: Mode) => ({
    builtinDir: profileDirs.builtin(mode),
    userDir: profileDirs.userDir,
  });

  let sessionsRef: ReturnType<typeof createSessionManager> | undefined;
  const runs = createRunStore(path.join(opts.stateRoot, "runs"), {
    onCorrupt: (file, err) => diagnostics.write("run_record_corrupt", { file, code: err.code }),
  });
  const workflow = createWorkflowService({
    clock,
    locks,
    runs,
    gateway: () => models.gateway(),
    budget: () => {
      const engine = config.settings().engine;
      return {
        inputBudget: engine.inputBudget,
        runBudget: engine.runBudget,
        moneyCap: engine.moneyCap ?? null,
      };
    },
    profileRoots,
    libraryRoot: () => workspace.status().roots.library,
    async profileId(target) {
      if (target.mode !== "fanqie") return "default";
      const meta = await fanqie.getWork(target.path).catch(() => undefined);
      return meta?.profile ?? "default";
    },
    emit(event) {
      opts.emit(event);
      if (
        event.kind === "run" &&
        (event.run.state === "awaiting-author" || event.run.state === "failed")
      ) {
        const debrief = formatRunDebrief(event.run);
        sessionsRef?.injectDebrief(event.target, debrief).catch(() => undefined);
      }
    },
    prepareRequest(kind, request) {
      if (kind !== "toutiao.article" || !isRecord(request)) return request;
      const { profileDir: _ignoredProfile, ...safeRequest } = request;
      const requestedLedger =
        typeof safeRequest.ledgerPath === "string" && safeRequest.ledgerPath.trim()
          ? workspace.assertInside(safeRequest.ledgerPath)
          : path.join(workspace.status().roots.toutiao, "ledger.csv");
      return {
        ...safeRequest,
        profileDir: opts.toutiaoProfileDir,
        ledgerPath: requestedLedger,
      };
    },
  });

  const commands: CommandCtx = {
    clock,
    locks,
    inside: (target) => workspace.assertInside(target),
    ...(opts.host.exportDir ? { exportDir: opts.host.exportDir } : {}),
    roots: () => workspace.status().roots,
    profiles: profileDirs,
    workflow,
    log: (event, data) => diagnostics.write(event, { message: String(data.message ?? "") }),
  };

  const sessions = createSessionManager({
    clock,
    store: createConversationStore(path.join(opts.stateRoot, "sessions"), clock),
    gateway: () => models.gateway(),
    port: () => models.port(),
    binding: () => models.assistantBinding(),
    tools: (target) => ModeRegistry.get(target.mode).tools("assistant", target),
    toolCtx: (target) => ({
      workspaceRoot: workspace.status().root,
      readonly: workspace.status().readonly,
      profileRoots: profileRoots(target.mode),
      lock: locks,
      clock,
      host: {
        async startPipeline(kind, request) {
          workspace.assertWritable();
          const ref = await workflow.start(target, kind, request);
          return { runId: ref.runId, kind };
        },
        navigate: (focus) => opts.emit({ kind: "navigate", target, focus: focusOf(focus) }),
      },
    }),
    context: () => config.settings().context,
    preferences: () => config.settings().assistant.preferences,
    readonly: () => workspace.status().readonly,
    async title(target) {
      if (target.mode !== "fanqie") return undefined;
      return (await fanqie.getWork(target.path).catch(() => undefined))?.title;
    },
    emit: opts.emit,
    onBusyChange: () =>
      opts.emit({ kind: "running", rows: [...workflow.running(), ...sessions.running()] }),
  });
  sessionsRef = sessions;

  const storage = createStorageHealth({
    locks,
    runs,
    clock,
    workspace: () => workspace.status(),
    cancelRun: (action) => workflow.cancel({ runId: action.runId, target: action.target }),
  });

  let backupController: AbortController | undefined;
  const backup = {
    async start(output: string) {
      if (backupController) throw new AppError("gate.denied", "已有备份正在进行");
      const root = workspace.status().root;
      const rel = path.relative(root, path.resolve(output));
      if (!rel.startsWith("..") && !path.isAbsolute(rel)) {
        throw new AppError("input.invalid", "备份位置不能在写作文件夹内", { field: "output" });
      }
      const stamp = clock.iso().replace(/[-:]/g, "").replace(/\..*$/, "").replace("T", "-");
      const dir = path.join(output, `zhizhang-backup-${stamp}`);
      const controller = new AbortController();
      backupController = controller;
      try {
        await opts.host.runBackup(
          opts.backupScriptPath,
          ["--source", root, "--output", dir],
          controller.signal,
        );
        diagnostics.write("backup_done", {});
        return opts.host.kind === "web"
          ? { dir: path.basename(dir), sources: [path.basename(root)] }
          : { dir, sources: [root] };
      } catch (err) {
        await fs.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        throw err;
      } finally {
        backupController = undefined;
      }
    },
    cancel() {
      backupController?.abort();
    },
  };

  async function openWorkspace(root: string): Promise<WorkspaceStatus> {
    await workflow.stopAll();
    await sessions.dispose();
    const status = await workspace.open(root);
    if (!config.issue() && config.settings().workspaceRoot !== status.root) {
      await config.setWorkspaceRoot(status.root);
    }
    opts.emit({ kind: "workspace.status", status });
    if (status.readonly) {
      opts.emit({
        kind: "notice",
        code: "storage.locked",
        data: { readonly: true, ...(status.owner ? { owner: status.owner } : {}) },
      });
    }
    return status;
  }

  const updates = (action: UpdateAction): Promise<UpdateStatus> | UpdateStatus => {
    if (opts.host.updater) return opts.host.updater.handle(action);
    return {
      state: "unavailable",
      version: APP_VERSION,
      reason: opts.host.packaged ? "disabled" : "unpacked",
    };
  };

  const initialRoot = opts.initialWorkspaceRoot ?? config.settings().workspaceRoot?.trim();
  let startupNotice: DesktopEvent | undefined;
  if (initialRoot) {
    try {
      const status = await openWorkspace(initialRoot);
      if (status.readonly) {
        startupNotice = {
          kind: "notice",
          code: "storage.locked",
          data: { readonly: true, ...(status.owner ? { owner: status.owner } : {}) },
        };
      }
    } catch (err) {
      const appErr = classify(err);
      diagnostics.write("workspace_open_failed", { code: appErr.code });
      startupNotice = { kind: "notice", code: appErr.code, message: appErr.message };
    }
  }
  const interrupted = await workflow.recoverInterrupted();
  if (interrupted.length) diagnostics.write("runs_interrupted", { count: interrupted.length });

  const services: MainServices = {
    version: APP_VERSION,
    clock,
    host: opts.host,
    emit: opts.emit,
    config,
    workspace,
    openWorkspace,
    workflow,
    sessions,
    models,
    storage,
    commands,
    backup,
    async diagnostics(file) {
      const settings = config.publicSettings();
      const recent = (await runs.listAll()).slice(0, 30).map((run) => ({
        kind: run.kind,
        state: run.state,
        error: run.error?.code ?? null,
        updated: run.updated,
      }));
      await diagnostics.export(file, {
        version: APP_VERSION,
        platform: opts.host.platform,
        arch: process.arch,
        ...(opts.host.electronVersion ? { electron: opts.host.electronVersion } : {}),
        workspace: {
          configured: workspace.status().configured,
          readonly: workspace.status().readonly,
        },
        models: {
          connections: settings.models.connections.map((c) => ({
            provider: c.provider,
            api: c.api,
            configured: c.configured,
          })),
          roles: Object.entries(settings.models.roles)
            .filter(([, binding]) => binding !== undefined)
            .map(([role]) => role),
        },
        engine: settings.engine,
        runs: recent,
      });
    },
    updates,
    async learning(target: Target) {
      if (target.mode !== "fanqie")
        throw new AppError("input.invalid", "个人规则学习只用于番茄作品", { mode: target.mode });
      const work = workspace.assertInside(target.path);
      const state = await createLearningStore(locks).read(work);
      const bible = await fanqie.readBible(work, locks);
      return {
        patterns: state.patterns.map((p) => ({
          signature: p.signature,
          kind: p.kind,
          condition: p.condition,
          change: p.change,
          count: p.count,
          promoted: p.promoted,
          examples: p.examples,
        })),
        rules: bible.style.rules,
      };
    },
  };

  async function dispose(): Promise<void> {
    const steps: Array<[string, () => Promise<void> | void]> = [
      ["config", () => unbindModels()],
      ["backup", () => backup.cancel()],
      ["workflow", () => workflow.stopAll()],
      ["sessions", () => sessions.dispose()],
      ["workspace", () => workspace.release()],
    ];
    for (const [step, run] of steps) {
      try {
        await run();
      } catch (error) {
        diagnostics.write("quit_cleanup_failed", { step, code: classify(error).code });
      }
    }
  }

  return { services, startupNotice, openWorkspace, dispose };
}
