import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createBibleStore } = await importTs("packages/fanqie/src/bible/index.ts");
const { buildChapterContext } = await importTs("packages/fanqie/src/context/index.ts");
const { createNodeDraftBackend, readDraftFile, writeDraftFile } = await importTs(
  "packages/workbench/src/editor/index.ts",
);
const desk = await importBundle("test/support/desktop-entry.ts");

test("decodeSourceBytes 正确解码 UTF-8 与 GBK/GB18030 字节流", () => {
  const utf8 = Buffer.from("县城菜市场的账本记录", "utf8");
  assert.equal(desk.decodeSourceBytes(utf8, "text/html; charset=utf-8"), "县城菜市场的账本记录");

  // "你好" 的 GBK 编码为 0xC4 0xE3 0xBA 0xC3
  const gbkBytes = Buffer.from([0xc4, 0xe3, 0xba, 0xc3]);
  assert.equal(desk.decodeSourceBytes(gbkBytes, "text/html; charset=gb2312"), "你好");
  // 无声明 charset 时 UTF-8 fatal 失败后回退到 gb18030
  assert.equal(desk.decodeSourceBytes(gbkBytes, "text/html"), "你好");
});

test("extractReadableText 剔除导航与脚本噪音并保留段落换行与 HTML 实体", () => {
  const html = `
    <html>
      <head><style>.nav{display:none}</style><script>alert("noise")</script></head>
      <body>
        <nav><a href="/">首页</a></nav>
        <article>
          <h1>菜场三笔账</h1>
          <p>第一段&ldquo;成本&rdquo;核算&amp;对比。</p>
          <p>第二段换行<br/>继续说明&#65;。</p>
        </article>
        <footer>版权声明</footer>
      </body>
    </html>
  `;
  const text = desk.extractReadableText(html);
  assert.equal(text, "菜场三笔账\n第一段“成本”核算&对比。\n第二段换行\n继续说明A。");
});

test("buildChapterContext 严格遵循预算上限并把超预算的可选块记录到 omitted", () => {
  const prov = { source: "author", at: "2026-01-01T00:00:00.000Z" };
  const hero = {
    id: "e-hero",
    kind: "character",
    name: "沈砚",
    aliases: ["砚哥"],
    summary: "药铺学徒，擅以铜铃辨煞。".repeat(20),
    locked: ["左手虎口有旧疤"],
    provenance: prov,
  };
  const bible = {
    entities: [hero],
    states: [
      {
        id: "st-1",
        entity: "e-hero",
        field: "状态",
        value: "轻伤未愈，携铜铃在身".repeat(12),
        since: 2,
        mode: "replace",
        status: "confirmed",
        provenance: prov,
      },
    ],
    threads: [
      {
        id: "t-1",
        title: "古井封煞旧案",
        kind: "mystery",
        opened: 1,
        beats: [
          { chapter: 1, kind: "plant", note: "百年前州府封井的真正原因尚未揭晓。".repeat(8) },
        ],
        status: "open",
      },
    ],
    knowledge: [],
    chapters: [],
    style: { contract: "克制凝练", rules: [], voiceSamples: [] },
    pending: [],
  };

  const packet = buildChapterContext({
    chapterId: "ch-005",
    position: 5,
    outlineText: "第五章细纲：沈砚夜探青崖古井，核对铜铃与账簿。",
    previousBody: "第四章结尾正文内容。".repeat(8),
    bible,
    view: {
      position: 5,
      entities: bible.entities,
      states: bible.states,
      threads: bible.threads,
      knowledge: bible.knowledge,
    },
    hits: [{ entity: hero, count: 2, firstIndex: 0, matchedTerm: "沈砚" }],
    recentSummaries: [
      { position: 2, summary: "第二章摘要内容。".repeat(15) },
      { position: 3, summary: "第三章摘要内容。".repeat(15) },
      { position: 4, summary: "第四章摘要内容。".repeat(15) },
    ],
    earlyChapters: [
      { chapter: "ch-001", position: 1, summary: "沈砚雨夜初闻青崖古井铜铃声。".repeat(12) },
    ],
    bookPlan: {
      title: "云海闻铃",
      coreConflict: "镇妖失衡与旧案掩盖".repeat(8),
    },
    budget: 260,
    previousTextMode: { kind: "full", maxChars: 2000 },
  });

  assert.ok(packet.estimate <= 260, `预期 estimate <= 260，实际 ${packet.estimate}`);
  assert.ok(packet.omitted.length > 0, "超预算的可选块应进入 omitted 列表");
  assert.ok(
    packet.suffix.some((b) => b.source.kind === "outline"),
    "本章细纲应保留在 suffix 中",
  );
});

