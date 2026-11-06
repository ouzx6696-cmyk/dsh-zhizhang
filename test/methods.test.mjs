// 创作方法论配齐与加载：
//   1. 头条方法与语料、forge 三件套、引擎方法资产，和原件逐份对照，一份不缺；
//   2. 每一份都能经对应工具真实加载（源码构建与打好的插件包各跑一遍）；
//   3. 常驻规则、方法、工具说明里提到的工具名都真实存在（防止"让模型去调一个不存在的工具"）。
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync } from "node:fs";
import { readdir } from "node:fs/promises";
import path from "node:path";
import { ROOT, createToolHarness, tempDir, buildUrl } from "./helpers.mjs";

const TOUTIAO_SKILL = path.join(ROOT, "packages/toutiao/skill");
const FORGE = path.join(ROOT, "packages/fanqie/skill/forge");

async function files(dir, ext) {
  const out = [];
  async function walk(d) {
    for (const e of await readdir(d, { withFileTypes: true })) {
      const p = path.join(d, e.name);
      if (e.isDirectory()) {
        if (e.name !== "scripts" && e.name !== "tests" && e.name !== "__pycache__") await walk(p);
      } else if (e.name.endsWith(ext)) out.push(path.relative(dir, p).split(path.sep).join("/"));
    }
  }
  await walk(dir);
  return out.sort();
}

async function enableBoth() {
  const cwd = await tempDir();
  const tt = await createToolHarness({ mode: "toutiao", cwd });
  const fq = await createToolHarness({ mode: "fanqie", cwd });
  return { tt, fq, call: (harness, name, args = {}) => harness.call(name, args) };
}

async function loadEverything(label) {
  const { tt, fq, call } = await enableBoth();
  const loaded = { toutiao: 0, forge: 0, engine: 0 };
  const texts = [];

  // 头条：toutiao_method_get 的每个 id
  const ttTool = tt.tools.get("toutiao_method_get");
  const ids = (await call(tt, "toutiao_method_get", { id: "list" })).builtin;
  for (const id of ids ?? [])
    assert.ok(
      ttTool.parameters.properties.id.description.includes(id),
      `${label}: 工具说明里列出 ${id}`,
    );
  assert.ok(Array.isArray(ids) && ids.length >= 30, `${label}: 头条方法 id 列表`);
  for (const id of ids) {
    const r = await call(tt, "toutiao_method_get", { id });
    assert.equal(
      r.ok,
      true,
      `${label}: toutiao_method_get ${id} → ${JSON.stringify(r).slice(0, 200)}`,
    );
    assert.ok(String(r.text ?? "").trim().length > 50, `${label}: ${id} 内容为空`);
    texts.push(r.text);
    const o = await call(tt, "toutiao_method_get", { id: "原版:" + id });
    assert.equal(o.from, "original", `${label}: 原版:${id}`);
    loaded.toutiao++;
  }

  // 引擎工具面：fanqie_method_list 列两来源并集，fanqie_method_get 逐份读取
  const list = await call(fq, "fanqie_method_list", {});
  assert.equal(typeof list, "string", JSON.stringify(list).slice(0, 300));
  const [profileSection, engineSection = ""] = list.split("## 引擎资产");
  const profileIds = [...profileSection.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
  const engineIds = [...engineSection.matchAll(/^- `([^`]+)`/gm)].map((m) => m[1]);
  assert.ok(profileIds.length >= 17, `${label}: 默认方案目录 ${list.slice(0, 200)}`);
  assert.ok(engineIds.length >= 10, `${label}: 引擎方法资产目录 ${list.slice(0, 200)}`);
  // 原版：每一份都能强制读出原件（附工具对照表）
  const { listMethods } = await import(buildUrl("fanqie/src/forge.js"));
  const forgeIds = await listMethods();
  for (const id of forgeIds) {
    const r = await call(fq, "fanqie_method_get", { ids: "原版:" + id });
    assert.ok(
      r.startsWith(`## 方法 · ${id}（方案「原版」）`),
      `${label}: fanqie_method_get 原版:${id} → ${r.slice(0, 120)}`,
    );
    assert.match(r, /写作 Agent 适配/);
    loaded.forge++;
  }
  // 默认方案：每一份都能读
  for (const id of profileIds) {
    const r = await call(fq, "fanqie_method_get", { ids: id });
    assert.ok(
      r.startsWith(`## 方法 · ${id}（方案「默认」）`),
      `${label}: fanqie_method_get ${id} → ${r.slice(0, 120)}`,
    );
    texts.push(r);
    loaded.fanqieDefault = (loaded.fanqieDefault ?? 0) + 1;
  }
  // 引擎方法资产：逐份加载；方案别名会遮蔽同名引擎 id（plan → templates-plan），两种标题都算命中
  for (const id of engineIds) {
    const r = await call(fq, "fanqie_method_get", { ids: id });
    assert.ok(
      typeof r === "string" && r.length > 80,
      `${label}: fanqie_method_get ${id} → ${String(r).slice(0, 120)}`,
    );
    assert.match(r, /^## 方法(?:资产)? · /, `${label}: fanqie_method_get ${id} 返回形态不符`);
    texts.push(r);
    loaded.engine++;
  }
  assert.match(
    await call(fq, "fanqie_method_get", { ids: "contract:style" }),
    /^## 方法资产 · contract:style · /,
    "契约资产按引擎资产标题返回",
  );
  assert.match(
    await call(fq, "fanqie_method_get", { ids: "plan" }),
    /^## 方法 · templates-plan（方案「默认」）/,
    "方案别名遮蔽同名引擎 id",
  );
  texts.push(
    (await call(fq, "fanqie_method_get", { ids: "原版:" + forgeIds[0] }))
      .split("\n")
      .slice(1, 25)
      .join("\n"),
  );
  texts.push(list);
  return { tt, fq, call, loaded, texts, engineIds, forgeIds, profileIds, toutiaoIds: ids };
}

