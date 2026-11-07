import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { readFile, mkdir, writeFile, rm } from "node:fs/promises";
import { hostname } from "node:os";
import { spawnSync } from "node:child_process";
import { FIX, ROOT, tempDir, buildUrl } from "./helpers.mjs";

const { resolveInside, serialize, atomicWrite, readJson, exists } = await import(
  buildUrl("core/src/fsx.js")
);
const { parseContract, locatePython, runScript } = await import(buildUrl("core/src/runner.js"));
const { createGateEngine } = await import(buildUrl("core/src/gates.js"));
const { checkCard } = await import(buildUrl("toutiao/src/card.js"));
const { loadLimits } = await import(buildUrl("toutiao/src/rule-limits.js"));
const { titleMax } = await loadLimits();
const { ArticleStore, canTransition } = await import(buildUrl("toutiao/src/store.js"));
const { buildMethodPack } = await import(buildUrl("core/src/method-pack.js"));

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
  for (const dir of ["apps/desktop/src/styles", "packages/workbench/src/client/styles", "test"])
    await mkdir(path.join(root, dir), { recursive: true });
  for (const file of ["package.json", "apps/desktop/package.json", "packages/unused/package.json"])
    await write(file, '{"version":"0.9.7"}');
  await write("packages/core/src/version.ts", 'export const VERSION = "0.9.7";');
  await write("CHANGELOG.md", "## 0.9.7\n");
  await write("scripts/any-baseline.json", '{"any":0,"nonNull":0}');
  const run = () =>
    spawnSync(
      process.execPath,
      [path.join(ROOT, "scripts/architecture-guard.mjs"), "--root", root],
      { encoding: "utf8" },
    );
  assert.equal(run().status, 0, "合法仓库必须通过严格模式");
  return { write, run, root };
}

test("架构守卫：一次扫描覆盖依赖、类型、样式、吞错与目录约束", async (t) => {
  const { write, run, root } = await guardFixture(t);
  await write(
    "packages/workbench/src/client/example.jsx",
    'loadModule("' + ["@deepseek", "-ai/retired"].join("") + '")',
  );
  await write(
    "packages/core/src/example.ts",
    "const a: any = 1; const b = a as any; const c = <any>a;",
  );
  await write("packages/ui/src/modal.css", ".wb-modal-head { display: flex; }");
  await write(
    "packages/ui/src/overlay.css",
    "@media (min-width:1em) { .wb-modal-body { display:block; } }",
  );
  const invalid = [
    "try {} catch {}",
    "try {} catch (e) {}",
    "try {} catch { return []; }",
    "promise.catch(() => undefined)",
    "promise.catch(() => {})",
    'promise.catch(() => "")',
    "promise.catch(() => ({}))",
    "promise.catch(() => { return false; })",
  ];
  await write(
    "packages/core/src/catches.js",
    invalid.map((source, i) => `async function check${i}() { ${source} }`).join("\n"),
  );
  await write("scripts/broken.mjs", "promise.catch(() => undefined)");
  await write("test/broken.mjs", "try {} catch {}");
  await write("docs/history/old.md", "old");
  const failed = run();
  assert.equal(failed.status, 1);
  for (const message of [
    /禁止引用已退役的宿主包/,
    /any 数量 3 超过基线 0/,
    /组件前缀 wb-modal 必须唯一/,
    /文档历史目录不得存在/,
  ])
    assert.match(failed.stderr, message);
  assert.match(failed.stdout, /吞错=10/);
  await write("packages/workbench/src/client/example.jsx", "export const value = 1;");
  await write("packages/core/src/example.ts", "const value: number = 1;");
  await write("scripts/broken.mjs", "");
  await write("test/broken.mjs", "");
  await write("packages/ui/src/overlay.css", "");
  await write("packages/ui/src/long.css", "\n".repeat(301));
  await rm(path.join(root, "docs/history"), { recursive: true });
  await write(
    "packages/core/src/catches.js",
    'async function known() { try {} catch (error) { if (error.code === "ENOENT") return []; throw error; } }\n// allow-catch: 进程退出时尽力清理\npromise.catch(() => {})',
  );
  const result = run();
  assert.equal(result.status, 0, result.stderr);
});

test("守卫：浏览器可用模块不能经 fsx 拖入 node:fs", async (t) => {
  const { write, run } = await guardFixture(t);
  await write(
    "packages/workbench/src/routes.ts",
    'import { isMissingFileError } from "../../core/src/fsx.js";\nexport const ok = isMissingFileError;',
  );
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /不能引用 fsx/);
  await write(
    "packages/workbench/src/routes.ts",
    'import { isMissingFileError } from "../../core/src/errors.js";\nexport const ok = isMissingFileError;',
  );
  assert.equal(run().status, 0);
});

