import {
  app,
  BrowserWindow,
  dialog,
  ipcMain,
  safeStorage,
  Notification,
  clipboard,
  shell,
} from "electron";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { mkdir, readFile, writeFile } from "node:fs/promises";
import { parseToutiaoConfig } from "../../../packages/toutiao/src/config";
import { parseFanqieConfig } from "../../../packages/fanqie/src/config";
import {
  Sessions,
  type Target,
  type ModelSettings,
  type Focus,
} from "./session";
import { setStateRoot } from "../../../packages/core/src/paths";
import { setProfilesRoot } from "../../../packages/core/src/profiles";
import { profileRoutes } from "../../../packages/core/src/profile-api";
import { toutiaoLibrary } from "../../../packages/toutiao/src/methods";
import { fanqieLibrary } from "../../../packages/fanqie/src/forge";
import { toutiaoApi } from "../../../packages/toutiao/src/workbench/api";
import { fanqieApi } from "../../../packages/fanqie/src/workbench/api";
import { rememberRoot } from "../../../packages/toutiao/src/env";
import {
  ensureStorage,
  listProjects,
  rememberProject,
  projectIdOf,
  resolveWorkDir,
} from "../../../packages/fanqie/src/engine/work-store";
import { buildDeliveryPrompt } from "../../../packages/fanqie/src/workbench/delivery";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import updater from "electron-updater";
const { autoUpdater } = updater;
import { Settings } from "./settings";
import { connection } from "./models";
import { testConnection } from "./pi";
import { Diagnostics, explainError } from "./diagnostics";
import { inspectRecovery, recoverWork } from "./recovery";
import { exportContent, wordDocument } from "./exports";
import { VERSION } from "../../../packages/core/src/version";
import {
  setWorkspaceHost,
  claimWorkspace,
  workspaceAccess,
  releaseWorkspace,
  releaseWorkspaces,
  assertWorkspaceWritable,
} from "../../../packages/core/src/workspace-lock";
import {
  listArticles,
  buildToutiaoDelivery,
} from "../../../packages/toutiao/src/workbench/data";

import { API, type RouteContext } from "../../../packages/workbench/src/server";
const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow;
let sessions: Sessions;
let target: Target;
let selectionVersion = 0;
let home: string;
let model: ModelSettings;
let settings: Settings;
let diagnostics: Diagnostics;
let access: { readOnly: boolean; owner: any } = {
  readOnly: false,
  owner: null,
};
let maintenance = false;
let updateState: any = { state: "idle" };
const deliveries = new Map<string, Promise<unknown>>();
if (!app.isPackaged && process.env.WRITER_USER_DATA)
  app.setPath("userData", process.env.WRITER_USER_DATA);