test("原件对照：头条方法与语料、forge 三件套都完整在包里，并全部登记为可加载", async () => {
  const { METHOD_FILES } = await import(buildUrl("toutiao/src/methods.js"));
  const docs = [
    ...(await files(TOUTIAO_SKILL, ".md")),
    ...(await files(TOUTIAO_SKILL, ".json")),
  ].filter((f) => f !== "CHANGELOG.md");
  const registered = new Set(Object.values(METHOD_FILES));
  assert.deepEqual(
    docs.filter((f) => !registered.has(f)),
    [],
    "头条 skill 里没有登记的方法文件",
  );
  for (const f of registered)
    assert.ok(existsSync(path.join(TOUTIAO_SKILL, f)), `登记了不存在的文件 ${f}`);
  const { listMethods } = await import(buildUrl("fanqie/src/forge.js"));
  const forgeDocs = (await files(FORGE, ".md")).map((f) => f.replace(/\.md$/, ""));
  assert.deepEqual(await listMethods(), forgeDocs);
  for (const pkg of ["inspiration-forge", "inspiration-forge-library", "novel-writer"])
    assert.ok(forgeDocs.includes(`${pkg}/SKILL`), `${pkg} 缺 SKILL`);
  // 原文之间的 Markdown 链接，以及原文里只写相对路径的引用，都能经 方法库读取入口取到
  const { fanqieLibrary } = await import(buildUrl("fanqie/src/forge.js"));
  const { readFile } = await import("node:fs/promises");
  const broken = [];
  for (const id of forgeDocs) {
    const text = await readFile(path.join(FORGE, id + ".md"), "utf8");
    for (const m of text.matchAll(/\]\(([^)#\s]+\.md)\)/g)) {
      const target = path.posix
        .normalize(path.posix.join(path.posix.dirname(id), decodeURIComponent(m[1])))
        .replace(/\.md$/, "");
      if (!forgeDocs.includes(target)) broken.push(`${id} → ${m[1]}`);
    }
  }
  assert.deepEqual(broken, [], "方法原文里的链接指向不存在的文件");
  assert.equal(
    (await fanqieLibrary.readOriginal("references/editor_method.md")).id,
    "novel-writer/references/editor_method",
  );
  assert.equal(
    (await fanqieLibrary.readOriginal("./资产/幕转章纲")).id,
    "inspiration-forge/资产/幕转章纲",
  );
});

test("源码构建：三套方法论每一份都能经工具加载；提到的工具名都存在", async () => {
  const r = await loadEverything("源码");
  assert.ok(
    r.loaded.toutiao >= 30 &&
      r.loaded.forge >= 100 &&
      r.loaded.engine >= 10 &&
      r.loaded.fanqieDefault >= 17,
    JSON.stringify(r.loaded),
  );
  assert.ok(r.profileIds.includes("edit"), "编辑过稿方法可加载");

  // 工具名引用检查
  const names = new Set([...r.tt.tools.keys(), ...r.fq.tools.keys()]);
  const sources = [
    await (await import(buildUrl("toutiao/src/brief.js"))).buildToutiaoBrief(),
    (await import(buildUrl("fanqie/src/brief.js"))).buildFanqieBrief(),
    ...[...r.tt.tools.values(), ...r.fq.tools.values()].map((t) => t.description ?? ""),
    ...r.texts,
  ];
  const productMap = await r.call(r.fq, "fanqie_product_map", {});
  sources.push(typeof productMap === "string" ? productMap : JSON.stringify(productMap));
  const missing = new Set();
  for (const text of sources) {
    for (const m of text.matchAll(/\b((?:fanqie|toutiao)_[a-z][a-z_]*[a-z])\b/g))
      if (!names.has(m[1]) && !/_bridge$/.test(m[1])) missing.add(m[1]);
  }
  assert.deepEqual([...missing], [], "这些工具名被提到却不存在");

  // 规则与说明里点名的方法 id 都能取到
  const all = sources.join("\n");
  const badTt = [
    ...all.matchAll(/\b(s[1-7]-[a-z]+|corpus-[a-z\u4e00-\u9fa5-]+|template-[a-z]+)\b/g),
  ]
    .map((m) => m[1])
    .filter((id) => !r.toutiaoIds.includes(id));
  assert.deepEqual([...new Set(badTt)], [], "头条方法 id 不存在");
  const badForge = [
    ...all.matchAll(
      /\b((?:inspiration-forge-library|inspiration-forge|novel-writer)\/[^\s，。、；：）)'"`*]+)/g,
    ),
  ]
    .map((m) => m[1].replace(/\.md$/, ""))
    .filter((id) => !r.forgeIds.includes(id));
  assert.deepEqual([...new Set(badForge)], [], "forge 方法 id 不存在");
  const badEngine = [...all.matchAll(/fanqie_method_get[^\n]{0,12}?ids?=([a-z_]+)/g)]
    .map((m) => m[1])
    .filter((id) => !r.engineIds.includes(id) && !r.profileIds.includes(id));
  assert.deepEqual([...new Set(badEngine)], [], "fanqie_method_get 点名的方法 id 不存在");
});

test("工具执行结果由生产 output.render 渲染，全部方法内容仍可加载", async () => {
  const { tt, fq } = await enableBoth();
  for (const [harness, name, args] of [
    [tt, "toutiao_method_get", { id: "s3-headline" }],
    [fq, "fanqie_method_get", { ids: "edit" }],
  ]) {
    const result = await harness.execute(name, args);
    // toutiao_method_get 返回对象回执，fanqie_method_get（引擎版）返回字符串
    const text = typeof result.value === "string" ? result.value : result.value.text;
    assert.ok(text.length > 100);
    assert.ok(result.content.some((block) => block.type === "text" && block.text.length > 100));
  }
});
