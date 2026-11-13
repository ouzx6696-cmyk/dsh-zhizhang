import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { ROOT, tempDir } from "./helpers.mjs";

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
  for (const file of [
    "package.json",
    "apps/desktop/package.json",
    "packages/ui/package.json",
    "packages/unused/package.json",
  ])
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
  await write("packages/ui/src/unsafe.ts", 'import "node:fs";');
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
    /渲染层不能访问 node:fs/,
  ])
    assert.match(failed.stderr, message);
  assert.match(failed.stdout, /吞错=10/);
  await write("packages/workbench/src/client/example.jsx", "export const value = 1;");
  await write("packages/core/src/example.ts", "const value: number = 1;");
  await write("scripts/broken.mjs", "");
  await write("test/broken.mjs", "");
  await write("packages/ui/src/overlay.css", "");
  await write("packages/ui/src/unsafe.ts", "");
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
    "packages/workbench/src/commands.ts",
    'import { isMissingFileError } from "../../core/src/fsx.js";\nexport const ok = isMissingFileError;',
  );
  const failed = run();
  assert.equal(failed.status, 1);
  assert.match(failed.stderr, /不能引用 fsx/);
  await write(
    "packages/workbench/src/commands.ts",
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

test("守卫：按语法计 any 与非空断言，字符串里的英文不误报；function 形式的吞错也要注明", async (t) => {
  const { write, run } = await guardFixture(t);
  await write(
    "packages/core/src/copy.ts",
    'export const hint = "Hello! Pick any file"; export const ok = (x?: string) => x !== undefined;',
  );
  const valid = run();
  assert.equal(valid.status, 0, valid.stderr);
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

test("守卫分别定位各种未处理的错误", async (t) => {
  const f = await guardFixture(t);
  const cases = [
    "function f() { for (;;) { try { g(); } catch { continue; } } }",
    "promise.catch(() => DEFAULT);",
    "promise.then(ok, function () { return null; });",
    "try { f(); } catch (unused) { recover(); }",
  ];
  await f.write("packages/core/src/probe.js", cases.join("\n"));
  const result = f.run();
  assert.equal(result.status, 1);
  for (let line = 1; line <= cases.length; line++)
    assert.match(result.stderr, new RegExp(`probe\\.js: ${line}: 吞错须注明`));
});

test("守卫拒绝 core 外部依赖，允许记录原因的降级", async (t) => {
  const f = await guardFixture(t);
  await f.write("packages/core/src/probe.js", 'import x from "external";');
  assert.notEqual(f.run().status, 0);
  await f.write(
    "packages/core/src/probe.js",
    "// allow-catch: queue continuation, original promise returned separately.\np.catch(() => DEFAULT);",
  );
  assert.equal(f.run().status, 0);
});
