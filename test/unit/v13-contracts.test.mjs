import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";

const ROOT = process.cwd();

test("v1.3 workspaces and @zhizhang/* package versions are aligned at 1.3.0", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(rootPkg.name, "zhizhang");
  assert.equal(rootPkg.version, "1.3.0");
  assert.deepEqual(rootPkg.workspaces, ["apps/*", "packages/*"]);

  for (const pkgDir of ["packages/core", "packages/fanqie", "packages/toutiao", "packages/workbench", "packages/ui", "apps/desktop"]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, pkgDir, "package.json"), "utf8"));
    assert.equal(pkg.version, "1.3.0", `${pkgDir} version mismatch`);
    assert.ok(pkg.name.startsWith("@zhizhang/"), `${pkgDir} name must start with @zhizhang/`);
  }
});

test("legacy free-writer engine and workflow directories are removed", () => {
  assert.equal(fs.existsSync(path.join(ROOT, "packages/fanqie/src/engine")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "apps/desktop/src/workflow")), false);
  assert.equal(fs.existsSync(path.join(ROOT, "tsconfig.jsx.json")), false);
});

test("stage-map.json exists for both fanqie and toutiao default profiles", () => {
  for (const mode of ["fanqie", "toutiao"]) {
    const mapPath = path.join(ROOT, "packages", mode, "profiles/default/stage-map.json");
    assert.equal(fs.existsSync(mapPath), true, `Missing ${mapPath}`);
    const parsed = JSON.parse(fs.readFileSync(mapPath, "utf8"));
    for (const [stage, spec] of Object.entries(parsed)) {
      for (const take of spec.take) {
        const mdPath = path.join(ROOT, "packages", mode, "profiles/default", take.file);
        assert.equal(fs.existsSync(mdPath), true, `${stage} references missing ${take.file}`);
      }
    }
  }
});

test("toutiao fixed ending sentence and status words are preserved", () => {
  const statusTs = fs.readFileSync(path.join(ROOT, "packages/toutiao/src/domain/status.ts"), "utf8");
  assert.ok(statusTs.includes("——AI 到此止步。是否采用、何时发布由你决定。"));
  for (const s of ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"]) {
    assert.ok(statusTs.includes(s), `Missing status ${s}`);
  }
});
