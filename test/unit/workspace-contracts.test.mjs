import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { FORMAT_VERSION } = await importTs("packages/core/src/paths.ts");
const { APP_VERSION } = await importTs("packages/core/src/version.ts");
const { loadProfile, methodFor } = await importTs("packages/core/src/methods/index.ts");

const ROOT = process.cwd();
const BUILTIN_FANQIE_PROFILES = path.join(ROOT, "packages/fanqie/profiles");

test("workspace packages, APP_VERSION, and FORMAT_VERSION stay aligned", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(rootPkg.name, "zhizhang");
  assert.equal(rootPkg.version, APP_VERSION);
  assert.equal(FORMAT_VERSION, "zhizhang/2.0");
  assert.deepEqual(rootPkg.workspaces, ["apps/*", "packages/*"]);

  for (const pkgDir of [
    "packages/core",
    "packages/fanqie",
    "packages/toutiao",
    "packages/workbench",
    "packages/ui",
    "apps/desktop",
  ]) {
    const pkg = JSON.parse(fs.readFileSync(path.join(ROOT, pkgDir, "package.json"), "utf8"));
    assert.equal(pkg.version, APP_VERSION, `${pkgDir} version mismatch`);
    assert.ok(pkg.name.startsWith("@zhizhang/"), `${pkgDir} name must start with @zhizhang/`);
  }
});

test("core package declares zero external dependencies and root package has no runtime dependencies", () => {
  const rootPkg = JSON.parse(fs.readFileSync(path.join(ROOT, "package.json"), "utf8"));
  assert.equal(rootPkg.dependencies, undefined, "root package.json should not hold runtime deps");

  const corePkg = JSON.parse(
    fs.readFileSync(path.join(ROOT, "packages/core/package.json"), "utf8"),
  );
  assert.equal(corePkg.dependencies, undefined, "@zhizhang/core must stay zero-dependency");
});

test("stage-map.json exists and references valid markdown files for both modes", () => {
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

test("fanqie default profile injects prose anti-AI, fast-pacing review, blind select, and genre tables", async () => {
  const profile = await loadProfile("fanqie", "default", { builtinDir: BUILTIN_FANQIE_PROFILES });
  assert.equal(profile.id, "default");

  const reviseMethod = methodFor(profile, "fanqie.chapter.revise");
  assert.ok(reviseMethod.text.includes("二阶 AI 腔"), "revise 阶段应包含二阶 AI 腔诊断规范");
  assert.ok(reviseMethod.text.includes("一阶 AI 腔"), "revise 阶段应包含一阶 AI 腔诊断规范");

  const reviewMethod = methodFor(profile, "fanqie.chapter.review");
  assert.ok(
    reviewMethod.text.includes("番茄快爽与打脸文五项专属审改"),
    "review 阶段应包含番茄快爽五项专属审改",
  );
  const selectMethod = methodFor(profile, "fanqie.chapter.select");
  assert.ok(selectMethod.text.includes("盲评"), "select 阶段应包含双稿盲评口径");

  const cardMethod = methodFor(profile, "fanqie.book.card");
  assert.ok(cardMethod.text.includes("脑洞"), "book.card 阶段应挂载 genres.md 题材表");
  assert.ok(cardMethod.text.includes("战神"), "book.card 阶段应覆盖六大题材节奏基准");

  const draftMethod = methodFor(profile, "fanqie.chapter.draft");
  assert.ok(
    draftMethod.text.includes("手机屏实操示范") || draftMethod.text.includes("移动端"),
    "draft 阶段应包含移动端示范示例",
  );
});
