import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { FIX, ROOT, tempDir, buildUrl } from "./helpers.mjs";

const { resolveInside, serialize, atomicWrite, readJson } = await import(
  buildUrl("core/src/fsx.js")
);
const { parseContract, locatePython, runScript } = await import(buildUrl("core/src/runner.js"));
const { createGateEngine } = await import(buildUrl("core/src/gates.js"));
const { checkCard } = await import(buildUrl("toutiao/src/card.js"));
const { loadLimits } = await import(buildUrl("toutiao/src/rule-limits.js"));
const { titleMax } = await loadLimits();
const { ArticleStore, canTransition } = await import(buildUrl("toutiao/src/store.js"));

async function guardFixture(t) {
  const root = await tempDir("writer-guard-");
  t.after(() => rm(root, { recursive: true, force: true }));
  const write = async (file, source) => {
    const target = path.join(root, file);
    await mkdir(path.dirname(target), { recursive: true });
    await writeFile(target, source);
  };
  for (const pkg of ["ui", "core", "workbench", "toutiao", "fanqie"])
    await mkdir(path.join(root, "packages", pkg, "src"), { recursive: true });
  for (const dir of ["apps/desktop/src/styles", "packages/workbench/src/client/styles"])
    await mkdir(path.join(root, dir), { recursive: true });
  for (const file of ["package.json", "apps/desktop/package.json", "packages/unused/package.json"])
    await write(file, '{"version":"0.9.7"}');
  await write("packages/core/src/version.ts", 'export const VERSION = "0.9.7";');
  await write("CHANGELOG.md", "## 0.9.7\n");
  await write("scripts/any-baseline.json", '{"any":0}');
  const run = (strict = true) =>
    spawnSync(
      process.execPath,
      [
        path.join(ROOT, "scripts/architecture-guard.mjs"),
        "--root",
        root,
        ...(strict ? ["--strict"] : []),
      ],
      { encoding: "utf8" },
    );
  assert.equal(run().status, 0, "合法仓库必须通过严格模式");
  return { write, run };
}

test("守卫：普通字符串调用不能绕过宿主边界", async (t) => {
  const { write, run } = await guardFixture(t);
  await write(
    "packages/workbench/src/client/example.jsx",
    'loadModule("' + ["@deepseek", "-ai/retired"].join("") + '")',
  );
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /禁止引用已退役的宿主包/);
});

test("守卫：any 不能超过基线，类型断言和注解均计数", async (t) => {
  const { write, run } = await guardFixture(t);
  await write(
    "packages/core/src/example.ts",
    "const a: any = 1; const b = a as any; const c = <any>a;",
  );
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /any 数量 3 超过基线 0/);
});

test("守卫：组件前缀不能跨样式文件", async (t) => {
  const { write, run } = await guardFixture(t);
  await write("packages/ui/src/modal.css", ".wb-modal-head { display: flex; }");
  await write(
    "packages/ui/src/overlay.css",
    "@media (min-width: 1em) { .wb-modal-body { display: block; } }",
  );
  assert.equal(run(false).status, 1);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /组件前缀 wb-modal 必须唯一/);
});

test("守卫：空 catch 和字面量回退须说明原因，认识 ENOENT 的分支不误报", async (t) => {
  const { write, run } = await guardFixture(t);
  const cases = [
    "try {} catch {}",
    "try {} catch (e) {}",
    "try {} catch { return []; }",
    "promise.catch(() => undefined)",
    "promise.catch(() => {})",
    'promise.catch(() => "")',
    "promise.catch(() => ({}))",
    "promise.catch(() => { return false; })",
  ];
  for (const source of cases) {
    await write("packages/core/src/example.js", `async function example() { ${source} }`);
    const result = run();
    assert.equal(result.status, 1, source);
    assert.match(result.stdout, /吞错=1/);
  }
  await write(
    "packages/core/src/example.js",
    'try {} catch (error) { if (error.code === "ENOENT") return []; throw error; }',
  );
  assert.equal(run().status, 0);
  for (const source of [
    "// allow-catch: 进程退出时尽力清理\npromise.catch(() => {})",
    "try {} catch {} // allow-catch: 进程退出时尽力清理",
  ]) {
    await write("packages/core/src/example.js", source);
    assert.equal(run().status, 0);
  }
});

test("守卫：history 目录在严格模式失败，CSS 长度只提示且文档数量不设限", async (t) => {
  const { write, run } = await guardFixture(t);
  await write("packages/ui/src/long.css", "\n".repeat(301));
  for (let i = 0; i < 11; i++) await write(`docs/guide-${i}.md`, "guide");
  assert.equal(run().status, 0);
  await write("docs/history/old.md", "old");
  assert.equal(run(false).status, 0);
  const result = run();
  assert.equal(result.status, 1);
  assert.match(result.stderr, /docs\/history\/ 目录不得存在/);
});

test("resolveInside 拒绝越界", () => {
  assert.equal(resolveInside("/a/b", "c"), path.resolve("/a/b/c"));
  assert.throws(() => resolveInside("/a/b", "../c"), /越界/);
  assert.throws(() => resolveInside("/a/b", "/etc/passwd"), /越界/);
});

test("serialize 串行化同 key 的读改写", async () => {
  const dir = await tempDir();
  const f = path.join(dir, "n.json");
  await atomicWrite(f, '{"n":0}');
  await Promise.all(
    Array.from({ length: 30 }, () =>
      serialize(f, async () => {
        const v = await readJson(f);
        await new Promise((r) => setTimeout(r, 1));
        await atomicWrite(f, JSON.stringify({ n: v.n + 1 }));
      }),
    ),
  );
  assert.equal((await readJson(f)).n, 30);
});

