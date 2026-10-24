/**
 * dsh-zhizhang smoke — dist 加载面冒烟（功能面由 npm test 与 npm run e2e 覆盖）。
 *
 *   npm run smoke        (or: node scripts/smoke.mjs)
 *
 * 只验发行产物本身：dist 可加载、51 工具注册、触发器按需挂载模型、
 * 面板 HTTP 可服务、版本与 package.json 一致。功能链路不再在此重复。
 */
import assert from "node:assert/strict";
import http from "node:http";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const pkgRoot = path.resolve(here, "..");
const root = await mkdtemp(path.join(tmpdir(), "zz-smoke-"));
delete process.env.DSH_ZHIZHANG_ROOT;
process.env.DSH_HOME = path.join(root, ".dsh");

try {
  const pkg = JSON.parse(await readFile(path.join(pkgRoot, "package.json"), "utf8"));
  const plugin = await import(pathToFileURL(path.join(pkgRoot, "dist/index.js")).href);

  // —— 工具面 ——
  const tools = plugin.__testing.tools;
  assert.equal(tools.length, 51, "expected 51 tools");
  assert.equal(new Set(tools.map((t) => t.name)).size, 51, "tool names must be unique");
  for (const tool of tools) {
    assert.match(tool.name, /^zhizhang_/, `${tool.name} must use the zhizhang_ prefix`);
    assert.equal(tool.parameters.type, "object");
    assert.equal(typeof tool.execute, "function");
  }

  // —— 按需挂载模型 ——
  const shell = [];
  const shellSections = [];
  plugin.apply({
    tools: { register: (t) => shell.push(t) },
    get: () => ({ section: (s) => { shellSections.push(s); return () => {}; } }),
  }, {});
  assert.equal(shell.length, 1, "profile mount must register only the trigger");
  assert.equal(shell[0].name, "zhizhang_enable");
  assert.equal(shellSections.length, 0, "profile mount must not inject the hard-rules section");

  const applied = [];
  const sections = [];
  const agentCtx = {
    tools: { register: (t) => applied.push(t) },
    get: () => ({ section: (s) => { sections.push(s); return () => {}; } }),
  };
  const exec = { agent: { ctx: agentCtx, session: { id: "smoke", header: { cwd: root } } } };
  const enableOut = await shell[0].execute({}, exec);
  assert.match(enableOut, /已启用织章/);
  assert.equal(applied.length, tools.length, "trigger must mount every tool");
  assert.equal(sections.length, 1, "trigger must mount the hard-rules section");
  assert.match(sections[0].text(), /织章/);

  // —— 面板 HTTP 可服务（dist 产物 + 版本一致）——
  const { createPanelApiHandler } = await import(pathToFileURL(path.join(pkgRoot, "dist/lib/http-api.js")).href);
  const server = http.createServer(createPanelApiHandler({ storageRoot: path.join(root, ".zhizhang") }));
  await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address();
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/dsh-zhizhang/health`);
    const health = await res.json();
    assert.equal(res.status, 200);
    assert.equal(health.ok, true);
    assert.equal(health.version, pkg.version, "health version must match package.json");
    assert.equal(health.toolCount, tools.length, "health must report the runtime tool count");
  } finally {
    await new Promise((resolve) => server.close(resolve));
  }

  // —— 客户端资源随包 ——
  await assert.doesNotReject(() => readFile(path.join(pkgRoot, "dist/client.js"), "utf8"), "dist/client.js ships");

  console.log(`smoke OK · dist loads · ${tools.length} tools · on-demand mount · panel serves`);
} finally {
  await rm(root, { recursive: true, force: true });
}
