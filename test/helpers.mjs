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
    const gates = createGateEngine(rules, {
      requireApproval: true,
      disabled: config.disabledGates,
    });
    definitions = await createToutiaoTools({ config, role, gates: () => gates });
    return harness(gates);
  }
  if (mode !== "fanqie") throw new Error(`unknown mode ${mode}`);
  const { createFanqieTools } = await import(buildUrl("fanqie/src/tools.js"));
  const { engineTools } = await import(buildUrl("fanqie/src/engine/bootstrap.js"));
  const { fanqieGateRules } = await import(buildUrl("fanqie/src/gates.js"));
  const gates = createGateEngine(fanqieGateRules(config, role), {
    requireApproval: true,
    disabled: config.disabledGates,
  });
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
      try {
        return (await execute(name, args)).value;
      } catch (error) {
        if (!error.code) return { denied: true, reason: error.message };
        return { ok: false, code: error.code, message: error.message };
      }
    }
    return result;
  }
}

export async function createRouteHarness(config = {}) {
  const { profileRoutes } = await import(buildUrl("workbench/src/profile-api.js"));
  const { toutiaoLibrary } = await import(buildUrl("toutiao/src/methods.js"));
  const { fanqieLibrary } = await import(buildUrl("fanqie/src/forge.js"));
  const { toutiaoApi } = await import(buildUrl("toutiao/src/workbench/api.js"));
  const { fanqieApi } = await import(buildUrl("fanqie/src/workbench/api.js"));
  const handlers = [
    toutiaoApi(config.toutiao || {}, () => true),
    fanqieApi(config.fanqie || {}),
    profileRoutes("/api/writer/toutiao", toutiaoLibrary, () => config.toutiao?.profile),
    profileRoutes("/api/writer/fanqie", fanqieLibrary, () => config.fanqie?.profile),
  ];
  return async (route, { method = "GET", body = {} } = {}) => {
    const url = new URL("/api/writer" + route, "app://writer");
    let response = new Response("{}", { status: 404 });
    const ctx = {
      url,
      method,
      path: url.pathname,
      json: (status, data) => {
        response = new Response(JSON.stringify(data), { status });
      },
      body: async () => body,
    };
    for (const handler of handlers) if (await handler.handle(ctx)) break;
    return response;
  };
}