test("BibleStore 索引化审计检出遗忘伏笔、超期爽点、认知越界与状态冲突，并在写入后自动失效读缓存", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v21-bible-audit-"));
  try {
    const clock = createFakeClock();
    const lock = createLockService(clock);
    const store = createBibleStore(lock, clock);
    const prov = { source: "author", at: clock.iso() };

    const proposals = await store.propose(
      dir,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "e-1",
            kind: "character",
            name: "顾清",
            aliases: [],
            summary: "县衙主簿",
            locked: [],
            provenance: prov,
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-1",
            title: "密信去向",
            kind: "foreshadow",
            opened: 1,
            plannedPayoff: 5,
            beats: [{ chapter: 1, kind: "plant", note: "失踪的州府密信" }],
            status: "open",
          },
        },
        {
          type: "thread.upsert",
          thread: {
            id: "th-2",
            title: "玉佩暗纹",
            kind: "mystery",
            opened: 1,
            beats: [{ chapter: 1, kind: "plant", note: "半块玉佩的来历" }],
            status: "open",
          },
        },
        {
          type: "knowledge.set",
          row: {
            id: "k-1",
            fact: "密信藏在城隍庙",
            holder: "e-1",
            level: "不知",
            since: 3,
          },
        },
        {
          type: "chapter.record",
          record: {
            chapter: "ch-012",
            position: 12,
            revision: "rev-12",
            summary: "顾清直接指出密信藏在城隍庙",
            handoff: { ending: "夜雨渐停", openQuestions: [], positions: {}, carried: [] },
            hook: "庙门微开",
            emotion: "紧张",
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-a",
            entity: "e-1",
            field: "伤势",
            value: "重伤昏迷",
            since: 8,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
          },
        },
        {
          type: "state.add",
          entry: {
            id: "st-b",
            entity: "e-1",
            field: "伤势",
            value: "安然无恙",
            since: 8,
            mode: "replace",
            status: "confirmed",
            provenance: prov,
          },
        },
      ],
      prov,
    );

    for (const p of proposals) {
      await store.decide(dir, p.id, "accept");
    }

    // 首次读取命中磁盘并填充缓存
    const firstRead = await store.read(dir);
    assert.equal(firstRead.entities.length, 1);

    const issues = store.audit(firstRead, 12);
    const kinds = new Set(issues.map((i) => i.kind));
    assert.ok(kinds.has("due_unpaid"), "应检出超期未兑现伏笔");
    assert.ok(kinds.has("forgotten_thread"), "应检出跨 10 章未推进伏笔");
    assert.ok(kinds.has("knowledge_leak"), "应检出角色认知越界");
    assert.ok(kinds.has("state_conflict"), "应检出同时间段状态冲突");

    // 再次写入新实体，验证读缓存不会返回旧数据
    const more = await store.propose(
      dir,
      [
        {
          type: "entity.upsert",
          entity: {
            id: "e-2",
            kind: "place",
            name: "青崖渡口",
            aliases: [],
            summary: "旧渡口",
            locked: [],
            provenance: prov,
          },
        },
      ],
      prov,
    );
    await store.decide(dir, more[0].id, "accept");
    const secondRead = await store.read(dir);
    assert.equal(secondRead.entities.length, 2);
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});

test("workbench Node 后端以原子写入保存草稿且 writeDraftFile 支持可注入时钟", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zz-v21-draft-"));
  try {
    const backend = createNodeDraftBackend();
    const fixedClock = () => 1700000000000;

    const savedAt = await writeDraftFile(dir, "ch-001", "第一章初稿", "rev-0", backend, fixedClock);
    assert.equal(savedAt, 1700000000000);

    const loaded = await readDraftFile(dir, "ch-001", backend);
    assert.ok(loaded !== null);
    assert.equal(loaded.text, "第一章初稿");
    assert.equal(loaded.baseRevision, "rev-0");
    assert.equal(loaded.savedAt, 1700000000000);

    // 确认 .zhizhang/drafts 下无残留 .tmp 文件
    const files = await fs.readdir(path.join(dir, ".zhizhang", "drafts"));
    assert.equal(
      files.some((name) => name.endsWith(".tmp")),
      false,
    );
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
