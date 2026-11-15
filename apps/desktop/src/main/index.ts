/**
 * 组合根：构造各服务并注入；不持有全局可变 Runtime。
 * 状态目录默认 ~/.zhizhang（ZHIZHANG_STATE_ROOT 可覆盖），随包资源在 resources/zhizhang。
 */
import { existsSync } from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { app, dialog, safeStorage, type BrowserWindow } from "electron";
import { systemClock } from "@zhizhang/core/clock";
import { AppError, classify } from "@zhizhang/core/errors";
import { createLockService } from "@zhizhang/core/lock";
import { resolveUserProfilesDir } from "@zhizhang/core/methods";
import { resolveStateRoot, STATE_ROOT_ENV } from "@zhizhang/core/paths";
import { APP_ID, APP_VERSION } from "@zhizhang/core/version";
import { commands as fanqie, createLearningStore } from "@zhizhang/fanqie";
import type { DesktopEvent } from "../shared/events.js";
import type { Focus, Mode, Target, UpdateStatus, WorkspaceStatus } from "../shared/views.js";
import { createConversationStore } from "../session/history.js";
import { createSessionManager } from "../session/manager.js";
import { runBackup } from "./backup-process.js";
import type { CommandCtx } from "./commands.js";
import { registerQuitCleanup } from "./exit.js";
import { registerIpc } from "./ipc/register.js";
import { createModelServices } from "./models.js";
import { ModeRegistry } from "./modes.js";
import { createConfigService, type SecretCipher } from "./services/config.js";
import { createDiagnostics } from "./services/diagnostics.js";
import { createRunStore } from "./services/runs.js";
import { createStorageHealth } from "./services/storage-health.js";
import { createWorkspaceService } from "./services/workspace.js";
import { createMainWindow } from "./window.js";
import { createWorkflowService } from "./workflow.js";

const here = path.dirname(fileURLToPath(import.meta.url));
const devStateRoot = process.env.ZHIZHANG_USER_DATA?.trim();
if (!app.isPackaged && devStateRoot) process.env[STATE_ROOT_ENV] = devStateRoot;

const resources = app.isPackaged
  ? path.join(process.resourcesPath, "zhizhang")
  : path.resolve(here, "../../resources/zhizhang");
const pythonRoot = app.isPackaged
  ? path.join(process.resourcesPath, "python")
  : path.resolve(here, "../../resources/python");
const toutiaoScripts = path.join(resources, "skill", "scripts");
const toutiaoProfile = path.join(resources, "profiles", "toutiao", "default");

process.env.ZHIZHANG_TOUTIAO_SCRIPTS_DIR ??= toutiaoScripts;
if (!process.env.ZHIZHANG_PYTHON && existsSync(path.join(pythonRoot, "zhizhang-runtime.json"))) {
  process.env.ZHIZHANG_PYTHON = path.join(
    pythonRoot,
    process.platform === "win32" ? "python.exe" : "bin/python3",
  );
}