test("脚本契约：非 JSON、缺字段、非零退出码都判失败", () => {
  assert.throws(() => parseContract("综合 90 分", "", 0), /不是合法 JSON/);
  assert.throws(() => parseContract('{"ok":true}', "", 0), /契约字段/);
  assert.throws(
    () => parseContract('{"tool":"qa","rules_version":"4","ok":true}', "boom", 1),
    /退出码 1/,
  );
  assert.equal(parseContract('{"tool":"qa","rules_version":"4","ok":true}', "", 0).ok, true);
});

test("运行器：超时", async () => {
  const py = await locatePython();
  const dir = await tempDir();
  const f = path.join(dir, "s.py");
  await atomicWrite(f, "import time\ntime.sleep(5)\n");
  await assert.rejects(runScript(py, f, [], { timeoutMs: 300 }), /超时/);
});

test("门禁引擎：deny 优先；ask 记录 token，只能消费一次；锁定规则不能关", async () => {
  const rules = [
    {
      id: "a",
      tool: "t",
      locked: true,
      description: "",
      check: (a) => (a.x === 1 ? { kind: "deny", reason: "no" } : undefined),
    },
    {
      id: "b",
      tool: "t",
      locked: false,
      description: "",
      check: () => ({ kind: "ask", reason: "sure?" }),
    },
  ];
  const e = createGateEngine(rules, { disabled: ["a"] });
  assert.equal(e.isActive("a"), true, "锁定规则不能被关闭");
  const tok = Symbol();
  assert.equal((await e.evaluate({ name: "t", arguments: { x: 1 }, token: tok })).kind, "deny");
  const d = await e.evaluate({ name: "t", arguments: {}, token: tok });
  assert.equal(d.kind, "ask");
  assert.equal(e.consumeConfirmation({ name: "t", arguments: {}, token: tok }, "b"), true);
  assert.equal(e.consumeConfirmation({ name: "t", arguments: {}, token: tok }, "b"), false);
  assert.equal(await e.evaluate({ name: "other", arguments: {} }), undefined);
  const e2 = createGateEngine(rules, { disabled: ["b"] });
  assert.equal(e2.isActive("b"), false);
  const boom = createGateEngine([
    {
      id: "c",
      tool: "t",
      locked: true,
      description: "",
      check: () => {
        throw new Error("x");
      },
    },
  ]);
  assert.equal(
    (await boom.evaluate({ name: "t", arguments: {} })).kind,
    "deny",
    "门禁出错按拒绝处理",
  );
});

test("立项卡预检：样例卡通过，模板卡报占位，故事线缺字段报错", async () => {
  const card = JSON.parse(await readFile(path.join(FIX, "story_long_card.json"), "utf8"));
  assert.deepEqual(
    checkCard(card, titleMax).filter((i) => i.level === "fail"),
    [],
  );
  const bad = { ...card, 母题: "", 主标题: "一".repeat(35), 备注: "{name}" };
  const issues = checkCard(bad, titleMax).map((i) => i.field);
  assert.ok(issues.includes("母题"));
  assert.ok(issues.includes("主标题"));
  assert.ok(issues.includes("备注"));
});

test("状态机", () => {
  assert.equal(canTransition("初稿待改", "已验收"), false);
  assert.equal(canTransition("待验收", "已验收"), true);
  assert.equal(canTransition("已验收", "已交稿"), true);
  assert.equal(canTransition("已交稿", "初稿待改"), false);
});

test("稿件只增不改，哈希记录", async () => {
  const s = new ArticleStore(await tempDir());
  const m = await s.create("a", { date: "2026-10-28" });
  await s.stageDraft(m.id, "# t\n一", "writer", "");
  const m2 = await s.stageDraft(m.id, "# t\n二", "editor", "");
  assert.equal(m2.current_rev, 2);
  assert.equal(await s.readDraft(m.id, 1), "# t\n一");
  assert.notEqual(m2.drafts[0].sha256, m2.drafts[1].sha256);
  const basis = { rev: 2, sha256: m2.drafts[1].sha256 };
  await s.stageDraft(m.id, "# t\n作者修改", "author", "", basis);
  await assert.rejects(s.stageDraft(m.id, "# t\n旧依据", "author", "", basis), /文章已变化/);
  assert.equal((await s.get(m.id)).current_rev, 3);
  await assert.rejects(s.create("a", { date: "2026-10-28" }), /已存在/);
  const { writeFile } = await import("node:fs/promises");
  await writeFile(s.metaPath(m.id), "{broken");
  await assert.rejects(s.list(), /损坏/);
  const issues = [];
  assert.deepEqual(await s.list(issues), []);
  assert.equal(issues[0].id, m.id);
});

test("守卫：JSX 文案从共享文案表读取", async (t) => {
  const { write, run } = await guardFixture(t);
  await write(
    "packages/workbench/src/client/example.jsx",
    "export const View=()=> <button>中文文案</button>",
  );
  const result = run(false);
  assert.equal(result.status, 1);
  assert.match(result.stderr, /JSX 中文文案/);
  await write(
    "packages/workbench/src/client/example.jsx",
    "export const View=({copy})=> <button>{copy.title}</button>",
  );
  assert.equal(run(false).status, 0);
});