let writerConfig: {
  toutiao?: ReturnType<typeof parseToutiaoConfig>["value"];
  fanqie?: ReturnType<typeof parseFanqieConfig>["value"];
} = {};
function emit(value: any) {
  if (value.error) value = { ...value, error: explainError(value.error) };
  if (value.event?.type === "agent_settled") {
    void diagnostics?.write("task_ended", {
      mode: value.target?.mode,
      work: value.target?.work,
      aborted: value.event.aborted,
    });
    if (!value.editor && !window?.isFocused() && Notification.isSupported()) {
      const notification = new Notification({
        title: "写作 Agent",
        body: value.event.aborted
          ? "任务已停止，已保存结果保留"
          : "写作任务已结束，等待你查看稿件与回报。",
      });
      notification.on("click", () => {
        window.show();
        window.focus();
        emit({ navigate: value.target, focus: value.focus });
      });
      notification.show();
    }
    if (
      value.target &&
      target &&
      sessions.key(value.target) !== sessions.key(target) &&
      !sessions
        .running()
        .some(
          (item) => sessions.key(item.target) === sessions.key(value.target),
        )
    )
      void lockRoot(value.target).then(releaseWorkspace);
  }
  if (value.event?.type === "tool_execution_end")
    void diagnostics?.write("tool_ended", { tool: value.event.toolName });
  if (window && !window.isDestroyed())
    window.webContents.send("writer:event", value);
}
let confirmations = Promise.resolve();
function confirm(text: string, signal?: AbortSignal): Promise<boolean> {
  const result = confirmations.then(async () => {
    if (signal?.aborted) return false;
    const answer = await dialog.showMessageBox(window, {
      type: "question",
      title: "作者确认",
      message: text,
      buttons: ["取消", "确认"],
      defaultId: 0,
      cancelId: 0,
      signal,
    });
    return !signal?.aborted && answer.response === 1;
  });
  confirmations = result.then(
    () => {},
    () => {},
  );
  return result;
}
function pythonPath() {
  return app.isPackaged
    ? path.join(
        process.resourcesPath,
        "python",
        process.platform === "win32" ? "python.exe" : "bin/python3",
      )
    : process.env.WRITER_PYTHON ||
        (process.platform === "win32" ? "py -3" : "python3");
}
async function lockRoot(value: Target) {
  if (value.mode === "toutiao" || !value.work) return value.root;
  const project = (await listProjects()).find(
    (item) => item.id === projectIdOf(value.root),
  );
  return resolveWorkDir(
    await ensureStorage(null, {
      ...writerConfig.fanqie,
      storageRoot: value.root,
      worksRoot: project?.worksRoot,
    }),
    value.work,
  );
}
async function selectTarget(next: Target) {
  if (maintenance) throw new Error("正在恢复作品，请等待完成后切换");
  const version = ++selectionVersion;
  const previous = target;
  const normalized = {
    mode: next.mode,
    root: path.resolve(next.root),
    ...(next.work ? { work: next.work } : {}),
  };
  if (normalized.mode === "toutiao") rememberRoot(normalized.root);
  else {
    const project = (await listProjects()).find(
      (p) => p.id === projectIdOf(normalized.root),
    );
    const unified =
      settings?.workspace &&
      normalized.root === path.join(settings.workspace, ".writer");
    const paths = await ensureStorage(null, {
      ...writerConfig.fanqie,
      storageRoot: normalized.root,
      ...(project?.worksRoot
        ? { worksRoot: project.worksRoot }
        : unified
          ? { worksRoot: path.join(settings.workspace, "novels") }
          : {}),
    });
    await rememberProject(paths.base, paths.works);
  }
  if (version !== selectionVersion) return target;
  target = normalized;
  if (
    previous &&
    sessions.key(previous) !== sessions.key(target) &&
    !sessions
      .running()
      .some((item) => sessions.key(item.target) === sessions.key(previous))
  )
    await releaseWorkspace(await lockRoot(previous));
  access = await claimWorkspace(await lockRoot(target));
  if (previous && sessions.key(previous) !== sessions.key(target))
    sessions.release(previous);
  await writeFile(path.join(home, "target.json"), JSON.stringify(target));
  return target;
}
async function performRequest(
  operation: string,
  options: {
    method?: string;
    query?: Record<string, unknown>;
    body?: any;
  } = {},
) {
  if (!target) throw new Error("请先选择创作目录");
  if (maintenance && options.method === "POST") throw new Error("正在恢复作品，请等待完成后再修改");
  const selected = { ...target };
  const url = new URL(API + operation, "http://writer.local");
  for (const [k, v] of Object.entries(options.query || {}))
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const body = options.body || {};
  const projects = await listProjects();
  // 新建方案的 base 表示方法底稿（default / original），不是作品目录。
  const base = operation.endsWith("/profiles/create")
    ? undefined
    : body.base || body.project || options.query?.base;
  const project = projects.find((p: any) =>
    base ? p.id === base || p.base === base : p.base === selected.root,
  );
  if (base && !project) throw new Error("项目未登记，请重新选择创作目录");
  const root =
    body.root || options.query?.root || project?.base || selected.root;
  const mode = operation.startsWith("/toutiao") ? "toutiao" : "fanqie";
  const operationTarget: Target = {
    mode,
    root: String(root),
    ...(body.work || options.query?.work
      ? { work: String(body.work || options.query?.work) }
      : {}),
  };
  if (operation.endsWith("/deliver") || operation === "/agent/deliver") {
    await selectTarget(operationTarget);
    emit({ selection: target });
    const prompt =
      mode === "toutiao"
        ? await buildToutiaoDelivery(operationTarget.root, body, "")
        : await buildDeliveryPrompt(
            await resolveWorkDir(
              await ensureStorage(null, {
                ...writerConfig.fanqie,
                storageRoot: operationTarget.root,
                ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
              }),
              body.work,
            ),
            body,
            "",
          );
    const focus: Focus =
      mode === "toutiao"
        ? { article: body.id, source: "article" }
        : {
            chapter: "chapterId" in prompt ? prompt.chapterId : undefined,
            source: "chapter",
          };
    await sessions.send(operationTarget, prompt.text, {
      ...focus,
      intent: body.action === "review" ? "review" : "write",
    });
    return { status: 200, data: { ok: true, text: prompt.text } };
  }
  if (operation.endsWith("/capabilities"))
    return {
      status: 200,
      data: {
        ok: true,
        quick: true,
        deep: false,
        deliver: !!model.writer.apiKey,
        reason: model.writer.apiKey ? undefined : "请先保存模型连接",
      },
    };
  const cfg = {
    ...writerConfig[mode],
    storageRoot: operationTarget.root,
    python: pythonPath(),
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
  };
  const modes = [
    toutiaoApi(cfg, () => !!model.writer.apiKey),
    fanqieApi(cfg),
    profileRoutes(
      API + "/toutiao",
      toutiaoLibrary,
      () => writerConfig.toutiao?.profile,
    ),
    profileRoutes(
      API + "/fanqie",
      fanqieLibrary,
      () => writerConfig.fanqie?.profile,
    ),
  ];
  let response: { status: number; data: any } = {
    status: 404,
    data: { ok: false, error: "未知操作" },
  };
  const ctx: RouteContext = {
    url,
    method: options.method || "GET",
    path: url.pathname,
    json(status, data) {
      response = { status, data };
    },
    async body() {
      return body;
    },
    async readBody() {
      return { parsed: body };
    },
  };
  for (const handler of modes) if (await handler.handle(ctx)) break;
  if (operation === "/toutiao/articles") {
    response.data.currentRoot = selected.root;
    response.data.deliverReason = model.writer.apiKey
      ? undefined
      : "请先保存模型连接";
  }
  const writes =
    /\/(candidate\/accept|chapter\/(review|finalize)|revision\/acknowledge|diagnostics\/stage|toutiao\/adopt|profiles\/(use|create|save|reset|rename|delete))$/.test(
      operation,
    );
  if (ctx.method === "POST" && response.status < 400 && writes) {
    try {
      const notifyTarget =
        !operationTarget.work &&
        mode === selected.mode &&
        operationTarget.root === selected.root
          ? selected
          : operationTarget;
      await sessions.notify(notifyTarget, {
        operation,
        article: body.id,
        chapter: body.chapter || body.chapterId || response.data.chapterId,
        candidate: body.candidate || response.data.candidateId,
        revision: response.data.revision || response.data.rev,
        status: response.data.status,
        profile: typeof body.profile === "string" ? body.profile : undefined,
      });
    } catch (error) {
      emit({
        target: operationTarget,
        error: "操作已完成，但对话通知失败：" + String(error),
      });
    }
    emit({ refresh: true });
  }
  return response;
}
async function request(operation: string, options: any = {}) {
  const id = options.body?.requestId;
  if (!id || !operation.endsWith("/deliver"))
    return performRequest(operation, options);
  const key = JSON.stringify([
    operation,
    id,
    options.body.root,
    options.body.base,
    options.body.work,
  ]);
  if (deliveries.has(key)) return deliveries.get(key);
  const pending = performRequest(operation, options);
  deliveries.set(key, pending);
  if (deliveries.size > 100) deliveries.delete(deliveries.keys().next().value!);
  try {
    return await pending;
  } catch (error) {
    deliveries.delete(key);
    throw error;
  }
}

