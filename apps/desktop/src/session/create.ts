import { workflowTools } from "../workflow/tools";
import { DEFAULT_CONTEXT, compactionSettings } from "../context-settings";
import path from "node:path";
import { mkdir } from "node:fs/promises";
import { atomicWrite, exists, readText } from "../../../../packages/core/src/fsx";
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
import { createToutiaoTools } from "../../../../packages/toutiao/src/tools";
import { toutiaoGateRules } from "../../../../packages/toutiao/src/gates";
import { createFanqieTools } from "../../../../packages/fanqie/src/tools";
import { engineTools } from "../../../../packages/fanqie/src/engine/bootstrap";
import { fanqieGateRules } from "../../../../packages/fanqie/src/gates";
import { listProjects, projectIdOf } from "../../../../packages/fanqie/src/engine/work-store";
import { createGateEngine } from "../../../../packages/core/src/gates";
import type { ToolDefinition as WriterToolDefinition } from "../../../../packages/core/src/tool";
import { systemPrompt } from "./prompt";
import { createBusinessTools, createRememberTool } from "./tools";
import { createDelegateTools } from "./editor-task";
import { createDrawTools } from "./draw-task";
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

/** 抽卡起草子会话：写手角色与工具面，但内存档、不注册主会话、不向作者界面转发事件，
 * 系统提示附“只起草不采纳”约束（writer_draw 的并发起草路，经 createDraft 注入 draw-task）。 */
function createDraftSession(
  host: Sessions,
  targetInput: Target,
  constraint: string,
): Promise<AgentSession> {
  return startSession(host, targetInput, "writer", { primary: false, constraint });
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
  const guided = primary && host.extras.engine?.().guided === true;
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
    { requireApproval: true },
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
          guided &&
          ![
            "fanqie_project_create",
            "toutiao_article_create",
            "fanqie_chapter_read",
            "fanqie_chapter_list",
            "fanqie_foundation_get",
            "toutiao_article_get",
            "toutiao_draft_get",
            "toutiao_ledger_show",
          ].includes(tool.name)
        )
          return false;
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
        return (
          host.options.fanqie?.multiDraft?.enabled === true ||
          !["fanqie_candidate_unify_brief", "fanqie_candidate_unify_stage"].includes(tool.name)
        );
      }),
      readUrls,
      getEntry,
      onCreated,
      onSaved,
    }),
  ];
  if (primary && !guided) {
    customTools.push(...createDelegateTools({ host, target, manager, getEntry, getSession }));
    if (host.options[target.mode]?.draw?.enabled === true)
      customTools.push(
        ...createDrawTools({
          host,
          target,
          getEntry,
          getSession,
          drawMax: host.options.fanqie?.draw?.max ?? 3,
          toutiaoDrawMax: host.options.toutiao?.draw?.max,
          createDraft: (constraint) => createDraftSession(host, target, constraint),
        }),
      );
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
  if (guided) customTools.push(...workflowTools(host, target, getSession));
  if (!guided)
    customTools.push(...createSourceTools({ host, target, readUrls, taskId: () => task.id }));
  if (guided && customTools.length > 12) throw new Error("调度员工具面超过12项，拒绝启动");
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
    (guided
      ? "你是作者的对话入口和流水线调度员。尚无作品时先按作者提供的题名创建作品或文章，再启动流水线。理解作者要求；执行任务时使用 writer_pipeline_start，代码负责方法、上下文、起稿、择优与审读。先确认当前作品和任务范围，缺少关键事实时问作者。不要承诺工具尚未完成的保存；不替作者采纳或定稿；不循环轮询进度。普通交流直接回答，不为聊天启动模型流水线。"
      : await systemPrompt(target, role, config)) +
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
  if (primary)
    session.subscribe((event) => {
      if (event.type === "agent_settled") void host.proactiveCompact(target);
    });
  if (primary) {
    host.sessions.set(key, entry);
    await atomicWrite(path.join(dir, "current"), sessionFilePath(manager));
  }
  return session;
}
