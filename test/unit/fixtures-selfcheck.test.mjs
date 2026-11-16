import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";
import { createFakeModelPort } from "../support/fake-port.mjs";
import { createFakeRouter } from "../support/fake-router.mjs";
import { matchProposals } from "../support/proposal-match.mjs";

const root = fileURLToPath(new URL("../../", import.meta.url));
const importRoot = path.join(root, "test", "fixtures", "import");
const samples = [
  { id: "s1-volumes", source: "source.txt", encoding: "gb18030" },
  { id: "s2-bible", source: "source.md", encoding: "utf-8" },
  { id: "s3-mixed", source: "source.txt", encoding: "utf-16le" },
];

async function json(file) {
  return JSON.parse(await readFile(file, "utf8"));
}

async function sampleData(sample) {
  const dir = path.join(importRoot, sample.id);
  const bytes = await readFile(path.join(dir, sample.source));
  const text = new TextDecoder(sample.encoding).decode(bytes);
  return {
    dir,
    bytes,
    text,
    expected: await json(path.join(dir, "expected.json")),
    docmap: await json(path.join(dir, "docmap.json")),
    response: await json(path.join(dir, "responses", "extract-1.json")),
  };
}

function paragraphMap(text, docmap) {
  const headings = new Map(docmap.sections.map((section) => [section.note, section.id]));
  const paragraphs = new Map();
  let section;
  let count = 0;
  let afterHeading = false;
  for (const line of text.split("\n")) {
    if (headings.has(line)) {
      section = headings.get(line);
      count = 0;
      afterHeading = true;
      continue;
    }
    if (afterHeading && /^(?:=+|-+)$/.test(line)) {
      afterHeading = false;
      continue;
    }
    afterHeading = false;
    if (!section || !line.trim()) continue;
    count += 1;
    paragraphs.set(`P${section.slice(1)}.${count}`, line);
  }
  return paragraphs;
}

function nonspaceLength(text) {
  return text.replace(/\s/gu, "").length;
}

test("S1 按 GB18030 解码 → 含第一卷、无替换字符且结构完整", async () => {
  const { bytes, text, expected, docmap } = await sampleData(samples[0]);
  assert.equal(new TextDecoder("gb18030").decode(bytes).includes("第一卷"), true);
  assert.equal(text.includes("�"), false);
  assert.ok(nonspaceLength(text) >= 20000 && nonspaceLength(text) <= 30000);
  const counts = expected.items.reduce(
    (all, item) => ({ ...all, [item.type]: (all[item.type] ?? 0) + 1 }),
    {},
  );
  assert.equal(counts.volume, 3);
  assert.equal(counts.act, 9);
  assert.equal(counts.chapter, 60);
  assert.equal(counts.thread, 2);
  assert.equal((text.match(/伏笔埋设：/g) ?? []).length, 2);
  assert.equal((text.match(/伏笔回收：/g) ?? []).length, 2);
  const paragraphs = paragraphMap(text, docmap);
  assert.ok([...paragraphs.values()].some((line) => line.length > 8000));
});

test("S2 / S3 编码、字数与全部混排陷阱 → 均符合夹具说明", async () => {
  const s2 = await sampleData(samples[1]);
  assert.equal(s2.bytes[0] === 0xef && s2.bytes[1] === 0xbb && s2.bytes[2] === 0xbf, false);
  assert.ok(nonspaceLength(s2.text) >= 20000 && nonspaceLength(s2.text) <= 30000);
  assert.match(s2.text, /^---\ntitle:/u);
  assert.match(s2.text, /势力\n====/u);
  assert.match(s2.text, /地点\n----/u);
  assert.equal(
    s2.expected.items.filter((item) => item.type === "state" && item.fields.since === 30).length,
    3,
  );
  assert.equal(s2.expected.items.filter((item) => item.type === "knowledge").length, 2);
  assert.equal(
    s2.expected.items.reduce((n, item) => n + (item.fields.relations?.length ?? 0), 0),
    6,
  );

  const s3 = await sampleData(samples[2]);
  assert.equal(s3.bytes[0], 0xff);
  assert.equal(s3.bytes[1], 0xfe);
  assert.ok(nonspaceLength(s3.text) >= 20000 && nonspaceLength(s3.text) <= 30000);
  for (const marker of [
    "一、",
    "（一）",
    "1.1",
    "①",
    "【",
    "〔",
    "【写作随想】",
    "陈执事 ↔ 陈烈",
  ]) {
    assert.ok(s3.text.includes(marker), marker);
  }
  assert.equal((s3.text.match(/李长老：/g) ?? []).length, 2);
  assert.deepEqual(s3.expected.mustNot, [{ type: "entity", name: "写作随想" }]);
});

test("expected.json 每条 src 与 quote → 都能在对应原始段落中逐字定位", async () => {
  for (const sample of samples) {
    const { text, expected, docmap } = await sampleData(sample);
    const paragraphs = paragraphMap(text, docmap);
    for (const item of expected.items) {
      assert.ok(item.quote.length <= 40, `${sample.id}: quote too long`);
      assert.ok(item.src.length >= 1 && item.src.length <= 20);
      for (const ref of item.src) {
        const paragraph = paragraphs.get(ref);
        assert.ok(paragraph, `${sample.id}: missing ${ref}`);
        assert.ok(
          paragraph.includes(item.quote),
          `${sample.id}: ${ref} does not contain ${item.quote}`,
        );
      }
    }
  }
});