test("守卫：格式化把 allow-catch 挪进 catch 块后仍算已注明原因", async (t) => {
  const { write, run } = await guardFixture(t);
  await write(
    "packages/core/src/catches.js",
    "async function f() {\n  try {\n    return await g();\n  } catch (error) {\n    // allow-catch: 单项失败不阻断整批，原因随结果返回。\n    return { error };\n  }\n}",
  );
  assert.equal(run().status, 0);
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

test(
  "atomicWrite：Windows 目标被占用时重试，释放后成功，持续占用如实报错",
  { skip: process.platform !== "win32", timeout: 15000 },
  async (t) => {
    const { open } = await import("node:fs/promises");
    const dir = await tempDir();
    const file = path.join(dir, "稿.md");
    await writeFile(file, "旧稿");
    // Windows 上不带共享删除权限的打开句柄会拒绝 rename 覆盖，模拟杀软、索引器或编辑器的占用。
    const blocker = await open(file, "r");
    let closed = false;
    const release = async () => {
      if (closed) return;
      closed = true;
      await blocker.close();
    };
    t.after(() => release());
    try {
      const started = Date.now();
      await assert.rejects(atomicWrite(file, "持续占用期间的重写"), (error) => {
        assert.equal(error.code, "EPERM");
        return true;
      });
      assert.ok(Date.now() - started >= 2000, "占用期间应重试满 2 秒再报错");
      await release();
      await atomicWrite(file, "句柄释放后的重写");
      assert.equal(await readFile(file, "utf8"), "句柄释放后的重写");
    } finally {
      await release();
    }
  },
);

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

test("R3 文章目录日期取本地日期（跨时区）", () => {
  // 注入固定时刻再调产品入口 today()：同一 UTC 时刻在东九区必须是次日，
  // 若 today() 退化成 UTC 截取则两地都会得 1970-01-01。
  const run = (tz) =>
    spawnSync(
      process.execPath,
      [
        "--input-type=module",
        "-e",
        `const RealDate = Date;
         const fixed = new RealDate("1970-01-01T20:00:00Z").getTime();
         globalThis.Date = class extends RealDate {
           constructor(...args) { super(...(args.length ? args : [fixed])); }
           static now() { return fixed; }
         };
         const { today } = await import(${JSON.stringify(buildUrl("toutiao/src/store.js"))});
         console.log(today());`,
      ],
      { encoding: "utf8", env: { ...process.env, TZ: tz } },
    );
  assert.equal(run("UTC").stdout.trim(), "1970-01-01");
  assert.equal(
    run("Asia/Tokyo").stdout.trim(),
    "1970-01-02",
    "东九区应为次日；UTC 截取会得 1970-01-01",
  );
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

test("作品锁：空或损坏的锁文件报 CONFLICT，不抛裸 SyntaxError", async () => {
  const { claimWorkspace, workspaceAccess } = await import(buildUrl("core/src/workspace-lock.js"));
  const dir = await tempDir("writer-lock-");
  for (const raw of ["", '{"id":"x"}', "[1]"]) {
    await writeFile(path.join(dir, ".writer-workspace-lock.json"), raw);
    await assert.rejects(claimWorkspace(dir), (error) => {
      assert.equal(error.code, "CONFLICT");
      assert.match(error.message, /作品锁文件/);
      return true;
    });
    await assert.rejects(workspaceAccess(dir), { code: "CONFLICT" });
  }
});

test("作品锁：多个进程同时抢锁，只有一个可写，其余读到完整占用者", async () => {
  const dir = await tempDir("writer-lock-race-");
  const lockUrl = buildUrl("core/src/workspace-lock.js");
  const script = `const { claimWorkspace } = await import(${JSON.stringify(lockUrl)});
const access = await claimWorkspace(${JSON.stringify(dir)});
console.log(JSON.stringify({ readOnly: access.readOnly, pid: access.owner?.pid ?? null }));
await new Promise((resolve) => setTimeout(resolve, 1500));`;
  const { spawn } = await import("node:child_process");
  const runs = Array.from(
    { length: 4 },
    () =>
      new Promise((resolve, reject) => {
        const child = spawn(process.execPath, ["--input-type=module", "-e", script]);
        let out = "";
        let err = "";
        child.stdout.on("data", (d) => (out += d));
        child.stderr.on("data", (d) => (err += d));
        child.on("error", reject);
        child.on("close", (code) =>
          code === 0 ? resolve(JSON.parse(out)) : reject(new Error(`exit ${code}: ${err}`)),
        );
      }),
  );
  const results = await Promise.all(runs);
  assert.equal(results.filter((r) => !r.readOnly).length, 1, JSON.stringify(results));
  for (const r of results) assert.equal(typeof r.pid, "number", JSON.stringify(results));
});

test(
  "运行器：脚本忽略 SIGTERM 时超时仍能收尾",
  { skip: process.platform === "win32" },
  async () => {
    const py = await locatePython();
    const dir = await tempDir();
    const f = path.join(dir, "stubborn.py");
    await atomicWrite(
      f,
      "import signal, time\nsignal.signal(signal.SIGTERM, signal.SIG_IGN)\ntime.sleep(30)\n",
    );
    const started = Date.now();
    await assert.rejects(runScript(py, f, [], { timeoutMs: 500 }), /超时/);
    assert.ok(Date.now() - started < 10_000, `超时后 ${Date.now() - started}ms 才返回`);
  },
);

test("方法方案：同一方案并发改名与保存不丢改名，删除后不会被保存写回", async (t) => {
  const profiles = await import(buildUrl("core/src/profiles.js"));
  const { toutiaoLibrary } = await import(buildUrl("toutiao/src/methods.js"));
  profiles.setProfilesRoot(await tempDir("writer-profiles-"));
  t.after(() => profiles.setProfilesRoot(undefined));
  const first = await profiles.createProfile(toutiaoLibrary, { name: "并发一" });
  await Promise.all([
    profiles.renameProfile("toutiao", first.id, "并发改名"),
    profiles.saveMethod(toutiaoLibrary, first.id, "s4-common", "# 覆盖\n"),
  ]);
  assert.equal((await profiles.findProfile("toutiao", "并发改名")).id, first.id);

  const second = await profiles.createProfile(toutiaoLibrary, { name: "并发二" });
  const [removed, saved] = await Promise.allSettled([
    profiles.deleteProfile("toutiao", second.id),
    profiles.saveMethod(toutiaoLibrary, second.id, "s4-common", "# 覆盖\n"),
  ]);
  assert.equal(removed.status, "fulfilled");
  assert.equal(saved.status, "rejected");
  await assert.rejects(profiles.findProfile("toutiao", second.id), { code: "NOT_FOUND" });
});

test("方法方案：新建中途失败留下的目录不被新方案复用", async (t) => {
  const profiles = await import(buildUrl("core/src/profiles.js"));
  const { toutiaoLibrary } = await import(buildUrl("toutiao/src/methods.js"));
  const root = await tempDir("writer-profiles-");
  profiles.setProfilesRoot(root);
  t.after(() => profiles.setProfilesRoot(undefined));
  const orphan = path.join(root, "toutiao", "user-1", "methods");
  await mkdir(orphan, { recursive: true });
  await writeFile(path.join(orphan, "残留.md"), "上次失败留下的");
  const created = await profiles.createProfile(toutiaoLibrary, {});
  assert.equal(created.id, "user-2");
  const detail = await profiles.profileDetail(toutiaoLibrary, created.id);
  assert.ok(!detail.methods.some((m) => m.id === "残留"));
});

test("头条反馈：并发的首批记录全部保留", async () => {
  const { createToolHarness } = await import("./helpers.mjs");
  const h = await createToolHarness({ mode: "toutiao", cwd: await tempDir() });
  const results = await Promise.all(
    ["一", "二", "三"].map((n) =>
      h.call("toutiao_feedback_append", { original: `原${n}`, revised: `改${n}`, motive: n }),
    ),
  );
  for (const r of results) assert.equal(r.ok, true, JSON.stringify(r));
  const read = await h.call("toutiao_feedback_read");
  assert.equal(read.entries, 3, read.text);
});

test("守卫：按语法计 any 与非空断言，字符串里的英文不误报；function 形式的吞错也要注明", async (t) => {
  const { write, run } = await guardFixture(t);
  await write(
    "packages/core/src/copy.ts",
    'export const hint = "Hello! Pick any file"; export const ok = (x?: string) => x !== undefined;',
  );
  assert.equal(run().status, 0, run().stderr);
  await write("packages/core/src/copy.ts", "export const n = (x?: string) => x!.length;");
  assert.match(run().stderr, /非空断言 ! 数量 1 超过基线 0/);
  await write(
    "packages/core/src/copy.ts",
    "export const quiet = (p: Promise<void>) => p.catch(function () {});",
  );
  const swallowed = run();
  assert.equal(swallowed.status, 1);
  assert.match(swallowed.stderr, /吞错须注明/);
});

test("CI 信号终止必须失败；错误立项卡返回参数错误而非 traceback", async () => {
  const { spawnSync } = await import("node:child_process");
  const { mkdtemp, writeFile, rm } = await import("node:fs/promises");
  const { tmpdir } = await import("node:os");
  const dir = await mkdtemp(path.join(tmpdir(), "writer-boundaries-"));
  try {
    const child = path.join(dir, "signal.mjs");
    await writeFile(child, 'process.kill(process.pid, "SIGTERM");');
    const runner = spawnSync(process.execPath, ["scripts/ci-run.mjs", process.execPath, child], {
      encoding: "utf8",
    });
    assert.equal(runner.status, 1);
    assert.match(runner.stderr, /terminated|error/i);
    const fixture = "packages/toutiao/skill/tests/fixtures/";
    const card = JSON.parse(await readFile(fixture + "story_long_card.json", "utf8"));
    for (const patch of [{ 主问题: 123 }, { 延伸: [] }, { 蓝图: [null] }]) {
      const file = path.join(dir, "card.json");
      await writeFile(file, JSON.stringify({ ...card, ...patch }));
      const qa = spawnSync(
        process.env.WRITER_PYTHON || "python3",
        [
          "packages/toutiao/skill/scripts/qa_check.py",
          fixture + "story_long_good.md",
          "--card",
          file,
          "--json",
        ],
        { encoding: "utf8" },
      );
      assert.equal(qa.status, 2);
      assert.match(qa.stdout, /立项卡/);
      assert.equal(qa.stderr, "");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test(
  "陈旧锁检查暂停时，第二进程必须等待登记互斥，不能删除新 owner",
  { timeout: 10000 },
  async () => {
    const { spawn } = await import("node:child_process");
    const { hostname } = await import("node:os");
    const root = await tempDir("writer-claim-race-");
    const children = [];
    const source = `
    import fs from 'node:fs/promises';
    import {syncBuiltinESMExports} from 'node:module';
    import path from 'node:path';
    const [role,root,module]=process.argv.slice(1);
    if(role==='a') {
      const original=fs.unlink; let first=true;
      fs.unlink=async(file,...args)=>{
        if(first && file===path.join(root,'.writer-workspace-lock.json')) {
          first=false; process.send({type:'paused'});
          await new Promise(resolve=>process.once('message',resolve));
        }
        return original(file,...args);
      };
      syncBuiltinESMExports();
    }
    const {claimWorkspace}=await import(module);
    if(role==='b') process.send({type:'started'});
    const result=await claimWorkspace(root);
    process.send({type:'claimed',...result});
    process.on('message',()=>process.exit(0));
  `;
    const start = (role) => {
      const child = spawn(
        process.execPath,
        [
          "--input-type=module",
          "-e",
          source,
          role,
          root,
          String(buildUrl("core/src/workspace-lock.js")),
        ],
        { stdio: ["ignore", "ignore", "inherit", "ipc"] },
      );
      children.push(child);
      return child;
    };
    const wait = (child, type) =>
      new Promise((resolve) => {
        const listener = (message) => {
          if (message.type === type) {
            child.off("message", listener);
            resolve(message);
          }
        };
        child.on("message", listener);
      });
    try {
      await writeFile(
        path.join(root, ".writer-workspace-lock.json"),
        JSON.stringify({
          id: "stale",
          pid: 2147483647,
          machine: hostname(),
          host: "test",
          at: new Date().toISOString(),
        }),
      );
      const a = start("a");
      await wait(a, "paused");
      const b = start("b");
      const bClaim = wait(b, "claimed");
      await wait(b, "started");
      const early = await Promise.race([
        bClaim.then(() => true),
        new Promise((resolve) => setTimeout(() => resolve(false), 100)),
      ]);
      assert.equal(early, false);
      const aClaim = wait(a, "claimed");
      a.send("resume");
      const [one, two] = await Promise.all([aClaim, bClaim]);
      assert.equal(one.readOnly, false);
      assert.equal(two.readOnly, true);
      assert.equal(one.owner.id, two.owner.id);
    } finally {
      await Promise.all(
        children.map(
          (child) =>
            new Promise((resolve) => {
              child.once("exit", resolve);
              child.kill();
            }),
        ),
      );
      await rm(root, { recursive: true, force: true });
    }
  },
);

const CLAIM_GUARD = ".writer-workspace-claim";
const claimRegistration = (root) => path.join(root, CLAIM_GUARD, "owner.json");
const guardOwner = (pid) =>
  JSON.stringify({
    id: "t18",
    pid,
    machine: hostname(),
    host: "测试",
    at: new Date().toISOString(),
  });

test("作品占用登记：启动自愈清理无主与旧版遗留登记，存活与损坏登记不清理", async (t) => {
  const { cleanStaleWorkspaceClaim } = await import(buildUrl("core/src/workspace-lock.js"));
  // pid 不存在 → 清理成功并返回旧 pid
  const dead = await tempDir("writer-claim-dead-");
  t.after(() => rm(dead, { recursive: true, force: true }));
  await mkdir(path.join(dead, CLAIM_GUARD), { recursive: true });
  await writeFile(claimRegistration(dead), guardOwner(2147483647));
  const cleaned = await cleanStaleWorkspaceClaim(dead);
  assert.equal(cleaned.kind, "cleaned");
  assert.equal(cleaned.owner.pid, 2147483647);
  assert.equal(await exists(path.join(dead, CLAIM_GUARD)), false);

  // pid 是当前进程 → 拒绝清理并报占用者，登记原样保留
  const alive = await tempDir("writer-claim-alive-");
  t.after(() => rm(alive, { recursive: true, force: true }));
  await mkdir(path.join(alive, CLAIM_GUARD), { recursive: true });
  await writeFile(claimRegistration(alive), guardOwner(process.pid));
  const busy = await cleanStaleWorkspaceClaim(alive);
  assert.equal(busy.kind, "occupied");
  assert.equal(busy.owner.pid, process.pid);
  assert.equal(await exists(claimRegistration(alive)), true);

  // 损坏登记 → 报错不吞，不清理
  await writeFile(claimRegistration(alive), "{broken");
  await assert.rejects(cleanStaleWorkspaceClaim(alive), { code: "CONFLICT", message: /损坏/ });
  assert.equal(await exists(claimRegistration(alive)), true);

  // 旧版遗留的空登记目录（无登记文件）→ 清理，无 pid 可报
  const legacy = await tempDir("writer-claim-legacy-");
  t.after(() => rm(legacy, { recursive: true, force: true }));
  await mkdir(path.join(legacy, CLAIM_GUARD), { recursive: true });
  const legacyCleaned = await cleanStaleWorkspaceClaim(legacy);
  assert.equal(legacyCleaned.kind, "cleaned");
  assert.equal(legacyCleaned.owner, null);

  // 没有登记 → absent
  const plain = await tempDir("writer-claim-plain-");
  t.after(() => rm(plain, { recursive: true, force: true }));
  assert.equal((await cleanStaleWorkspaceClaim(plain)).kind, "absent");
});

test("作品占用登记：认领时自动清理崩溃遗留的无主登记，完成后登记目录释放", async (t) => {
  const { claimWorkspace, releaseWorkspace } = await import(buildUrl("core/src/workspace-lock.js"));
  const dir = await tempDir("writer-claim-heal-");
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, CLAIM_GUARD), { recursive: true });
  await writeFile(claimRegistration(dir), guardOwner(2147483647));
  const started = Date.now();
  const access = await claimWorkspace(dir);
  assert.equal(access.readOnly, false);
  assert.ok(Date.now() - started < 2000, "无主登记应立即清理，而不是等满超时");
  assert.equal(await exists(path.join(dir, CLAIM_GUARD)), false, "认领完成后登记目录应释放");
  await releaseWorkspace(dir);
  assert.equal(await exists(path.join(dir, ".writer-workspace-lock.json")), false);
});

test(
  "作品占用登记：活进程持有时认领等待后如实报占用，不动他人登记",
  { timeout: 10000 },
  async (t) => {
    const { claimWorkspace } = await import(buildUrl("core/src/workspace-lock.js"));
    const dir = await tempDir("writer-claim-conflict-");
    t.after(() => rm(dir, { recursive: true, force: true }));
    await mkdir(path.join(dir, CLAIM_GUARD), { recursive: true });
    await writeFile(claimRegistration(dir), guardOwner(process.pid));
    const started = Date.now();
    await assert.rejects(claimWorkspace(dir), (error) => {
      assert.equal(error.code, "CONFLICT");
      assert.ok(error.message.includes(`进程 ${process.pid}`));
      return true;
    });
    assert.ok(Date.now() - started >= 2000, "活进程持有应等满超时而不是清理");
    assert.equal(await exists(claimRegistration(dir)), true);
  },
);

const fanqieChapter = (over = {}) => ({
  id: "c1",
  hasOutline: true,
  outlinePassed: true,
  status: "drafted",
  latestReviewPassed: null,
  ...over,
});

test("方法包：番茄按意图与状态路由（K-02）", () => {
  // a. 续写按钮 + 章无章纲：状态压过 write 意图，先补章纲而不是写章
  const continueNoOutline = buildMethodPack({
    mode: "fanqie",
    text: "【写作台】续写《书》第 3 章「题」（c3）。按长篇日更流程：读上一章与本章章纲，写成候选并自检，再派编辑子代理审读，把审读结论告诉我。不要定稿。",
    focus: { intent: "write" },
    fanqie: { hasWork: true, chapter: fanqieChapter({ hasOutline: false, outlinePassed: false }) },
  });
  assert.equal(continueNoOutline.intent, "plan");
  assert.deepEqual(continueNoOutline.methods, [{ id: "plan-outline" }]);
  assert.deepEqual(continueNoOutline.attachments, [
    { kind: "previous-ending" },
    { kind: "act-outline" },
  ]);

  // b. 派编辑审读按钮：不附 edit 方法，附编辑委派说明
  const review = buildMethodPack({
    mode: "fanqie",
    text: "【写作台】派编辑子代理审读《书》第 3 章「题」（c3）：完整回读当前正文，按编辑方法出审读回报（fanqie_review_report）。编辑不改正文、不定稿。",
    focus: { intent: "review" },
    fanqie: { hasWork: true, chapter: fanqieChapter({ latestReviewPassed: true }) },
  });
  assert.equal(review.intent, "review");
  assert.deepEqual(review.methods, []);
  assert.ok(!review.methods.some((m) => m.id === "edit"));
  assert.ok(review.attachments.some((a) => a.kind === "delegation-note"));

  // c. 改本章按钮 → revise + 审读回报与修改范围
  const revise = buildMethodPack({
    mode: "fanqie",
    text: "【写作台】按最新编辑审读回报修改《书》第 3 章「题」（c3）：只改回报里的硬伤与 L1–L3 位置，出候选并自检，再派编辑复审。不要定稿。",
    focus: { intent: "revise" },
    fanqie: { hasWork: true, chapter: fanqieChapter({ latestReviewPassed: false }) },
  });
  assert.equal(revise.intent, "revise");
  assert.deepEqual(revise.methods, [{ id: "revise" }]);
  assert.ok(revise.attachments.some((a) => a.kind === "review-report"));
  assert.ok(revise.attachments.some((a) => a.kind === "revision-scope"));

  // d. K-02：问句含"写"不能判成写章
  const ask = buildMethodPack({
    mode: "fanqie",
    text: "帮我看看这章写得怎么样",
    focus: {},
    fanqie: { hasWork: true, chapter: fanqieChapter() },
  });
  assert.equal(ask.intent, "inspect");
  assert.deepEqual(ask.methods, []);

  // e. K-02：按审读意见修改是 revise，不是 edit/review
  const byReview = buildMethodPack({
    mode: "fanqie",
    text: "按审读意见修改这章",
    focus: {},
    fanqie: { hasWork: true, chapter: fanqieChapter({ latestReviewPassed: false }) },
  });
  assert.equal(byReview.intent, "revise");
  assert.deepEqual(byReview.methods, [{ id: "revise" }]);

  // f. 有章纲明确写章：write-chapter + 节奏节选与病型表
  const write = buildMethodPack({
    mode: "fanqie",
    text: "续写第 3 章",
    focus: {},
    fanqie: { hasWork: true, chapter: fanqieChapter() },
  });
  assert.equal(write.intent, "write");
  assert.deepEqual(write.methods, [{ id: "write-chapter" }]);
  assert.deepEqual(write.attachments.map((a) => a.kind).sort(), [
    "lean-brief",
    "prose-table",
    "rhythm-excerpt",
  ]);

  // focus=write 与状态冲突（章无章纲）→ 仍落补章纲
  const conflict = buildMethodPack({
    mode: "fanqie",
    text: "续写第 3 章",
    focus: { intent: "write" },
    fanqie: { hasWork: true, chapter: fanqieChapter({ hasOutline: false, outlinePassed: false }) },
  });
  assert.equal(conflict.intent, "plan");
  assert.deepEqual(conflict.methods, [{ id: "plan-outline" }]);
});

test("方法包：番茄文本分支（拆书/补章纲/卷幕/开书/询问兜底）", () => {
  const base = { mode: "fanqie", focus: {}, fanqie: { hasWork: true, chapter: null } };

  // 拆书按钮的真实文本是"拆解"，同样命中 library；Focus 联合没有 library，用 plan 承载。
  const split = buildMethodPack({
    ...base,
    focus: { intent: "plan" },
    text: "【写作台】拆解以下指定原文或链接。只完成分析，不自动入库或改写本书。",
  });
  assert.equal(split.intent, "plan");
  assert.deepEqual(split.methods, [{ id: "library" }]);
  assert.deepEqual(split.attachments, []);

  const outline = buildMethodPack({ ...base, text: "先补章纲再写" });
  assert.deepEqual(outline.methods, [{ id: "plan-outline" }]);

  const structure = buildMethodPack({ ...base, text: "规划第二卷的结构" });
  assert.deepEqual(structure.methods, [{ id: "plan-structure" }]);

  const foundation = buildMethodPack({
    ...base,
    fanqie: { hasWork: false, chapter: null },
    text: "开一本新书",
  });
  assert.deepEqual(foundation.methods, [{ id: "plan-foundation" }]);

  const fallback = buildMethodPack({ ...base, text: "这本书的目标读者是谁" });
  assert.equal(fallback.intent, "inspect");
  assert.deepEqual(fallback.methods, []);
});

test("方法包：头条按文章状态映射七步", () => {
  const toutiao = (article) =>
    buildMethodPack({ mode: "toutiao", text: "", focus: {}, toutiao: { article } });
  const at = (over) =>
    toutiao({
      stage: "初稿待改",
      contentLine: "news",
      hasCard: true,
      hasHeadline: true,
      hasDraft: true,
      ...over,
    });
  const ids = (p) => p.methods.map((m) => m.id);

  // 无文章 → S1 找题（hot/evergreen 都给，按题型取用）
  assert.deepEqual(toutiao(null).steps, ["S1"]);
  assert.deepEqual(ids(toutiao(null)), ["s1-hot", "s1-evergreen"]);

  // 按流程推进：快照里第一个没完成的环节就是当前步骤
  assert.deepEqual(ids(at({ hasCard: false })), ["s2-selection"]);
  assert.deepEqual(at({ hasCard: false }).steps, ["S2"]);
  assert.deepEqual(ids(at({ hasHeadline: false })), ["s3-headline"]);
  assert.deepEqual(ids(at({})), ["s4-common", "s4-news"]);
  assert.deepEqual(ids(at({ contentLine: "story" })), ["s4-common", "s4-story"]);
  assert.deepEqual(ids(at({ contentLine: "micro" })), ["s4-common", "s4-micro"]);
  assert.deepEqual(at({}).attachments, [{ kind: "corpus-excerpt" }]);

  // 五种状态：初稿待改/验收退回 → S4；待验收 → S5+S6；已验收 → S7；已交稿 → 无方法
  assert.deepEqual(at({ stage: "初稿待改" }).steps, ["S4"]);
  assert.deepEqual(at({ stage: "验收退回" }).steps, ["S4"]);
  const editing = at({ stage: "待验收" });
  assert.deepEqual(editing.steps, ["S5", "S6"]);
  assert.deepEqual(ids(editing), ["s5-editing", "s6-qa"]);
  const accepted = at({ stage: "已验收" });
  assert.deepEqual(accepted.steps, ["S7"]);
  assert.deepEqual(ids(accepted), ["s7-delivery", "template-delivery"]);
  const delivered = at({ stage: "已交稿" });
  assert.deepEqual(delivered.steps, ["S7"]);
  assert.deepEqual(delivered.methods, []);
});

// —— T13 抽卡并发池（writer_draw）：draw-task.ts 在 apps/desktop（不走 build/ tsc），
// 用仓库自带 esbuild 按生产入口原样打包一次再加载，测的就是真实实现。

let drawTask;
async function loadDrawTask() {
  if (drawTask) return drawTask;
  // 打包产物落进仓库的 gitignored 构建目录，裸依赖才能沿 node_modules 解析。
  const outfile = path.join(ROOT, "apps/desktop/out-test/unit-draw-task.mjs");
  await mkdir(path.dirname(outfile), { recursive: true });
  const { build } = await import("esbuild");
  await build({
    entryPoints: [path.join(ROOT, "apps/desktop/src/session/draw-task.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  drawTask = await import(pathToFileURL(outfile).href);
  return drawTask;
}

test("抽卡并发池：5 路任务最多 2 路同时执行，结果按输入顺序返回", async () => {
  const { runTaskPool } = await loadDrawTask();
  let running = 0,
    peak = 0;
  const outcomes = await runTaskPool(5, 2, async (index) => {
    running++;
    peak = Math.max(peak, running);
    await new Promise((resolve) => setTimeout(resolve, 10));
    running--;
    return index * 10;
  });
  assert.equal(peak, 2);
  assert.deepEqual(
    outcomes.map((o) => (o.status === "ok" ? o.value : null)),
    [0, 10, 20, 30, 40],
  );
});

test("抽卡并发池：单路失败不影响他路，失败原因随该路结果返回", async () => {
  const { runTaskPool } = await loadDrawTask();
  const outcomes = await runTaskPool(3, 2, async (index) => {
    if (index === 1) throw new Error("第 2 路起草失败");
    return `稿-${index}`;
  });
  assert.equal(outcomes[0].status, "ok");
  assert.equal(outcomes[0].value, "稿-0");
  assert.equal(outcomes[1].status, "failed");
  assert.match(String(outcomes[1].error), /第 2 路起草失败/);
  assert.equal(outcomes[2].status, "ok");
  assert.equal(outcomes[2].value, "稿-2");
});

// —— T17 改稿学习（writer_revision_learn）：learn-task.ts 同样在 apps/desktop，
// 用 esbuild 按生产入口打包后加载，测 pending 合并与采纳内容的纯函数。

let learnTask;
async function loadLearnTask() {
  if (learnTask) return learnTask;
  const outfile = path.join(ROOT, "apps/desktop/out-test/unit-learn-task.mjs");
  await mkdir(path.dirname(outfile), { recursive: true });
  const { build } = await import("esbuild");
  await build({
    entryPoints: [path.join(ROOT, "apps/desktop/src/session/learn-task.ts")],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile,
    logLevel: "silent",
  });
  learnTask = await import(pathToFileURL(outfile).href);
  return learnTask;
}

function learnItem(seed, over = {}) {
  return {
    id: `id-${seed}`,
    condition: `条件-${seed}`,
    change: `改法-${seed}`,
    why: "inferred",
    example: { before: `前-${seed}`, after: `后-${seed}` },
    source: `c00${seed}`,
    at: "2026-11-07T00:00:00.000Z",
    count: 3,
    ...over,
  };
}

test("改稿学习 pending 合并：同 id 印证 count+1 并刷新证据，不同 id 追加", async () => {
  const { mergePending } = await loadLearnTask();
  const first = mergePending(undefined, "toutiao", [learnItem(1)]);
  assert.deepEqual(first, { mode: "toutiao", items: [learnItem(1)] });
  const again = mergePending(first, "toutiao", [learnItem(1, { why: "作者嫌总结腔", count: 7 })]);
  assert.equal(again.items.length, 1);
  assert.equal(again.items[0].count, 4, "同 id 是再次印证：count 只加 1");
  assert.equal(again.items[0].why, "作者嫌总结腔", "证据刷新为最新一次");
  const added = mergePending(again, "toutiao", [learnItem(2)]);
  assert.deepEqual(
    added.items.map((row) => row.id),
    ["id-1", "id-2"],
  );
  assert.equal(added.items[0].count, 4, "未再次出现的候选次数不变");
});

test("改稿学习采纳内容：text 编辑后替换默认内容，番茄/头条各按各的格式", async () => {
  const { styleEntryOf, feedbackEntryOf } = await loadLearnTask();
  const row = learnItem(1, { why: "嫌总结腔" });
  assert.match(styleEntryOf(row, undefined), /【改稿学习 \d{4}-\d{2}-\d{2}】/);
  assert.match(styleEntryOf(row, undefined), /改法：改法-1/);
  assert.match(styleEntryOf(row, undefined), /来源：c001/);
  assert.ok(!styleEntryOf(row, "改成具体动作").includes("改法-1"));
  assert.match(styleEntryOf(row, "  "), /改法：改法-1/, "空 text 回退到候选默认内容");
  const entry = feedbackEntryOf(row, undefined);
  assert.equal(entry.original, "前-1");
  assert.equal(entry.revised, "后-1");
  assert.equal(entry.病型, "条件-1");
  assert.equal(entry.改法, "改法-1");
  assert.equal(feedbackEntryOf(row, "作者改的这句").revised, "作者改的这句");
  assert.equal(
    feedbackEntryOf(learnItem(1, { why: "inferred" }), undefined).motive,
    "改稿学习归纳（作者未给理由）",
  );
  assert.equal(feedbackEntryOf(row, undefined).motive, "嫌总结腔");
});

test("改稿学习归纳输出校验：合法数组入候选，count<3 或非法 JSON 如实报归纳失败", async () => {
  const { parseLearnOutput, pendingId } = await loadLearnTask();
  const ok = parseLearnOutput(
    '前缀 [ {"condition":"c","change":"g","why":"inferred",' +
      '"example":{"before":"a","after":"b"},"source":"c001","count":3} ] 后缀',
  );
  assert.equal(ok.length, 1);
  assert.equal(ok[0].id, pendingId("c", "g"));
  assert.throws(() => parseLearnOutput("这不是 JSON"), /归纳失败/);
  assert.throws(
    () =>
      parseLearnOutput(
        '[{"condition":"c","change":"g","why":"w","example":{"before":"a","after":"b"},"source":"s","count":2}]',
      ),
    /count≥3/,
  );
  assert.throws(
    () => parseLearnOutput('[{"condition":"c","change":"g","why":"w","count":5}]'),
    /不符合 schema/,
  );
});

test("改稿学习开关：两包 config 解析 learn.enabled，非布尔或未知字段报错", async () => {
  const { parseFanqieConfig } = await import(buildUrl("fanqie/src/config.js"));
  const { parseToutiaoConfig } = await import(buildUrl("toutiao/src/config.js"));
  assert.deepEqual(parseFanqieConfig({ learn: { enabled: true } }).value.learn, { enabled: true });
  assert.deepEqual(parseToutiaoConfig({ learn: { enabled: true } }).value.learn, { enabled: true });
  assert.ok(parseFanqieConfig({ learn: { enabled: "on" } }).issues.length >= 1);
  assert.ok(parseToutiaoConfig({ learn: 3 }).issues.length >= 1);
  assert.equal(parseFanqieConfig({}).value.learn, undefined, "缺省即关");
  assert.equal(parseToutiaoConfig({}).value.learn, undefined, "缺省即关");
});
