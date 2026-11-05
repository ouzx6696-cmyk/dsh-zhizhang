import { DEFAULT_CONTEXT, compactionSettings } from "../context-settings";
import path from "node:path";
import { access, mkdir, readFile } from "node:fs/promises";
import { atomicWrite } from "../../../../packages/core/src/fsx";
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
import { createBusinessTools } from "./tools";
import { createDelegateTools } from "./editor-task";
import { createSourceTools } from "./sources";
import { createTask, trackSession } from "./task-tracker";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";

export async function createSession(
  host: Sessions,
  targetInput: Target,
  role: "writer" | "editor" | "planner",
  onCreated?: (work: string) => Promise<void>,
  onSaved?: (tool: string, output: string) => void,
): Promise<AgentSession> {
  const primary = role === "writer";
  const target = { ...targetInput };
  const key = host.key(target);
  const dir = await host.directory(target);
  await mkdir(dir, { recursive: true });
  let manager = SessionManager.inMemory(target.root);
  if (primary) {
    const marker = await readFile(path.join(dir, "current"), "utf8").catch((error) => {
      if (error.code === "ENOENT") return "";
      throw error;
    });
    manager =
      marker &&
      (await access(marker).then(
        () => true,
        (error) => {
          if (error.code === "ENOENT") return false;
          throw error;
        },
      ))
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
      : [
          ...engineTools(config, gates, "throw", role),
          ...createFanqieTools({ config, role: role }),
        ];
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
      definitions,
      readUrls,
      getEntry,
      onCreated,
      onSaved,
    }),
  ];
  if (primary)
    customTools.push(...createDelegateTools({ host, target, manager, getEntry, getSession }));
  customTools.push(...createSourceTools({ host, target, readUrls, taskId: () => task.id }));
  const models = host.settings();
  const settings = role === "planner" ? models.planner ?? models.writer : models[role];
  const settingsManager = SettingsManager.inMemory({
    compaction: compactionSettings(host.extras.context?.() ?? DEFAULT_CONTEXT, settings.contextWindow, settings.maxTokens),
    retry: { enabled: true },
    cacheWarming: "streaming",
  });
  const prompt = await systemPrompt(target, role, config);
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
  trackSession({
    host,
    entry,
    role,
    onUserMessage: () => readUrls.clear(),
  });
  if (primary) {
    host.sessions.set(key, entry);
    await atomicWrite(path.join(dir, "current"), manager.getSessionFile()!);
  }
  return session;
}
