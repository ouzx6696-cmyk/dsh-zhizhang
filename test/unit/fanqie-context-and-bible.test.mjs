import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { createFakeClock } from "../support/clock.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { renderContextPacket } = await importTs("packages/core/src/pipeline/index.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createBibleStore } = await importTs("packages/fanqie/src/bible/index.ts");
const { buildChapterContext, retrieveEarlyChapters } = await importTs(
  "packages/fanqie/src/context/index.ts",
);

test("context packet renders L5 retrieval and L6 reference blocks alongside L0-L4 chapter context", () => {
  const bible = {
    entities: [],
    states: [],
    threads: [],
    knowledge: [],
    chapters: [],
    style: { contract: "", rules: [], voiceSamples: [] },
    pending: [],
  };
  const packet = buildChapterContext({
    chapterId: "ch-20",
    position: 20,
    outlineText: "主角重返旧城。",
    previousSummary: "上一章离开山谷。",
    previousBody: "夜色沉了下来。",
    bible,
    view: { position: 20, entities: [], states: [], threads: [], knowledge: [] },
    hits: [],
    recentSummaries: [{ position: 19, summary: "第19章摘要" }],
    budget: 4000,
    previousTextMode: { kind: "full", maxChars: 4000 },
  });

  packet.suffix.push(
    {
      id: "l5-retrieval",
      layer: 5,
      text: "【远期检索】第3章提到旧城暗门。",
      required: false,
      tokens: 18,
      reason: "关键词检索命中",
      source: { kind: "retrieval", ref: "ch-3" },
    },
    {
      id: "l6-reference",
      layer: 6,
      text: "【参考机制，不复制】双线并行节奏示范。",
      required: false,
      tokens: 20,
      reason: "绑定参考卡",
      source: { kind: "reference", ref: "card-1" },
    },
  );

  const rendered = renderContextPacket(packet);
  assert.ok(rendered.system.includes("上一章离开山谷"));
  assert.ok(rendered.user.includes("主角重返旧城"));
  assert.ok(rendered.user.includes("【远期检索】"));
  assert.ok(rendered.user.includes("【参考机制，不复制】"));
});

