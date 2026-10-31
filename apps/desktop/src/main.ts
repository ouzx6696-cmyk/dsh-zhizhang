import { app, BrowserWindow, dialog, ipcMain, safeStorage } from "electron";
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
import { buildToutiaoDelivery } from "../../../packages/toutiao/src/workbench/data";

import { API, type RouteContext } from "../../../packages/workbench/src/server";
const here = path.dirname(fileURLToPath(import.meta.url));
let window: BrowserWindow;
let sessions: Sessions;
let target: Target;
let selectionVersion = 0;
let home: string;
let model: ModelSettings;
let writerConfig: {
  toutiao?: ReturnType<typeof parseToutiaoConfig>["value"];
  fanqie?: ReturnType<typeof parseFanqieConfig>["value"];
} = {};
function emit(value: unknown) {
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
async function selectTarget(next: Target) {
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
    const paths = await ensureStorage(null, {
      ...writerConfig.fanqie,
      storageRoot: normalized.root,
      ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
    });
    await rememberProject(paths.base, paths.works);
  }
  if (version !== selectionVersion) return target;
  target = normalized;
  if (previous && sessions.key(previous) !== sessions.key(target))
    sessions.release(previous);
  await writeFile(path.join(home, "target.json"), JSON.stringify(target));
  return target;
}
async function request(
  operation: string,
  options: {
    method?: string;
    query?: Record<string, unknown>;
    body?: any;
  } = {},
) {
  if (!target) throw new Error("请先选择创作目录");
  const selected = { ...target };
  const url = new URL(API + operation, "http://writer.local");
  for (const [k, v] of Object.entries(options.query || {}))
    if (v !== undefined && v !== "") url.searchParams.set(k, String(v));
  const body = options.body || {};
  const projects =
    options.query?.base || options.body?.base || options.body?.project
      ? await listProjects()
      : [];
  const base = body.base || body.project || options.query?.base;
  const project = projects.find((p: any) => p.id === base || p.base === base);
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
    await sessions.send(operationTarget, prompt.text, focus);
    return { status: 200, data: { ok: true, text: prompt.text } };
  }
  if (operation.endsWith("/capabilities"))
    return {
      status: 200,
      data: {
        ok: true,
        quick: true,
        deep: false,
        deliver: !!model.apiKey,
        reason: model.apiKey ? undefined : "请先保存模型连接",
      },
    };
  const cfg = {
    ...writerConfig[mode],
    storageRoot: operationTarget.root,
    python: pythonPath(),
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
  };
  const modes = [
    toutiaoApi(cfg, () => !!model.apiKey),
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
    response.data.deliverReason = model.apiKey ? undefined : "请先保存模型连接";
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
app
  .whenReady()
  .then(async () => {
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
    const stored = JSON.parse(
      await readFile(path.join(home, "model.json"), "utf8").catch(() => "{}"),
    );
    model = {
      baseUrl: "https://api.deepseek.com",
      model: "deepseek-chat",
      contextWindow: 128000,
      maxTokens: 8192,
      ...stored,
      apiKey: stored.secret
        ? safeStorage.decryptString(Buffer.from(stored.secret, "base64"))
        : "",
    };
    const raw = JSON.parse(
      await readFile(path.join(home, "writer.json"), "utf8").catch((error) => {
        if (error.code === "ENOENT") return "{}";
        throw error;
      }),
    );
    const toutiao = parseToutiaoConfig(raw.toutiao),
      fanqie = parseFanqieConfig(raw.fanqie);
    const issues = [...toutiao.issues, ...fanqie.issues];
    if (issues.length) throw new Error(issues.map((x) => x.message).join("；"));
    writerConfig = { toutiao: toutiao.value, fanqie: fanqie.value };
    sessions = new Sessions(
      home,
      pythonPath(),
      () => model,
      emit,
      confirm,
      writerConfig,
      async (previous, next) => {
        if (target && sessions.key(target) === sessions.key(previous)) {
          const chosen = await selectTarget(next);
          emit({ selection: chosen });
        }
      },
    );
    const saved = await readFile(path.join(home, "target.json"), "utf8").catch(
      () => "",
    );
    let notice = "";
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
      model: {
        ...model,
        apiKey: "",
        secret: undefined,
        configured: !!model.apiKey,
      },
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
      const baseUrl = new URL(String(next.baseUrl));
      if (!["http:", "https:"].includes(baseUrl.protocol))
        throw new Error("接口地址须为 HTTP(S) URL");
      const proposed = {
        baseUrl: baseUrl.href.replace(/\/$/, ""),
        model: String(next.model || "").trim(),
        apiKey: String(next.apiKey || model.apiKey),
        contextWindow: Number(next.contextWindow),
        maxTokens: Number(next.maxTokens),
      };
      if (!proposed.model || !proposed.apiKey)
        throw new Error("请填写模型 ID 和 API Key");
      if (
        !Number.isInteger(proposed.contextWindow) ||
        !Number.isInteger(proposed.maxTokens) ||
        proposed.maxTokens <= 0 ||
        proposed.contextWindow <= proposed.maxTokens
      )
        throw new Error("上下文窗口须大于最大输出，且均为正整数");
      const { apiKey, ...rest } = proposed;
      const stored = JSON.stringify({
        ...rest,
        secret: safeStorage.encryptString(apiKey).toString("base64"),
      });
      await sessions.dispose();
      await writeFile(path.join(home, "model.json"), stored);
      model = proposed;
      emit({ running: [] });
      emit({ refresh: true });
      return true;
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
    ipcMain.handle("writer:view", (_event, next, limit) =>
      sessions.view(next, limit),
    );
    ipcMain.handle("writer:running", () => sessions.running());
    ipcMain.handle("writer:request", (_event, operation, options) =>
      request(operation, options),
    );
    ipcMain.handle("writer:send", async (_event, text, next, focus) => {
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
      minWidth: 900,
      minHeight: 650,
      webPreferences: {
        preload: path.join(here, "../preload/preload.cjs"),
        contextIsolation: true,
        nodeIntegration: false,
      },
    });
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
    quitting = true;
    app.quit();
  });
});
app.on("window-all-closed", () => app.quit());