app
  .whenReady()
  .then(async () => {
    if (process.platform === "win32")
      app.setAppUserModelId("local.writer.agent");
    const resources = app.isPackaged
      ? path.join(process.resourcesPath, "writer")
      : path.resolve(here, "../../resources/writer");
    process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(resources, "skill");
    process.env.WRITER_FANQIE_SKILL_DIR = path.join(resources, "skill-fanqie");
    process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(
      resources,
      "profiles/toutiao/default",
    );
    process.env.WRITER_FANQIE_DEFAULT_DIR = path.join(
      resources,
      "profiles/fanqie/default",
    );
    home = app.getPath("userData");
    await mkdir(home, { recursive: true });
    setStateRoot(home);
    setProfilesRoot(
      await readFile(path.join(home, "profiles-directory"), "utf8").catch(() =>
        path.join(home, "profiles"),
      ),
    );
    setWorkspaceHost("独立客户端");
    settings = new Settings(home, {
      available: () =>
        safeStorage.isEncryptionAvailable() &&
        (process.platform !== "linux" ||
          safeStorage.getSelectedStorageBackend() !== "basic_text"),
      encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
      decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
    });
    await settings.load();
    model = settings.models;
    diagnostics = new Diagnostics(home);
    await diagnostics.init();
    await diagnostics.write("start", { version: VERSION });
    const raw = await settings.readObject("writer.json");
    const toutiao = parseToutiaoConfig(raw.toutiao),
      fanqie = parseFanqieConfig(raw.fanqie);
    if (toutiao.issues.length || fanqie.issues.length)
      settings.notices.push("业务配置有无效字段，已对相应模式使用默认配置。");
    writerConfig = {
      toutiao: toutiao.issues.length
        ? parseToutiaoConfig({}).value
        : toutiao.value,
      fanqie: fanqie.issues.length ? parseFanqieConfig({}).value : fanqie.value,
    };
    sessions = new Sessions(
      home,
      pythonPath(),
      () => model,
      emit,
      confirm,
      writerConfig,
      async (previous, next) => {
        if (target && sessions.key(target) === sessions.key(previous)) {
          emit({ navigate: next });
        }
      },
      {
        preferences: () => settings.preferences(),
        searchKey: () => settings.searchKey,
        log: (event, fields) => {
          void diagnostics.write(event, fields);
        },
      },
    );
    const saved = await readFile(path.join(home, "target.json"), "utf8").catch(
      () => "",
    );
    let notice = settings.notices.join("\n");
    if (saved) {
      try {
        await selectTarget(JSON.parse(saved));
      } catch (error) {
        notice = "最近项目恢复未完成，请重新选择目录：" + String(error);
      }
    }

    ipcMain.handle("writer:state", () => ({
      target,
      notice,
      access,
      ...settings.public(),
      version: VERSION,
      updates: updateState,
    }));
    ipcMain.handle("writer:choose", async (_event, mode) => {
      if (mode !== "toutiao" && mode !== "fanqie") throw new Error("未知模式");
      const result = await dialog.showOpenDialog(window, {
        title:
          mode === "fanqie"
            ? "选择长篇数据根（包含 works，或空目录）"
            : "选择头条文章目录",
        properties: ["openDirectory", "createDirectory"],
      });
      return result.canceled
        ? null
        : selectTarget({ mode, root: result.filePaths[0] });
    });
    ipcMain.handle("writer:model", async (_event, next) => {
      await sessions.dispose();
      notice = await settings.saveModels(next);
      model = settings.models;
      emit({ running: [] });
      emit({ refresh: true });
      await diagnostics.write("models_saved");
      return settings.public();
    });
    ipcMain.handle("writer:test-model", async (_event, role, next) => {
      const previous = model[role as keyof ModelSettings] || model.writer;
      try {
        const value = connection(next, previous);
        if (!value.apiKey && value.baseUrl === model.writer.baseUrl)
          value.apiKey = model.writer.apiKey;
        return await testConnection(
          value,
          path.join(home, "agent", "auth.json"),
        );
      } catch (error) {
        throw new Error(explainError(error));
      }
    });
    ipcMain.handle("writer:appearance", async (_event, next) => {
      await settings.saveUI({ appearance: next });
      return settings.appearance;
    });
    ipcMain.handle("writer:preferences", async (_event, text) => {
      if (typeof text === "string") await settings.savePreferences(text);
      return settings.preferences();
    });
    ipcMain.handle("writer:search", async (_event, key) => {
      await settings.saveSearch(String(key));
      await sessions.dispose();
      emit({ running: [] });
      return settings.public();
    });
    ipcMain.handle("writer:workspace", async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "选择统一写作根",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      await settings.saveUI({ workspace: result.filePaths[0] });
      await Promise.all([
        mkdir(path.join(settings.workspace, "novels"), { recursive: true }),
        mkdir(path.join(settings.workspace, "toutiao"), { recursive: true }),
      ]);
      const chosen = await selectTarget({
        mode: "fanqie",
        root: path.join(settings.workspace, ".writer"),
      });
      return { target: chosen, ...settings.public() };
    });
    ipcMain.handle("writer:projects", async () => {
      const projects = await listProjects({ refresh: true }),
        articles = await listArticles(),
        items: any[] = [];
      for (const project of projects)
        for (const work of project.works || [])
          items.push({
            label: work.title,
            target: { mode: "fanqie", root: project.base, work: work.key },
            focus: { workTitle: work.title },
          });
      for (const article of articles.articles)
        items.push({
          label: article.title,
          target: { mode: "toutiao", root: article.root },
          focus: {
            article: article.id,
            title: article.title,
            source: "article",
          },
        });
      return items;
    });
    ipcMain.handle("writer:new-target", async (_event, mode) => {
      if (!settings.workspace) throw new Error("请先选择统一写作根");
      const next: Target = {
        mode,
        root: path.join(
          settings.workspace,
          mode === "fanqie" ? ".writer" : "toutiao",
        ),
      };
      return selectTarget(next);
    });
    ipcMain.handle("writer:new-conversation", async (_event, next) => {
      await sessions.newConversation(next);
      return true;
    });
    ipcMain.handle("writer:conversations", async (_event, next) =>
      (await sessions.conversations(next)).map(({ file, ...value }) => value),
    );
    ipcMain.handle("writer:export", async (_event, next, focus, format) => {
      const content = await exportContent(next, focus);
      const answer = await dialog.showMessageBox(window, {
        type: content.issues.length ? "warning" : "info",
        title: "导出与发布检查",
        message: [...content.issues, content.reminder].join("\n"),
        buttons: ["取消", format === "copy" ? "复制标题与正文" : "导出"],
        defaultId: 0,
        cancelId: 0,
      });
      if (answer.response !== 1) return null;
      if (format === "copy") {
        clipboard.writeText(content.text);
        return { copied: true };
      }
      const extension = format === "docx" ? "docx" : "txt",
        result = await dialog.showSaveDialog(window, {
          title: "导出稿件",
          defaultPath:
            content.title.replace(/[<>:\"/\\|?*]/g, "_") + "." + extension,
          filters: [{ name: extension, extensions: [extension] }],
        });
      if (result.canceled || !result.filePath) return null;
      await writeFile(
        result.filePath,
        extension === "docx"
          ? await wordDocument(content.title, content.text)
          : content.text,
      );
      return { file: result.filePath };
    });
    async function backupDirectory(source: string) {
      const result = await dialog.showOpenDialog(window, {
        title: "选择备份保存位置（写作根以外）",
        properties: ["openDirectory", "createDirectory"],
      });
      if (result.canceled) return null;
      const output = path.join(
        result.filePaths[0],
        "写作备份-" + new Date().toISOString().replace(/[:.]/g, "-"),
      );
      await promisify(execFile)(
        process.execPath,
        [
          path.join(resources, "scripts/writer-backup.mjs"),
          "--source",
          source,
          "--output",
          output,
        ],
        {
          env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" },
          maxBuffer: 1024 * 1024,
        },
      );
      await promisify(execFile)(process.execPath,
        [path.join(resources, "scripts/writer-backup.mjs"), "--verify", output],
        { env: { ...process.env, ELECTRON_RUN_AS_NODE: "1" }, maxBuffer: 1024 * 1024 });
      await diagnostics.write("backup_completed");
      return { file: output };
    }
    ipcMain.handle("writer:backup", async () => {
      if (!settings.workspace) throw new Error("请先选择写作根");
      return backupDirectory(settings.workspace);
    });
    ipcMain.handle("writer:storage-health", async () => {
      if (!target) throw new Error("请先选择作品");
      const current = { ...target };
      return { ...(await inspectRecovery(await lockRoot(current))), target: current,
        label: current.work || "当前目录" };
    });
    ipcMain.handle("writer:recover", async (_event, expected) => {
      if (maintenance) throw new Error("已有恢复操作正在进行");
      if (!target?.work || target.mode !== "fanqie") throw new Error("请先打开待恢复的长篇作品");
      if (sessions.hasPending() || sessions.running().length) throw new Error("请先停止所有任务，再检查恢复");
      const current = { ...target };
      maintenance = true;
      try {
        const dir = await lockRoot(current);
        const state = await inspectRecovery(dir);
        if (!state.canRecover || state.id !== expected?.id || state.fingerprint !== expected?.fingerprint)
          throw new Error("恢复条件已变化，请重新检查：" + state.reason);
        if (!(await confirm(`恢复《${current.work}》的未完成写入？将先备份并校验，再完成原操作。`))) return null;
        const result = await recoverWork(dir, expected, async () => (await backupDirectory(dir))?.file || null);
        emit({ target: current, refresh: true });
        return { file: result.backup, state: result.state };
      } finally { maintenance = false; }
    });
    ipcMain.handle("writer:diagnostics", async () => {
      const result = await dialog.showSaveDialog(window, {
        title: "导出诊断包",
        defaultPath: "写作Agent-诊断.json",
      });
      if (result.canceled || !result.filePath) return null;
      await writeFile(
        result.filePath,
        JSON.stringify(
          await diagnostics.bundle({
            version: VERSION,
            settings: settings.public(),
            writerConfig,
          }),
          null,
          2,
        ),
      );
      return { file: result.filePath };
    });
    ipcMain.handle("writer:external", (_event, url) => {
      const parsed = new URL(String(url));
      if (!["http:", "https:"].includes(parsed.protocol))
        throw new Error("只支持公开网页链接");
      return shell.openExternal(parsed.href);
    });
    ipcMain.handle("writer:updates", async (_event, action) => {
      if (!app.isPackaged) throw new Error("开发环境不下载更新");
      if (action === "download") await autoUpdater.downloadUpdate();
      else if (action === "install") {
        await sessions.dispose();
        await releaseWorkspaces();
        autoUpdater.quitAndInstall(false, true);
      } else await autoUpdater.checkForUpdates();
      return updateState;
    });
    ipcMain.handle("writer:profiles", async () => {
      const result = await dialog.showOpenDialog(window, {
        title: "选择用户方法方案根目录",
        properties: ["openDirectory", "createDirectory"],
      });
      if (!result.canceled) {
        setProfilesRoot(result.filePaths[0]);
        await writeFile(
          path.join(home, "profiles-directory"),
          result.filePaths[0],
        );
        emit({ refresh: true });
      }
      return !result.canceled;
    });
    ipcMain.handle("writer:select", (_event, next) => selectTarget(next));
    ipcMain.handle("writer:view", (_event, next, limit, archive) =>
      sessions.view(next, limit, archive),
    );
    ipcMain.handle("writer:running", () => sessions.running());
    ipcMain.handle("writer:request", (_event, operation, options) =>
      request(operation, options),
    );
    ipcMain.handle("writer:send", async (_event, text, next, focus) => {
      if (maintenance) throw new Error("正在恢复作品，请等待完成后再开始任务");
      if (!String(text).trim()) return;
      const bound = next || target;
      await sessions.send(bound, String(text), focus);
      return true;
    });
    ipcMain.handle("writer:stop", (_event, next) =>
      sessions.stop(next || target),
    );
    window = new BrowserWindow({
      width: 1380,
      height: 920,
      title: "写作 Agent",
      minWidth: 760,
      minHeight: 650,
      webPreferences: {
        preload: path.join(here, "../preload/preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
    const rendererOrigin = process.env.ELECTRON_RENDERER_URL;
    window.webContents.on("will-navigate", (event, url) => {
      const allowed = rendererOrigin
        ? new URL(url).origin === new URL(rendererOrigin).origin
        : url.startsWith("file:") &&
          url.split("#")[0] === window.webContents.getURL().split("#")[0];
      if (!allowed) {
        event.preventDefault();
        if (/^https?:/.test(url)) void shell.openExternal(url);
      }
    });
    window.webContents.session.webRequest.onHeadersReceived(
      (details, callback) =>
        callback({
          responseHeaders: {
            ...details.responseHeaders,
            "Content-Security-Policy": [
              "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline'; font-src 'self'; img-src 'self' data:; connect-src 'self'" +
                (rendererOrigin
                  ? " ws: http://localhost:* http://127.0.0.1:*"
                  : "") +
                "; object-src 'none'; base-uri 'none'; frame-src 'none'",
            ],
          },
        }),
    );
    autoUpdater.autoDownload = false;
    autoUpdater.autoInstallOnAppQuit = false;
    autoUpdater.on("checking-for-update", () => {
      updateState = { state: "checking", message: "正在检查更新…" };
      emit({ updates: updateState });
    });
    autoUpdater.on("update-not-available", () => {
      updateState = { state: "current", message: "当前已是最新版本" };
      emit({ updates: updateState });
    });
    autoUpdater.on("update-available", (info) => {
      updateState = { state: "available", version: info.version };
      emit({ updates: updateState });
    });
    autoUpdater.on("download-progress", (info) => {
      updateState = { state: "downloading", percent: Math.round(info.percent) };
      emit({ updates: updateState });
    });
    autoUpdater.on("update-downloaded", () => {
      updateState = { state: "downloaded" };
      emit({ updates: updateState });
    });
    autoUpdater.on("error", () => {
      updateState = { state: "error", message: "暂时无法检查更新，请稍后重试" };
      emit({ updates: updateState });
    });
    if (app.isPackaged) void autoUpdater.checkForUpdates().catch(() => {});
    window.webContents.setWindowOpenHandler(() => ({ action: "deny" }));
    if (process.env.ELECTRON_RENDERER_URL)
      await window.loadURL(process.env.ELECTRON_RENDERER_URL);
    else await window.loadFile(path.join(here, "../renderer/index.html"));
  })
  .catch((error) => {
    dialog.showErrorBox("写作 Agent 启动失败", String(error.message));
    app.quit();
  });
let quitting = false;
app.on("before-quit", (event) => {
  if (quitting) return;
  event.preventDefault();
  void (sessions ? sessions.dispose() : Promise.resolve()).finally(() => {
    void releaseWorkspaces().finally(() => {
      quitting = true;
      app.quit();
    });
  });
});
app.on("window-all-closed", () => app.quit());