test("buildChapterContext natively assembles L5 retrieval and L6 reference blocks when enabled", () => {
  const bible = {
    entities: [],
    states: [],
    threads: [],
    knowledge: [],
    chapters: [],
    style: { contract: "", rules: [], voiceSamples: [] },
    pending: [],
  };
  const packet = buildChapterContext({
    chapterId: "ch-20",
    position: 20,
    outlineText: "主角重返旧城寻找暗门。",
    previousSummary: "上一章离开山谷。",
    previousBody: "夜色沉了下来。",
    bible,
    view: { position: 20, entities: [], states: [], threads: [], knowledge: [] },
    hits: [],
    recentSummaries: [{ position: 19, summary: "第19章摘要" }],
    earlyChapters: [
      { chapter: "ch-3", position: 3, summary: "旧城暗门线索初现", body: "旧城北墙下有一道暗门。" },
    ],
    bookPlan: {
      title: "夜航",
      coreConflict: "旧城秘密",
      currentVolume: { volume: 1, title: "第一卷", summary: "初入旧城" },
    },
    referenceCards: [
      { id: "card-1", title: "双线悬疑", category: "节奏", pattern: "交替推进", usage: "控制悬念" },
    ],
    budget: 8000,
    previousTextMode: { kind: "full", maxChars: 4000 },
  });

  const layers = packet.suffix.map((b) => b.layer);
  assert.ok(layers.includes(5), "Expected L5 retrieval block");
  assert.ok(layers.includes(6), "Expected L6 reference block");
  const rendered = renderContextPacket(packet);
  assert.ok(rendered.user.includes("旧城"));
  assert.ok(rendered.user.includes("参考机制，不复制"));
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

test("buildChapterContext trims L2/L4 per item under tight budget and reports included cards", () => {
  const bible = {
    entities: [],
    states: [],
    threads: [],
    knowledge: [],
    chapters: [],
    style: { contract: "", rules: [], voiceSamples: [] },
    pending: [],
  };
  const includedIds = [];
  const packet = buildChapterContext({
    chapterId: "C010",
    position: 10,
    outlineText: "主角闯入藏经阁。",
    previousSummary: "第9章抵达山门。",
    previousBody: "夜风吹动檐铃。",
    bible,
    view: { position: 10, entities: [], states: [], threads: [], knowledge: [] },
    hits: [],
    recentSummaries: [
      { position: 7, summary: "较早摘要".repeat(25) },
      { position: 8, summary: "中段摘要".repeat(25) },
      { position: 9, summary: "最新前章摘要" },
    ],
    referenceCards: [
      {
        id: "craft-1",
        scope: "chapter",
        title: "短卡",
        category: "节奏",
        pattern: "快切镜头",
        usage: "开篇",
      },
      {
        id: "craft-2",
        scope: "chapter",
        title: "超长卡",
        category: "情绪",
        pattern: "超长说明".repeat(200),
        usage: "高潮",
      },
    ],
    onIncludedCards: (ids) => includedIds.push(...ids),
    budget: 340,
    previousTextMode: { kind: "full", maxChars: 200 },
  });

  const rendered = renderContextPacket(packet);
  assert.ok(rendered.user.includes("最新前章摘要"), "应优先保留最近一章摘要");
  assert.deepEqual(includedIds, ["craft-1"], "应只记录真正注入上下文的技法卡 ID");
});

test("retrieveEarlyChapters invalidates BM25 token cache when equal-length body changes", () => {
  const docV1 = {
    chapter: "C003",
    position: 3,
    summary: "旧城线索",
    body: "主角在旧城北门捡到一枚普通铜钱。",
  };
  const docV2 = {
    chapter: "C003",
    position: 3,
    summary: "旧城线索",
    body: "主角在旧城北门捡到一枚玄铁令牌。",
  };
  assert.equal(docV1.body.length, docV2.body.length);

  const hits1 = retrieveEarlyChapters("寻找玄铁令牌", [docV1], 3);
  assert.equal(hits1.length, 0);
  const hits2 = retrieveEarlyChapters("寻找玄铁令牌", [docV2], 3);
  assert.equal(hits2.length, 1);
  assert.equal(hits2[0].doc.chapter, "C003");
});

test("bible audit reports due_unpaid and forgotten_thread findings", () => {
  const store = createBibleStore(createLockService());
  const bible = {
    entities: [],
    states: [
      {
        id: "st-1",
        entity: "hero",
        field: "位置",
        value: "京城",
        since: 1,
        until: 10,
        mode: "replace",
        status: "confirmed",
        provenance: { source: "author", at: "2026-11-14T00:00:00Z" },
      },
      {
        id: "st-2",
        entity: "hero",
        field: "位置",
        value: "江南",
        since: 5,
        mode: "replace",
        status: "confirmed",
        provenance: { source: "author", at: "2026-11-14T00:00:00Z" },
      },
    ],
    threads: [
      {
        id: "th-due",
        title: "玉佩身世",
        kind: "mystery",
        opened: 1,
        plannedPayoff: 10,
        beats: [{ chapter: 1, kind: "plant", note: "初见玉佩" }],
        status: "open",
      },
      {
        id: "th-old",
        title: "断剑来历",
        kind: "foreshadow",
        opened: 2,
        beats: [{ chapter: 2, kind: "plant", note: "拾得断剑" }],
        status: "open",
      },
    ],
    knowledge: [],
    chapters: [],
    style: { contract: "", rules: [], voiceSamples: [] },
    pending: [],
  };

  const findings = store.audit(bible, 15);
  assert.ok(findings.some((f) => f.kind === "due_unpaid" && f.refId === "th-due"));
  assert.ok(findings.some((f) => f.kind === "forgotten_thread" && f.refId === "th-old"));
});

test("bible audit detects overlapping state_conflict entries", () => {
  const store = createBibleStore(createLockService());
  const bible = {
    entities: [],
    states: [
      {
        id: "st-1",
        entity: "hero",
        field: "位置",
        value: "京城",
        since: 1,
        until: 10,
        mode: "replace",
        status: "confirmed",
        provenance: { source: "author", at: "2026-11-14T00:00:00Z" },
      },
      {
        id: "st-2",
        entity: "hero",
        field: "位置",
        value: "江南",
        since: 5,
        mode: "replace",
        status: "confirmed",
        provenance: { source: "author", at: "2026-11-14T00:00:00Z" },
      },
    ],
    threads: [],
    knowledge: [],
    chapters: [],
    style: { contract: "", rules: [], voiceSamples: [] },
    pending: [],
  };

  const findings = store.audit(bible, 15);
  assert.ok(
    findings.some((f) => f.kind === "state_conflict"),
    "Expected state_conflict finding",
  );
});

test("BibleStore 索引化审计检出遗忘伏笔、超期爽点、认知越界与状态冲突，并在写入后自动失效读缓存", async () => {
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-bible-audit-"));
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

    const firstRead = await store.read(dir);
    assert.equal(firstRead.entities.length, 1);

    const issues = store.audit(firstRead, 12);
    const kinds = new Set(issues.map((i) => i.kind));
    assert.ok(kinds.has("due_unpaid"), "应检出超期未兑现伏笔");
    assert.ok(kinds.has("forgotten_thread"), "应检出跨 10 章未推进伏笔");
    assert.ok(kinds.has("knowledge_leak"), "应检出角色认知越界");
    assert.ok(kinds.has("state_conflict"), "应检出同时间段状态冲突");

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
