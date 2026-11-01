import path from "node:path";
import { access, mkdir, readFile, writeFile } from "node:fs/promises";
import type { Target } from "../context";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  runtimeModel,
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
import type { HostToolDefinition } from "../../../../packages/host/src/index";
import { roleAllows } from "./roles";
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
  const editor = role === "editor",
    primary = role === "writer";
  const target = { ...targetInput };
  const key = host.key(target);
  if (primary && host.sessions.has(key)) return host.sessions.get(key)!.session;
  const dir = path.join(host.home, "sessions", key);
  await mkdir(dir, { recursive: true });
  let manager = SessionManager.inMemory(target.root);
  if (primary) {
    const marker = await readFile(path.join(dir, "current"), "utf8").catch(() => "");
    manager =
      marker &&
      (await access(marker).then(
        () => true,
        () => false,
      ))
        ? SessionManager.open(marker)
        : SessionManager.create(target.root, dir);
  }
  const businessRole = editor ? "editor" : "writer";
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
    target.mode === "toutiao"
      ? toutiaoGateRules(config)
      : fanqieGateRules(config, businessRole),
    { requireApproval: true },
  );
  let definitions: HostToolDefinition[] =
    target.mode === "toutiao"
      ? createToutiaoTools({ config, role: businessRole, gates: () => gates })
      : [...engineTools(config, gates), ...createFanqieTools({ config, role: businessRole })];
  definitions = definitions.filter((tool) => roleAllows(role, tool.name, target.mode));
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
      primary,
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
  customTools.push(...createSourceTools({ host, target, readUrls }));
  const loader = new DefaultResourceLoader({
    cwd: target.root,
    agentDir: path.join(host.home, "agent"),
    noExtensions: true,
    noSkills: true,
    noPromptTemplates: true,
    systemPromptOverride: () => systemPrompt(target, role),
    appendSystemPromptOverride: () => [],
  });
  await loader.reload();
  const models = host.settings();
  const settings = (
    role === "planner" ? models.planner || models.writer : models[role]
  )!;
  if (!settings.apiKey)
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
    thinkingLevel: settings.reasoning ? settings.thinkingLevel : "off",
    resourceLoader: loader,
    sessionManager: manager,
    tools: customTools.map((t) => t.name),
    customTools,
  }));
  session.agent.toolExecution = "sequential";
  entry = { session, target, focus: {}, phase: "", task };
  trackSession({
    host,
    entry,
    session,
    manager,
    target,
    primary,
    editor,
    role,
    onUserMessage: () => readUrls.clear(),
  });
  if (primary) {
    host.sessions.set(key, entry);
    await writeFile(path.join(dir, "current"), manager.getSessionFile()!, "utf8");
  }
  return session;
}
