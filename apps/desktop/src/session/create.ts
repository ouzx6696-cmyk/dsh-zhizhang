import { DEFAULT_CONTEXT, compactionSettings } from "../context-settings";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWrite, exists, readText } from "@zhizhang/core";
import type { Target } from "../context";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  SettingsManager,
  runtimeModel,
  clampThinkingLevel,
  type AgentSession,
  type ToolDefinition,
} from "./pi-adapter";
import { createToutiaoTools } from "@zhizhang/toutiao";
import { toutiaoGateRules } from "@zhizhang/toutiao";
import { createFanqieTools } from "@zhizhang/fanqie";
import { engineTools } from "@zhizhang/fanqie";
import { fanqieGateRules } from "@zhizhang/fanqie";
import { listProjects, projectIdOf } from "@zhizhang/fanqie";
import { createGateEngine } from "@zhizhang/core";
import type { ToolDefinition as WriterToolDefinition } from "@zhizhang/core";
import { systemPrompt } from "./prompt";
import { createBusinessTools, createRememberTool } from "./tools";
import { createDelegateTools } from "./editor-task";
import { createLearnTools } from "./learn-task";
import { createSourceTools } from "./sources";
import { createTask, trackSession } from "./task-tracker";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";

/** 会话文件路径：persist 模式的 SessionManager 在构造时就分配好路径（首条消息才落盘）。
 * SDK 类型标为可缺省，真缺了说明 SDK 行为变了，如实报错而不是写坏 "current" 指针。 */
export function sessionFilePath(manager: SessionManager): string {
  const file = manager.getSessionFile();
  if (file === undefined) throw new Error("会话文件路径尚未分配，无法写入会话指针");
  return file;
}

export async function createSession(
  host: Sessions,
  targetInput: Target,
  role: "writer" | "editor" | "planner",
  onCreated?: (work: string) => Promise<void>,
  onSaved?: (tool: string, output: string) => void,
): Promise<AgentSession> {
  return startSession(host, targetInput, role, { primary: role === "writer" }, onCreated, onSaved);
}

async function startSession(
  host: Sessions,
  targetInput: Target,
  role: "writer" | "editor" | "planner",
  options: { primary: boolean; constraint?: string },
  onCreated?: (work: string) => Promise<void>,
  onSaved?: (tool: string, output: string) => void,
): Promise<AgentSession> {
  const primary = options.primary;
  const target = { ...targetInput };
  const key = host.key(target);
  const dir = await host.directory(target);
  await mkdir(dir, { recursive: true });
  let manager = SessionManager.inMemory(target.root);
  if (primary) {
    const marker = (await readText(path.join(dir, "current"))) ?? "";
    manager =
      marker && (await exists(marker))
        ? SessionManager.open(marker)
        : SessionManager.create(target.root, dir);
  }

  const project =
    target.mode === "fanqie"
      ? (await listProjects()).find((p) => p.id === projectIdOf(target.root))
      : undefined;
  const config = {
    ...host.options[target.mode],
    storageRoot: target.root,
    ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
    python: host.python,
  };
  const gates = createGateEngine(
    target.mode === "toutiao" ? toutiaoGateRules(config) : fanqieGateRules(config, role),
  );
  const definitions: WriterToolDefinition[] =
    target.mode === "toutiao"
      ? await createToutiaoTools({ config, role: role, gates: () => gates })
      : [...engineTools(config, gates, role), ...createFanqieTools({ config, role: role })];
  const readUrls = new Set<string>();
  const task = createTask();
  let entry: SessionEntry;
  let session: AgentSession;
  const getEntry = () => entry;
  const getSession = () => session;
  const customTools: ToolDefinition[] = [
    ...createBusinessTools({
      host,
      target,
      role,
      manager,
      gates,
      config,
      definitions: definitions.filter((tool) => {
        if (
          host.options.fanqie?.continuity?.enabled !== true &&
          [
            "fanqie_foreshadow_set",
            "fanqie_knowledge_set",
            "fanqie_continuity_commit",
            "fanqie_continuity_get",
            "fanqie_continuity_migrate",
          ].includes(tool.name)
        )
          return false;
        return !["fanqie_candidate_unify_brief", "fanqie_candidate_unify_stage"].includes(tool.name);
      }),
      readUrls,
      getEntry,
      onCreated,
      onSaved,
    }),
  ];
  if (primary) {
    customTools.push(...createDelegateTools({ host, target, manager, getEntry, getSession }));
  }
  if (primary) {
    if (host.options[target.mode]?.learn?.enabled === true)
      customTools.push(
        ...createLearnTools({
          host,
          target,
          getEntry,
          getSession,
        }),
      );
    const { preferences, savePreferences } = host.extras;
    if (preferences && savePreferences)
      customTools.push(createRememberTool({ read: preferences, save: savePreferences }));
  }
  customTools.push(...createSourceTools({ host, target, readUrls, taskId: () => task.id }));
  const models = host.settings();
  const settings = role === "planner" ? (models.planner ?? models.writer) : models[role];
  const settingsManager = SettingsManager.inMemory({
    compaction: compactionSettings(
      host.extras.context?.() ?? DEFAULT_CONTEXT,
      settings.contextWindow,
      settings.maxTokens,
    ),
    retry: { enabled: true },
    cacheWarming: "streaming",
  });
  const prompt =
    (await systemPrompt(target, role, config)) +
    (options.constraint ? "\n" + options.constraint : "");
  const loader = new DefaultResourceLoader({
    settingsManager,
    noContextFiles: true,
    cwd: target.root,
    agentDir: path.join(host.home, "agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    systemPromptOverride: () => prompt,
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();
  if (!settings.apiKey && !settings.keyless)
    throw new Error(`请先设置${role === "editor" ? "编辑" : "写手"}模型的 API Key`);
  const { runtime, model } = await runtimeModel(
    settings,
    path.join(host.home, "agent", "auth.json"),
    role,
  );
  ({ session } = await createAgentSession({
    cwd: target.root,
    agentDir: path.join(host.home, "agent"),
    modelRuntime: runtime,
    model,
    thinkingLevel: clampThinkingLevel(model, settings.thinkingLevel),
    resourceLoader: loader,
    settingsManager,
    sessionManager: manager,
    tools: customTools.map((t) => t.name),
    customTools,
  }));
  session.agent.toolExecution = "sequential";
  entry = { session, target, focus: {}, phase: "", task, methods: new Map() };
  // 起草子会话（writer 非主会话）不订阅事件：writer_draw 汇总结果，多路草稿流不刷进作者对话。
  if (primary || role !== "writer")
    trackSession({
      host,
      entry,
      role,
      onUserMessage: () => readUrls.clear(),
    });
  if (primary) {
    host.sessions.set(key, entry);
    await atomicWrite(path.join(dir, "current"), sessionFilePath(manager));
  }
  return session;
}
