import path from "node:path";
import { dialog, shell } from "electron";
import { mkdir } from "node:fs/promises";
import { atomicWrite } from "../../../../../packages/core/src/fsx";
import type { Runtime } from "../runtime";
import { selectTarget } from "../targets";
import { handle } from "./handle";
import { parseMode } from "./validate";
import { listProjects } from "../../../../../packages/fanqie/src/engine/work-store";
import { listArticles } from "../../../../../packages/toutiao/src/workbench/data";
import { setProfilesRoot } from "../../../../../packages/core/src/profiles";
import { VERSION } from "../../../../../packages/core/src/version";
import type { ProjectItem, RendererState } from "./contract";

export function registerWorkspaceIpc(state: Runtime) {
  handle(
    "state",
    (): RendererState => ({
      target: state.target,
      notice: state.notice,
      access: state.access,
      ...state.settings.public(),
      version: VERSION,
      updates: state.updateState,
    }),
  );
  handle("choose", async (value) => {
    const mode = parseMode(value);
    const result = await dialog.showOpenDialog(state.window!, {
      title:
        mode === "fanqie"
          ? "选择长篇数据根（包含 works，或空目录）"
          : "选择头条文章目录",
      properties: ["openDirectory", "createDirectory"],
    });
    return result.canceled ? null : selectTarget(state, { mode, root: result.filePaths[0] });
  });
  handle("workspace", async () => {
    const result = await dialog.showOpenDialog(state.window!, {
      title: "选择统一写作根",
      properties: ["openDirectory", "createDirectory"],
    });
    if (result.canceled) return null;
    await state.settings.saveUI({ workspace: result.filePaths[0] });
    await Promise.all([
      mkdir(path.join(state.settings.workspace, "novels"), { recursive: true }),
      mkdir(path.join(state.settings.workspace, "toutiao"), { recursive: true }),
    ]);
    const chosen = await selectTarget(state, {
      mode: "fanqie",
      root: path.join(state.settings.workspace, ".writer"),
    });
    return { target: chosen, ...state.settings.public() };
  });
  handle("projects", async () => {
    const projects = await listProjects({ refresh: true }),
      articles = await listArticles(),
      items: ProjectItem[] = [];
    for (const project of projects)
      for (const work of project.works || [])
        items.push({
          label: work.title,
          target: { mode: "fanqie", root: project.base, work: work.key },
          focus: { workTitle: work.title },
        });
    for (const article of articles.articles)
      items.push({
        label: String(article.title),
        target: { mode: "toutiao", root: String(article.root) },
        focus: {
          article: String(article.id),
          title: String(article.title),
          source: "article",
        },
      });
    return items;
  });
  handle("new-target", async (value) => {
    const mode = parseMode(value);
    if (!state.settings.workspace) throw new Error("请先选择统一写作根");
    return selectTarget(state, {
      mode,
      root: path.join(state.settings.workspace, mode === "fanqie" ? ".writer" : "toutiao"),
    });
  });
  handle("profiles", async () => {
    const result = await dialog.showOpenDialog(state.window!, {
      title: "选择用户方法方案根目录",
      properties: ["openDirectory", "createDirectory"],
    });
    if (!result.canceled) {
      setProfilesRoot(result.filePaths[0]);
      await atomicWrite(path.join(state.home, "profiles-directory"), result.filePaths[0]);
      state.emit({ refresh: true });
    }
    return !result.canceled;
  });
  handle("external", (value) => {
    const parsed = new URL(String(value));
    if (!["http:", "https:"].includes(parsed.protocol))
      throw new Error("只支持公开网页链接");
    return shell.openExternal(parsed.href);
  });
}