test("ExtractResult 响应 → 符合 F2 基础约束且三份样例达到匹配与定位阈值", async () => {
  for (const sample of samples) {
    const { text, expected, response } = await sampleData(sample);
    const result = JSON.parse(response.text);
    assert.ok(Array.isArray(result.items) && result.items.length <= 80);
    assert.ok(Array.isArray(result.unassigned));
    const mismatches = [];
    result.items.forEach((item, index) => {
      for (const key of ["tmp", "type", "src", "quote", "confidence"])
        assert.ok(key in item, `${sample.id}: ${key}`);
      assert.ok(item.quote.length <= 40);
      if (item.quote !== expected.items[index].quote) mismatches.push(index);
      item.located = text.includes(item.quote)
        ? "exact"
        : index === mismatches[0]
          ? "fuzzy"
          : false;
    });
    assert.equal(mismatches.length, sample.id === "s3-mixed" ? 2 : 0);
    const match = matchProposals(expected, { items: result.items });
    assert.equal(match.matchRate, 1, sample.id);
    assert.equal(match.falsePositiveRate, 0, sample.id);
    assert.ok(match.locatedRate >= 0.9, `${sample.id}: ${match.locatedRate}`);
    assert.equal(match.passed, true, sample.id);
  }
});

test("fake-router → 引擎与桌面共用 docmap / 块号响应", async () => {
  const dir = path.join(importRoot, "s1-volumes");
  const router = createFakeRouter(dir);
  const port = createFakeModelPort(router, { repeatLast: true });
  const docmap = await port.stream({ user: "【阶段】docmap" });
  assert.equal(JSON.parse(docmap.text).editedByAuthor, false);
  const extract = await port.stream({ user: "【阶段】extract\n【本块位置】… 第 1/1 块" });
  assert.equal(JSON.parse(extract.text).items.length, 74);
  const desktop = await router.respond({ messages: [{ role: "user", content: "【阶段】docmap" }] });
  assert.equal(JSON.parse(desktop.text).mapping.chapter, "第X章");
});

test("fake-router → 记账第 j 组分派到对应 extract 响应", async () => {
  const router = createFakeRouter(path.join(root, "test", "fixtures", "ledger"));
  const port = createFakeModelPort(router, { repeatLast: true });
  const result = await port.stream({ user: "【阶段】extract\n第 1 组" });
  const deltas = JSON.parse(result.text);
  assert.equal(deltas.length, 6);
  assert.equal(deltas.find((delta) => delta.type === "entity.new").name, "唐小满");
});

test("fake-router → .1/.2 按次序先坏后好，桌面映射 429", async (t) => {
  const tempRoot = path.join(root, ".cache", "tmp");
  await mkdir(tempRoot, { recursive: true });
  const dir = await mkdtemp(path.join(tempRoot, "fake-router-"));
  t.after(() => rm(dir, { recursive: true, force: true }));
  await mkdir(path.join(dir, "responses"), { recursive: true });
  await writeFile(
    path.join(dir, "responses", "docmap.1.json"),
    JSON.stringify({ error: { code: "model.rate_limited" } }),
  );
  await writeFile(path.join(dir, "responses", "docmap.2.json"), JSON.stringify({ text: "恢复" }));
  const port = createFakeModelPort(createFakeRouter(dir), { repeatLast: true });
  await assert.rejects(
    port.stream({ user: "【阶段】docmap" }),
    (error) => error.code === "model.rate_limited",
  );
  assert.equal((await port.stream({ user: "【阶段】docmap" })).text, "恢复");
  const desktop = createFakeRouter(dir);
  assert.deepEqual(await desktop.respond({}, "【阶段】docmap"), {
    status: 429,
    error: "model.rate_limited",
  });
  assert.deepEqual(await desktop.respond({}, "【阶段】docmap"), { text: "恢复" });
});

test("五种小编码夹具 → 1–4 KB、指定编码解码且无替换字符", async () => {
  const cases = [
    ["utf8-bom.bin", "utf-8", "晨光"],
    ["utf16be.bin", "utf-16be", "北岸灯塔"],
    ["big5.bin", "big5", "燈火"],
    ["gb18030-rare.bin", "gb18030", "龘"],
    ["ascii.bin", "utf-8", "plain ASCII"],
  ];
  for (const [name, encoding, marker] of cases) {
    const bytes = await readFile(path.join(root, "test", "fixtures", "text", name));
    assert.ok(bytes.length >= 1024 && bytes.length <= 4096, `${name}: ${bytes.length}`);
    const text = new TextDecoder(encoding).decode(bytes);
    assert.ok(text.includes(marker), name);
    assert.equal(text.includes("�"), false, name);
  }
});

test("五章记账夹具 → 2000–3000 字、delta 引文逐字且响应一致", async () => {
  const kinds = new Set();
  for (let chapter = 1; chapter <= 5; chapter += 1) {
    const id = `chapter-${String(chapter).padStart(2, "0")}`;
    const text = await readFile(path.join(root, "test", "fixtures", "ledger", `${id}.txt`), "utf8");
    assert.ok(nonspaceLength(text) >= 2000 && nonspaceLength(text) <= 3000, id);
    const expected = await json(
      path.join(root, "test", "fixtures", "ledger", "expected", `${id}.json`),
    );
    const response = await json(
      path.join(root, "test", "fixtures", "ledger", "responses", `extract-${chapter}.json`),
    );
    assert.deepEqual(JSON.parse(response.text), expected.items);
    for (const delta of expected.items) {
      kinds.add(delta.type);
      assert.ok(text.includes(delta.quote), `${id}: ${delta.type}`);
    }
  }
  for (const kind of ["state", "thread.push", "entity.new", "knowledge", "fact", "record"])
    assert.ok(kinds.has(kind), kind);
});
