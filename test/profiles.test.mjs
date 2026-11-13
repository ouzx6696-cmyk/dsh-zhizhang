// 方法方案：默认（精炼版）/ 原版 / 用户方案一、二…
//   1. 默认方案文件齐全、标题与目录一致、长篇别名覆盖全部原版 id、只提真实工具名、母题库标题与规则名单一致；
//   2. 工具：读默认、强制读原版、回落原版、建用户方案（导入文件夹）、覆盖、切换、恢复、改名，第二个方案以原版为底；
//   3. 写作台接口：列表、详情、全文（附底稿）、新建、保存、切换、删除须确认；配置固定方案时不许切换。
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdir, readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { ROOT, createToolHarness, createCommandHarness, tempDir, buildUrl } from "./helpers.mjs";

const TT = path.join(ROOT, "packages/toutiao/profiles/default");
const FQ = path.join(ROOT, "packages/fanqie/profiles/default");

async function toolNames() {
  const cwd = await tempDir();
  const tt = await createToolHarness({ mode: "toutiao", cwd });
  const fq = await createToolHarness({ mode: "fanqie", cwd });
  const names = new Set([...tt.tools.keys(), ...fq.tools.keys()]);
  return names;
}

test("默认方案：文件齐全、目录一致、别名完整、工具名真实", async () => {
  const { buildToutiaoBrief } = await import("../build/toutiao/src/brief.js");
  const TOUTIAO_BRIEF = await buildToutiaoBrief();
  assert.ok([...TOUTIAO_BRIEF].length < 2000);
  assert.doesNotMatch(TOUTIAO_BRIEF, /python3|scripts\//);

  const names = await toolNames();
  for (const [dir, mode] of [
    [TT, "toutiao"],
    [FQ, "fanqie"],
  ]) {
    const idx = JSON.parse(await readFile(path.join(dir, "profile.json"), "utf8"));
    assert.equal(idx.mode, mode);
    const files = (await readdir(dir))
      .filter((f) => f.endsWith(".md"))
      .map((f) => f.replace(/\.md$/, ""))
      .sort();
    const listed = idx.methods
      .filter((m) => !m.fallback)
      .map((m) => m.id)
      .sort();
    assert.deepEqual(files, listed, `${mode}: profile.json 与文件一致`);
    for (const id of files) {
      const text = await readFile(path.join(dir, id + ".md"), "utf8");
      assert.equal((text.match(/^# .+$/gm) ?? []).length >= 1, true, `${mode}/${id} 有 # 标题`);
      assert.ok(text.length > 800, `${mode}/${id} 不能是空壳`);
      assert.ok(!/[「」]/.test(text), `${mode}/${id} 不用「」`);
      assert.ok(
        !/\b(python3?|init_project\.py|archive_draft\.py|qa_check\.py)\b/.test(text),
        `${mode}/${id} 不残留脚本命令`,
      );
      for (const m of text.matchAll(/\b((?:toutiao|fanqie)_[a-z]+(?:_[a-z]+)+)\b/g)) {
        assert.ok(names.has(m[1]), `${mode}/${id} 提到的工具不存在：${m[1]}`);
      }
    }
  }
  const tt = JSON.parse(await readFile(path.join(TT, "profile.json"), "utf8"));
  const { METHOD_FILES } = await import(buildUrl("toutiao/src/methods.js"));
  assert.deepEqual(
    tt.methods.map((m) => m.id).sort(),
    Object.keys(METHOD_FILES).sort(),
    "头条默认方案覆盖全部 30 个 id",
  );
  // 长篇：每个原版 forge id 都有归宿
  const fq = JSON.parse(await readFile(path.join(FQ, "profile.json"), "utf8"));
  const { fanqieLibrary } = await import(buildUrl("fanqie/src/forge.js"));
  const forge = await fanqieLibrary.originalIds();
  assert.deepEqual(
    forge.filter((id) => !fq.aliases[id]),
    [],
  );
  const ids = new Set(fq.methods.map((m) => m.id));
  assert.ok(Object.values(fq.aliases).every((v) => ids.has(v)));
});

async function enable(config = {}) {
  const cwd = await tempDir();
  const tt = await createToolHarness({ mode: "toutiao", cwd, config: config.toutiao });
  const fq = await createToolHarness({ mode: "fanqie", cwd, config: config.fanqie });
  return { cwd, tt, fq, call: (harness, name, args = {}) => harness.call(name, args) };
}

test("工具：默认 → 原版回落 → 用户方案一（导入、覆盖、切换、恢复）→ 用户方案二以原版为底", async () => {
  process.env.WRITER_PROFILES_DIR = await tempDir("writer-profiles-");
  try {
    const { cwd, tt, fq, call } = await enable();
    let r = await call(tt, "toutiao_method_get", { id: "s3-headline" });
    assert.equal(r.from, "default");
    assert.equal(r.profile_name, "默认");
    assert.equal(
      (await call(tt, "toutiao_method_get", { id: "原版:s3-headline" })).from,
      "original",
    );
    assert.equal(
      (await call(tt, "toutiao_method_get", { id: "template-card" })).from,
      "original",
      "默认没有的回落原版",
    );
    const list0 = await call(tt, "toutiao_profile", { action: "list" });
    assert.deepEqual(
      list0.profiles.map((p) => p.name),
      ["默认", "原版"],
    );
    assert.equal(list0.active, "default");

    await mkdir(path.join(cwd, "我的头条/语料"), { recursive: true });
    await writeFile(path.join(cwd, "我的头条/s3-headline.md"), "# 我的标题法\n先写钱，再写人。\n");
    await writeFile(path.join(cwd, "我的头条/语料/养老.md"), "# 养老语料\n退休金到账那天。\n");
    const made = await call(tt, "toutiao_profile", {
      action: "create",
      from_dir: "我的头条",
      note: "自己的标题法",
    });
    assert.equal(made.profile.name, "用户方案一");
    assert.deepEqual(made.imported.sort(), ["s3-headline", "语料/养老"]);
    // 未切换前仍是默认
    assert.equal((await call(tt, "toutiao_method_get", { id: "s3-headline" })).from, "default");
    await call(tt, "toutiao_profile", { action: "use", profile: "用户方案一" });
    r = await call(tt, "toutiao_method_get", { id: "s3-headline" });
    assert.equal(r.from, "user");
    assert.match(r.text, /先写钱/);
    assert.equal(
      (await call(tt, "toutiao_method_get", { id: "s4-common" })).from,
      "default",
      "没覆盖的用底稿",
    );
    assert.match((await call(tt, "toutiao_method_get", { id: "语料/养老" })).text, /退休金/);
    const listed = await call(tt, "toutiao_method_get", { id: "list" });
    assert.equal(listed.profile, "用户方案一");
    assert.ok(listed.methods.some((m) => m.id === "语料/养老" && m.from === "user"));
    const saved = await call(tt, "toutiao_profile", {
      action: "save",
      profile: "用户方案一",
      method: "s6-qa",
      text: "# 质检\n按工具来。\n",
    });
    assert.equal(saved.id, "s6-qa");
    assert.equal(
      (await call(tt, "toutiao_profile", { action: "show" })).methods.find((m) => m.id === "s6-qa")
        .overridden,
      true,
    );
    await call(tt, "toutiao_profile", {
      action: "reset",
      profile: "user-1",
      method: "s3-headline",
    });
    assert.equal((await call(tt, "toutiao_method_get", { id: "s3-headline" })).from, "default");
    await call(tt, "toutiao_profile", {
      action: "rename",
      profile: "user-1",
      name: "我的头条方案",
    });
    assert.equal(
      (await call(tt, "toutiao_profile", { action: "list" })).profiles[2].name,
      "我的头条方案",
    );
    // 内置方案不能改；方法 id 不能越级
    assert.equal(
      (
        await call(tt, "toutiao_profile", {
          action: "save",
          profile: "默认",
          method: "s3-headline",
          text: "x",
        })
      ).code,
      "CONFLICT",
    );
    assert.equal(
      (
        await call(tt, "toutiao_profile", {
          action: "save",
          profile: "user-1",
          method: "../x",
          text: "x",
        })
      ).code,
      "INVALID_ARGS",
    );
    const second = await call(tt, "toutiao_profile", { action: "create", base: "原版" });
    assert.equal(second.profile.name, "用户方案二");
    assert.equal(second.profile.base, "original");
    await call(tt, "toutiao_profile", { action: "use", profile: "用户方案二" });
    assert.equal((await call(tt, "toutiao_method_get", { id: "s3-headline" })).from, "original");

    // 长篇：两个模式各自独立；原版 forge id 在默认方案下对到同类方法
    r = await call(fq, "fanqie_method_get", { id: "novel-writer/references/editor_method" });
    assert.ok(
      r.startsWith("## 方法 · edit（方案「默认」）"),
      `原版 id 对到默认方案同类方法：${r.slice(0, 80)}`,
    );
    assert.ok(
      (await call(fq, "fanqie_method_get", { id: "references/writing" })).startsWith(
        "## 方法 · write-chapter（方案「默认」）",
      ),
    );
    const orig = await call(fq, "fanqie_method_get", {
      id: "原版:novel-writer/references/editor_method",
    });
    assert.ok(
      orig.startsWith("## 方法 · novel-writer/references/editor_method（方案「原版」）"),
      orig.slice(0, 80),
    );
    assert.match(orig, /写作 Agent 适配/);
    let list = await call(fq, "fanqie_method_list", {});
    assert.match(list, /^# 长篇方法/);
    assert.match(list, /^- `edit`/m, "默认方案目录");
    await call(fq, "fanqie_profile", { action: "use", profile: "原版" });
    list = await call(fq, "fanqie_method_list", {});
    assert.match(list, /方案「原版」\d+ 项/);
    assert.ok(
      (
        await call(fq, "fanqie_method_get", { id: "novel-writer/references/editor_method" })
      ).startsWith("## 方法 · novel-writer/references/editor_method（方案「原版」）"),
      "原版方案下按原版 id 直读",
    );
    // 编辑子代理看不到方案管理工具
    const ed = await createToolHarness({ mode: "toutiao", cwd, role: "editor" });
    assert.ok(!ed.tools.has("toutiao_profile") && ed.tools.has("toutiao_method_get"));
  } finally {
    delete process.env.WRITER_PROFILES_DIR;
  }
});

test("写作台接口：方案列表、详情、全文、新建、保存、切换、删除；配置固定方案", async () => {
  process.env.WRITER_PROFILES_DIR = await tempDir("writer-profiles-");
  const request = await createCommandHarness({ fanqie: { profile: "原版" } });
  const get = async (route, input = {}) => await request(route, { input });
  const post = (route, input) => request(route, { kind: "write", input });
  try {
    let l = await get("/toutiao/profiles");
    assert.equal(l.ok, true);
    assert.equal(l.active, "default");
    assert.equal(l.profiles[0].methods, 30);
    const d = await get("/toutiao/profiles/detail", { profile: "default" });
    assert.equal(d.methods.length, 30);
    assert.ok(d.methods.find((m) => m.id === "s3-headline").title);
    const c = await post("/toutiao/profiles/create", {
      files: [
        { id: "s3-headline.md", text: "# 标题\n我的。\n" },
        { id: "新方法", text: "# 新\n内容\n" },
      ],
    });
    assert.equal(c.profile.name, "用户方案一");
    const m = await get("/toutiao/profiles/method", { profile: "user-1", id: "s3-headline" });
    assert.equal(m.method.from, "user");
    assert.ok(m.base_text.length > 500, "覆盖时附底稿");
    const det = await get("/toutiao/profiles/detail", { profile: "user-1" });
    assert.equal(det.methods.find((x) => x.id === "新方法").added, true);
    assert.equal(det.profile.overrides, 2);
    assert.equal(
      (
        await post("/toutiao/profiles/save", {
          profile: "user-1",
          id: "s5-editing",
          text: "# 红笔\n",
        })
      ).ok,
      true,
    );
    assert.equal((await post("/toutiao/profiles/use", { profile: "user-1" })).ok, true);
    assert.equal((await get("/toutiao/profiles")).active, "user-1");
    assert.equal(
      (await post("/toutiao/profiles/delete", { profile: "user-1" })).ok,
      false,
      "删除须确认",
    );
    const del = await post("/toutiao/profiles/delete", { profile: "user-1", confirm: true });
    assert.equal(del.was_active, true);
    assert.equal((await get("/toutiao/profiles")).active, "default", "删掉当前方案后回到默认");
    // 长篇在配置里固定为原版
    l = await get("/fanqie/profiles");
    assert.equal(l.active, "original");
    assert.equal(l.pinned, true);
    assert.equal((await post("/fanqie/profiles/use", { profile: "default" })).ok, false);
    assert.equal(
      (await get("/fanqie/profiles/method", { profile: "default", id: "edit" })).method.from,
      "default",
    );
    assert.equal(
      (await post("/fanqie/profiles/save", { profile: "default", id: "edit", text: "x" })).ok,
      false,
      "内置方案只读",
    );
  } finally {
    delete process.env.WRITER_PROFILES_DIR;
  }
  const { setProfilesRoot, activeProfile } = await import(buildUrl("core/src/profiles.js"));
  const broken = await tempDir("writer-broken-profile-");
  const fs = await import("node:fs/promises");
  setProfilesRoot(broken);
  await fs.mkdir(path.join(broken, "fanqie/user-1"), { recursive: true });
  await fs.writeFile(path.join(broken, "fanqie/user-1/profile.json"), "{broken");
  await assert.rejects(activeProfile("fanqie", "user-1"), /损坏/);
  await fs.writeFile(path.join(broken, "active.json"), JSON.stringify({ fanqie: 123 }));
  assert.equal((await activeProfile("fanqie")).id, "default", "损坏的 active.json 回落到默认方案");
  setProfilesRoot(undefined);
  await fs.rm(broken, { recursive: true, force: true });
});

test("原版方案支持常驻提示中的写作方法入口，保留用户覆盖", async () => {
  const { readMethod } = await import("../build/core/src/profiles.js");
  const { fanqieLibrary } = await import("../build/fanqie/src/forge.js");
  for (const id of ["overview", "write-chapter", "rhythm", "prose", "edit"]) {
    const original = await readMethod(fanqieLibrary, "original", id);
    assert.equal(original.from, "original");
    assert.ok(original.text.length > 100);
    const current = await readMethod(fanqieLibrary, "default", id);
    assert.equal(current.id, id);
    assert.equal(current.from, "default");
  }
  await assert.rejects(readMethod(fanqieLibrary, "original", "missing-method"), /没有这份方法/);
});

test("CORE-03/04/24 方案按 id 优先、拒绝保留名；单个方案损坏或 id 不符只标该行", async () => {
  const dir = await tempDir("writer-profiles-");
  process.env.WRITER_PROFILES_DIR = dir;
  const request = await createCommandHarness();
  const get = async (route) => await request(route);
  const post = (route, input) => request(route, { kind: "write", input });
  const { findProfile, readMethod } = await import(buildUrl("core/src/profiles.js"));
  const { readJson } = await import(buildUrl("core/src/fsx.js"));
  const { toutiaoLibrary } = await import(buildUrl("toutiao/src/methods.js"));
  const metaFile = (id) => path.join(dir, "toutiao", id, "profile.json");
  try {
    assert.equal((await post("/toutiao/profiles/create", { name: "甲" })).profile.id, "user-1");
    assert.equal((await post("/toutiao/profiles/create", { name: "乙" })).profile.id, "user-2");
    // 旧数据：user-1 的名称恰好是 user-2。
    const first = JSON.parse(await readFile(metaFile("user-1"), "utf8"));
    await writeFile(metaFile("user-1"), JSON.stringify({ ...first, name: "user-2" }));
    assert.equal((await findProfile("toutiao", "user-2")).id, "user-2");
    let list = await get("/toutiao/profiles");
    assert.equal(list.profiles.find((p) => p.id === "user-1").nameConflict, true);
    assert.equal(list.profiles.find((p) => p.id === "user-2").nameConflict, undefined);
    for (const name of ["User-3", "default", "ORIGINAL"]) {
      const made = await post("/toutiao/profiles/create", { name });
      assert.equal(made.ok, false, name);
      assert.equal(made.code, "INVALID_ARGS");
    }
    const renamed = await post("/toutiao/profiles/rename", { profile: "user-2", name: "user-1" });
    assert.equal(renamed.code, "INVALID_ARGS");

    // 一份 profile.json 损坏：列表照常两行，损坏行带完整路径，读该方案如实报错。
    await writeFile(metaFile("user-2"), "{");
    list = await get("/toutiao/profiles");
    assert.equal(list.ok, true);
    const users = list.profiles.filter((p) => p.kind === "user");
    assert.deepEqual(
      users.map((p) => p.id),
      ["user-1", "user-2"],
    );
    assert.equal(users[0].broken, undefined);
    assert.ok(users[1].broken.includes(metaFile("user-2")), users[1].broken);
    await assert.rejects(readMethod(toutiaoLibrary, "user-2", "s3-headline"), (error) => {
      assert.equal(error.code, "CONFLICT");
      assert.ok(error.message.includes("user-2") && error.message.includes(metaFile("user-2")));
      return true;
    });
    await assert.rejects(readJson(metaFile("user-2")), (error) => {
      assert.ok(error.cause instanceof SyntaxError);
      return true;
    });
    // 新建不复用损坏方案的编号，也不受它影响。
    assert.equal((await post("/toutiao/profiles/create", { name: "丙" })).profile.id, "user-3");

    // id 与目录不符：不再凭空消失，按目录名标为损坏。
    await writeFile(metaFile("user-1"), JSON.stringify({ ...first, id: "user-9" }));
    list = await get("/toutiao/profiles");
    const mismatch = list.profiles.find((p) => p.id === "user-1");
    assert.match(mismatch.broken, /id/);
    assert.equal(
      JSON.parse(await readFile(metaFile("user-1"), "utf8")).id,
      "user-9",
      "不改作者文件",
    );
  } finally {
    delete process.env.WRITER_PROFILES_DIR;
  }
});
