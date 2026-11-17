import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { renderContextPacket } = await importTs("packages/core/src/pipeline/index.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createBibleStore } = await importTs("packages/fanqie/src/bible/index.ts");
const { buildChapterContext } = await importTs("packages/fanqie/src/context/index.ts");
const { extractClaimCandidates } = await importTs("packages/toutiao/src/domain/index.ts");

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

test("bible audit reports thread_overdue and thread_forgotten findings", () => {
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
  assert.ok(findings.some((f) => f.kind === "thread_overdue" && f.refId === "th-due"));
  assert.ok(findings.some((f) => f.kind === "thread_forgotten" && f.refId === "th-old"));
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

test("toutiao extractClaimCandidates extracts numeric and quoted claims", () => {
  const draft = [
    "2026年10月15日，国家统计局公布居民消费价格同比上涨1.2%。",
    "“这一政策将在年底前全面落地。”一位负责人表示。",
  ].join("\n");

  const claims = extractClaimCandidates(draft);
  assert.ok(claims.some((c) => c.kind === "number" && c.text === "1.2%"));
  assert.ok(
    claims.some((c) => c.kind === "quote" && c.text.includes("这一政策将在年底前全面落地")),
  );
});

test("toutiao extractClaimCandidates extracts date and organization entity claims", () => {
  const draft = "2026年10月15日，国家统计局公布居民消费价格同比上涨1.2%。";
  const claims = extractClaimCandidates(draft);
  assert.ok(claims.some((c) => c.kind === "date" && c.text.includes("2026年10月15日")));
  assert.ok(claims.some((c) => c.kind === "entity" && c.text.includes("国家统计局")));
});
