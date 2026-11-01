import path from "node:path";
import { mkdir, readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, safeStorage } from "electron";
import { Runtime } from "./runtime";
import { createMainWindow } from "./window";
import { selectTarget } from "./targets";
import { registerIpc } from "./ipc/register";
import { initUpdates } from "./ipc/updates";
import { Sessions } from "../session";
import { Settings } from "../settings";
import { Diagnostics } from "../diagnostics";
import { parseToutiaoConfig } from "../../../../packages/toutiao/src/config";
import { parseFanqieConfig } from "../../../../packages/fanqie/src/config";
import { setStateRoot } from "../../../../packages/core/src/paths";
import { setProfilesRoot } from "../../../../packages/core/src/profiles";
import {
  setWorkspaceHost,
  releaseWorkspaces,
} from "../../../../packages/core/src/workspace-lock";
import { VERSION } from "../../../../packages/core/src/version";

export async function start() {
  if (process.platform === "win32") app.setAppUserModelId("local.writer.agent");
  const state = new Runtime();
  state.resources = app.isPackaged
    ? path.join(process.resourcesPath, "writer")
    : path.resolve(
        path.dirname(fileURLToPath(import.meta.url)),
        "../../resources/writer",
      );
  process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(state.resources, "skill");
  process.env.WRITER_FANQIE_SKILL_DIR = path.join(state.resources, "skill-fanqie");
  process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(state.resources, "profiles/toutiao/default");
  process.env.WRITER_FANQIE_DEFAULT_DIR = path.join(state.resources, "profiles/fanqie/default");
  state.home = app.getPath("userData");
  await mkdir(state.home, { recursive: true });
  setStateRoot(state.home);
  setProfilesRoot(
    await readFile(path.join(state.home, "profiles-directory"), "utf8").catch(() =>
      path.join(state.home, "profiles"),
    ),
  );
  setWorkspaceHost("独立客户端");
  state.settings = new Settings(state.home, {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" ||
        safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
    decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
  });
  await state.settings.load();
  state.model = state.settings.models;
  state.diagnostics = new Diagnostics(state.home);
  await state.diagnostics.init();
  await state.diagnostics.write("start", { version: VERSION });
  const raw = await state.settings.readObject("writer.json");
  const toutiao = parseToutiaoConfig(raw.toutiao),
    fanqie = parseFanqieConfig(raw.fanqie);
  if (toutiao.issues.length || fanqie.issues.length)
    state.settings.notices.push("业务配置有无效字段，已对相应模式使用默认配置。");
  state.writerConfig = {
    toutiao: toutiao.issues.length ? parseToutiaoConfig({}).value : toutiao.value,
    fanqie: fanqie.issues.length ? parseFanqieConfig({}).value : fanqie.value,
  };
  state.sessions = new Sessions(
    state.home,
    state.pythonPath(),
    () => state.model,
    (event) => state.emit(event),
    (text, signal) => state.confirm(text, signal),
    state.writerConfig,
    async (previous, next) => {
      if (state.target && state.sessions.key(state.target) === state.sessions.key(previous)) {
        state.emit({ navigate: next });
      }
    },
    {
      preferences: () => state.settings.preferences(),
      searchKey: () => state.settings.searchKey,
      log: (event, fields) => {
        void state.diagnostics.write(event, fields);
      },
    },
  );
  const saved = await readFile(path.join(state.home, "target.json"), "utf8").catch(() => "");
  let notice = state.settings.notices.join("\n");
  if (saved) {
    try {
      await selectTarget(state, JSON.parse(saved));
    } catch (error) {
      notice = "最近项目恢复未完成，请重新选择目录：" + String(error);
    }
  }
  state.notice = notice;
  registerIpc(state);
  const loading = createMainWindow(state);
  initUpdates(state);
  await loading;
  registerLifecycle(state);
}

function registerLifecycle(state: Runtime) {
  let quitting = false;
  app.on("before-quit", (event) => {
    if (quitting) return;
    event.preventDefault();
    void (state.sessions ? state.sessions.dispose() : Promise.resolve()).finally(() => {
      void releaseWorkspaces().finally(() => {
        quitting = true;
        app.quit();
      });
    });
  });
  app.on("window-all-closed", () => app.quit());
}