const safeStorageCipher: SecretCipher = {
  available: () =>
    safeStorage.isEncryptionAvailable() &&
    (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
  encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
  decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
};

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

async function bootstrap(): Promise<void> {
  if (process.platform === "win32") app.setAppUserModelId(APP_ID);
  const clock = systemClock;
  const stateRoot = resolveStateRoot();
  await fs.mkdir(stateRoot, { recursive: true });
  const locks = createLockService(clock);
  const diagnostics = createDiagnostics(path.join(stateRoot, "logs"), clock);
  diagnostics.write("start", { version: APP_VERSION, packaged: app.isPackaged });

  let window: BrowserWindow | undefined;
  const emit = (event: DesktopEvent) => {
    if (window && !window.isDestroyed()) window.webContents.send("zhizhang:event", event);
  };

  const config = await createConfigService({ stateRoot, cipher: safeStorageCipher });
  const issue = config.issue();
  if (issue) diagnostics.write("settings_invalid", { code: issue.code, path: issue.path });
  const workspace = createWorkspaceService({ locks, clock });
  const models = createModelServices({
    config,
    clock,
    authPath: path.join(stateRoot, "pi", "auth.json"),
  });
  config.onChange(() => models.rebuild());

  const profileDirs = {
    builtin: (mode: Mode) => path.join(resources, "profiles", mode),
    userDir: resolveUserProfilesDir(),
  };
  const profileRoots = (mode: Mode) => ({
    builtinDir: profileDirs.builtin(mode),
    userDir: profileDirs.userDir,
  });

  const runs = createRunStore(path.join(stateRoot, "runs"));
  const workflow = createWorkflowService({
    clock,
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
    emit,
    prepareRequest(kind, request) {
      if (kind !== "toutiao.article" || !isRecord(request)) return request;
      return {
        ...request,
        scriptsDir: typeof request.scriptsDir === "string" ? request.scriptsDir : toutiaoScripts,
        profileDir: typeof request.profileDir === "string" ? request.profileDir : toutiaoProfile,
        ledgerPath:
          typeof request.ledgerPath === "string"
            ? request.ledgerPath
            : path.join(workspace.status().roots.toutiao, "ledger.csv"),
      };
    },
  });

  const commands: CommandCtx = {
    clock,
    locks,
    inside: (target) => workspace.assertInside(target),
    roots: () => workspace.status().roots,
    profiles: profileDirs,
    scriptsDir: toutiaoScripts,
    workflow,
    log: (event, data) => diagnostics.write(event, { message: String(data.message ?? "") }),
  };

  const sessions = createSessionManager({
    clock,
    store: createConversationStore(path.join(stateRoot, "sessions"), clock),
    gateway: () => models.gateway(),
    port: () => models.port(),
    binding: () => models.assistantBinding(),
    tools: (target) => ModeRegistry.get(target.mode).tools("assistant", target),
    toolCtx: (target) => ({
      workspaceRoot: workspace.status().root,
      readonly: workspace.status().readonly,
      profileRoots: profileRoots(target.mode),
      host: {
        async startPipeline(kind, request) {
          workspace.assertWritable();
          const ref = await workflow.start(target, kind, request);
          return { runId: ref.runId, kind };
        },
        navigate: (focus) => emit({ kind: "navigate", target, focus: focusOf(focus) }),
      },
    }),
    context: () => config.settings().context,
    preferences: () => config.settings().assistant.preferences,
    readonly: () => workspace.status().readonly,
    async title(target) {
      if (target.mode !== "fanqie") return undefined;
      return (await fanqie.getWork(target.path).catch(() => undefined))?.title;
    },
    emit,
    onBusyChange: () =>
      emit({ kind: "running", rows: [...workflow.running(), ...sessions.running()] }),
  });

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
        await runBackup(
          path.join(resources, "scripts", "zhizhang-backup.mjs"),
          ["--source", root, "--output", dir],
          controller.signal,
        );
        diagnostics.write("backup_done", {});
        return { dir, sources: [root] };
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
    if (!config.issue() && config.settings().workspaceRoot !== status.root)
      await config.setWorkspaceRoot(status.root);
    emit({ kind: "workspace.status", status });
    if (status.readonly) {
      emit({
        kind: "notice",
        code: "storage.locked",
        data: { readonly: true, ...(status.owner ? { owner: status.owner } : {}) },
      });
    }
    return status;
  }

  const updates = (_action: "status" | "check"): UpdateStatus => ({
    state: "unavailable",
    version: APP_VERSION,
    reason: app.isPackaged ? "disabled" : "unpacked",
  });

  const initialRoot = config.settings().workspaceRoot?.trim();
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

  registerIpc({
    version: APP_VERSION,
    clock,
    window: () => window,
    emit,
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
        platform: process.platform,
        arch: process.arch,
        electron: process.versions.electron,
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
  });

  window = await createMainWindow(config.settings().appearance);
  if (startupNotice) emit(startupNotice);

  registerQuitCleanup(
    [
      ["backup", () => backup.cancel()],
      ["workflow", () => workflow.stopAll()],
      ["sessions", () => sessions.dispose()],
      ["workspace", () => workspace.release()],
    ],
    (step, error) => diagnostics.write("quit_cleanup_failed", { step, code: classify(error).code }),
  );
  app.on("window-all-closed", () => app.quit());
}

app
  .whenReady()
  .then(bootstrap)
  .catch((error: unknown) => {
    const appErr = classify(error);
    dialog.showErrorBox("织章 启动失败", `${appErr.code}: ${appErr.message}`);
    app.quit();
  });
