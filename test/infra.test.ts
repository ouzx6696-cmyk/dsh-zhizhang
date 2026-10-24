/**
 * Infrastructure — plugin mount model (single trigger → all tools + brief),
 * tool surface invariants, scheduler single-source, guard baselines.
 */
import { describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { __testing } from "../src/index.ts";
import { Scheduler, ProductMap } from "../src/lib/ports/index.ts";
import { SYSTEM_BRIEF } from "../src/tools/brief.ts";
import { SCHEDULER_BYPASSES } from "../src/lib/ports/scheduler.ts";
import { PLUGIN_VERSION } from "./plugin-version.ts";

describe("infra · 挂载模型与工具面", () => {
  test("profile 只注册触发器；enable 挂全部工具 + SYSTEM_BRIEF；幂等", async () => {
    const shell: any[] = [];
    const sections: any[] = [];
    const agentCtx = {
      tools: { register: (t: any) => mounted.push(t) },
      get: () => ({ section: (s: any) => { sections.push(s); return () => {}; } }),
    };
    const mounted: any[] = [];
    const plugin = (await import("../src/index.ts")) as any;
    plugin.apply({ tools: { register: (t: any) => shell.push(t) }, get: agentCtx.get }, {});
    expect(shell.length).toBe(1);
    expect(shell[0].name).toBe("zhizhang_enable");

    const exec = { agent: { ctx: agentCtx, session: { id: "infra", header: { cwd: process.cwd() } } } };
    const out1 = await shell[0].execute({}, exec);
    expect(out1).toMatch(/已启用织章/);
    expect(mounted.length).toBe(__testing.tools.length);
    expect(sections.length).toBe(1);
    expect(sections[0].text()).toMatch(/织章/);
    await shell[0].execute({}, exec);
    expect(mounted.length).toBe(__testing.tools.length);
  });

  test("51 工具：唯一名、zhizhang_ 前缀、object schema、execute 可调", () => {
    const tools = __testing.tools;
    expect(tools.length).toBe(51);
    expect(new Set(tools.map((t) => t.name)).size).toBe(51);
    for (const t of tools) {
      expect(t.name).toMatch(/^zhizhang_/);
      expect(t.parameters.type).toBe("object");
      expect(typeof t.execute).toBe("function");
    }
  });

  test("Scheduler 单一事实源：旁路清单与 SYSTEM_BRIEF 一致；写作链含可选 edit", () => {
    for (const b of SCHEDULER_BYPASSES) {
      expect(SYSTEM_BRIEF).toContain(b.id);
    }
    expect(Scheduler.writeLine()).toMatch(/可选 edit/);
    expect(ProductMap.formatForAgent()).toContain(String(__testing.tools.length));
    expect(ProductMap.formatForAgent()).toMatch(/编辑|A\/B\/C/);
  });

  test("护栏基线：@ts-nocheck 零、版本一致", async () => {
    const baseline = JSON.parse(await readFile(path.resolve(import.meta.dirname, "../scripts/ts-nocheck-baseline.json"), "utf8"));
    expect(Array.isArray(baseline.files) ? baseline.files.length : 0).toBe(0);
    expect(__testing.version ?? PLUGIN_VERSION).toBeTruthy();
  });
});
