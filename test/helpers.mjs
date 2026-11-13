// 工具与路由测试直接调用桌面使用的公共业务入口。
import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const BUILD = path.join(ROOT, "build");
export const buildUrl = (rel) => pathToFileURL(path.join(BUILD, rel)).href;
const SKILL = path.join(ROOT, "packages", "toutiao", "skill");
export const FIX = path.join(SKILL, "tests", "fixtures");

export async function tempDir(prefix = "writer-") {
  return mkdtemp(path.join(tmpdir(), prefix));
}

export async function createToolHarness({ mode, role = "writer", cwd, config = {}, confirm } = {}) {
  const { createGateEngine } = await import(buildUrl("core/src/gates.js"));
  const { executeTool } = await import(buildUrl("core/src/execute.js"));
  const { withPluginConfig } = await import(buildUrl("fanqie/src/engine/tools/context.js"));
  const approvals = [];
  let definitions, rules;
  if (mode === "toutiao") {
    const { createToutiaoTools } = await import(buildUrl("toutiao/src/tools.js"));
    const { toutiaoGateRules } = await import(buildUrl("toutiao/src/gates.js"));
    rules = toutiaoGateRules(config);
    const gates = createGateEngine(rules);
    definitions = await createToutiaoTools({ config, role, gates: () => gates });
    return harness(gates);
  }
  if (mode !== "fanqie") throw new Error(`unknown mode ${mode}`);
  const { createFanqieTools } = await import(buildUrl("fanqie/src/tools.js"));
  const { engineTools } = await import(buildUrl("fanqie/src/engine/bootstrap.js"));
  const { fanqieGateRules } = await import(buildUrl("fanqie/src/gates.js"));
  const gates = createGateEngine(fanqieGateRules(config, role));
  definitions = [...engineTools(config, gates, role), ...createFanqieTools({ config, role })];
  return harness(gates);

  function harness(gates) {
    const tools = new Map(definitions.map((tool) => [tool.name, tool]));
    const result = {
      mode,
      role,
      cwd,
      config,
      tools,
      gates,
      approvals,
      approved: true,
      execute,
      call,
    };
    async function execute(name, args = {}) {
      const definition = tools.get(name);
      if (!definition) throw new Error(`unknown tool ${name}`);
      return executeTool(
        definition,
        args,
        {
          cwd,
          role,
          name,
          arguments: args,
          sessionId: cwd + ":" + role,
          token: Symbol(name),
          signal: new AbortController().signal,
        },
        {
          gates,
          bind: (run) => withPluginConfig(config, run),
          confirm: async (reason, signal) => {
            approvals.push({ name, reason });
            return confirm ? confirm(reason, signal) : result.approved;
          },
        },
      );
    }
    async function call(name, args = {}) {
      if (!tools.has(name)) throw new Error(`unknown tool ${name}`);
      // Mirrors the desktop session layer, which injects the basis it last read into every
      // toutiao_draft_stage (A-05 makes the basis mandatory once a draft exists).
      if (
        name === "toutiao_draft_stage" &&
        args.expected_rev === undefined &&
        tools.has("toutiao_draft_get")
      )
        try {
          const current = (await execute("toutiao_draft_get", { id: args.id })).value;
          args = {
            ...args,
            expected_rev: current.rev,
            expected_sha256: current.record?.sha256 ?? "",
          };
        } catch (error) {
          if (error.code !== "NOT_FOUND") throw error;
        }
      try {
        return (await execute(name, args)).value;
      } catch (error) {
        // executeTool stops a call before it runs with a gate deny (reason marked 【门禁 …】),
        // a gate error or the author's refusal; a tool's own business failure keeps its code.
        if (
          !error.code ||
          error.code === "CANCELLED" ||
          error.code === "GATE_ERROR" ||
          (error.code === "GATE_DENIED" && error.message.startsWith("【门禁"))
        )
          return { denied: true, code: error.code, reason: error.message };
        return { ok: false, code: error.code, message: error.message };
      }
    }
    return result;
  }
}

export async function createCommandHarness(config = {}) {
  const { commandPolicy } = await import(buildUrl("workbench/src/commands.js"));
  const { profileRoutes } = await import(buildUrl("workbench/src/profile-api.js"));
  const { toutiaoLibrary } = await import(buildUrl("toutiao/src/methods.js"));
  const { fanqieLibrary } = await import(buildUrl("fanqie/src/forge.js"));
  const { isToutiaoCommand, runToutiaoCommand } = await import(
    buildUrl("toutiao/src/workbench/api.js")
  );
  const { fanqieApi } = await import(buildUrl("fanqie/src/workbench/api.js"));
  const handlers = [
    fanqieApi(config.fanqie || {}),
    profileRoutes("/toutiao", toutiaoLibrary, () => config.toutiao?.profile),
    profileRoutes("/fanqie", fanqieLibrary, () => config.fanqie?.profile),
  ];
  return async (command, { kind = "read", input = {} } = {}) => {
    const policy = commandPolicy(command);
    if (!policy) return { ok: false, code: "NOT_FOUND" };
    if (policy.kind !== "both" && policy.kind !== kind)
      return { ok: false, code: "invalid_command" };
    if (isToutiaoCommand(command))
      return (await runToutiaoCommand(command, input, config.toutiao || {}, true)).data;
    let result = { ok: false, code: "NOT_FOUND" };
    const ctx = {
      command,
      kind,
      input,
      reply: (data) => {
        result = data;
      },
    };
    for (const handler of handlers) if (await handler.handle(ctx)) break;
    return result;
  };
}
