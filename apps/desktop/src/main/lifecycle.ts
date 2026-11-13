import { readText } from "../../../../packages/core/src/fsx";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { app, safeStorage } from "electron";
import { Runtime } from "./runtime";
import { createMainWindow } from "./window";
import { registerQuitCleanup } from "./exit";
import { lockRoot, selectTarget } from "./targets";
import { parseTarget } from "./ipc/validate";
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
  cleanStaleWorkspaceClaim,
  setWorkspaceHost,
} from "../../../../packages/core/src/workspace-lock";
import { VERSION } from "../../../../packages/core/src/version";

export async function start() {
  if (process.platform === "win32") app.setAppUserModelId("local.writer.agent");
  const state = new Runtime();
  state.resources = app.isPackaged
    ? path.join(process.resourcesPath, "writer")
    : path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../resources/writer");
  process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(state.resources, "skill");
  process.env.WRITER_FANQIE_SKILL_DIR = path.join(state.resources, "skill-fanqie");
  process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(state.resources, "profiles/toutiao/default");
  process.env.WRITER_FANQIE_DEFAULT_DIR = path.join(state.resources, "profiles/fanqie/default");
  state.home = app.getPath("userData");
  await mkdir(state.home, { recursive: true });
  setStateRoot(state.home);
  setProfilesRoot(path.join(state.home, "profiles"));
  setWorkspaceHost("独立客户端");
  state.settings = new Settings(state.home, {
    available: () =>
      safeStorage.isEncryptionAvailable() &&
      (process.platform !== "linux" || safeStorage.getSelectedStorageBackend() !== "basic_text"),
    encrypt: (text) => safeStorage.encryptString(text).toString("base64"),
    decrypt: (text) => safeStorage.decryptString(Buffer.from(text, "base64")),
  });
  await state.settings.load();
  state.model = state.settings.models;
  state.diagnostics = new Diagnostics(state.home);
  await state.diagnostics.init();
  await state.diagnostics.write("start", { version: VERSION });
  const raw = await state.settings.writerOptions();
  const toutiao = parseToutiaoConfig(raw.toutiao),
    fanqie = parseFanqieConfig(raw.fanqie);
  if (toutiao.issues.length || fanqie.issues.length)
    state.settings.notices.push("业务配置有无效字段，已对相应模式使用默认配置。");
  state.writerConfig = {
    toutiao: toutiao.issues.length ? parseToutiaoConfig({}).value : toutiao.value,
    fanqie: fanqie.issues.length ? parseFanqieConfig({}).value : fanqie.value,
  };
  state.sessions = new Sessions({
    home: state.home,
    python: state.pythonPath(),
    settings: () => state.model,
    emit: (event) => {
      void state.sessionEvent(event);
    },
    confirm: (text, signal) => state.confirm(text, signal),
    options: state.writerConfig,
    created: async (previous, next) => {
      if (state.target && state.sessions.same(state.target, previous)) {
        state.emit({ navigate: next });
      }
    },
    extras: {
      engine: () => state.settings.engine,
      context: () => state.settings.context,
      preferences: () => state.settings.preferences(),
      savePreferences: (text) => state.settings.savePreferences(text),
      searchProvider: () => state.settings.searchProvider,
      searchMode: () => state.settings.searchMode,
      searchKey: () => state.settings.searchKey,
      log: (event, fields) => {
        void state.diagnostics.write(event, fields);
      },
    },
  });
  const saved = (await readText(path.join(state.home, "target.json"))) ?? "";
  let notice = state.settings.notices.join("\n");
  if (saved) {
    try {
      const target = parseTarget(JSON.parse(saved));
      // 启动自愈：上次进程崩溃遗留的作品占用登记在恢复最近项目前清理掉。
      const reclaimed = await cleanStaleWorkspaceClaim(await lockRoot(state, target));
      if (reclaimed.kind === "cleaned")
        await state.diagnostics.write(
          "workspace_claim_cleaned",
          reclaimed.owner
            ? { pid: reclaimed.owner.pid, host: reclaimed.owner.host, at: reclaimed.owner.at }
            : { legacy: true },
        );
      await selectTarget(state, target);
    } catch (error) {
      notice = [notice, "最近项目恢复未完成，请重新选择目录：" + String(error)]
        .filter(Boolean)
        .join("\n");
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
  registerQuitCleanup(state);
  app.on("window-all-closed", () => app.quit());
}
