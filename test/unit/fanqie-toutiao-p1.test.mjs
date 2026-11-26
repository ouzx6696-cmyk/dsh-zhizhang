import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { renderContextPacket } = await importTs("packages/core/src/pipeline/index.ts");
const { createLockService } = await importTs("packages/core/src/lock/index.ts");
const { createBibleStore } = await importTs("packages/fanqie/src/bible/index.ts");
const { buildChapterContext, retrieveEarlyChapters } = await importTs(
  "packages/fanqie/src/context/index.ts",
);
const { extractClaimCandidates } = await importTs("packages/toutiao/src/domain/index.ts");
const { filterChangedParagraphClaims, mergeFactResults } = await importTs(
  "packages/toutiao/src/pipelines/article/rules.ts",
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

test("R3 (F11): retrieveEarlyChapters invalidates BM25 token cache when equal-length body changes", () => {
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

test("F15: buildChapterContext trims L2/L4 per item under tight budget and reports included cards", () => {
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

test("F19: mergeFactResults downgrades fabricated quotes and filterChangedParagraphClaims detects source changes", () => {
  const draft = "居民消费价格同比上涨1.2%，另一项数据增长5.8%。";
  const claims = extractClaimCandidates(draft);
  const c1 = claims.find((c) => c.text === "1.2%");
  const c2 = claims.find((c) => c.text === "5.8%");
  assert.ok(c1 && c2);
  const { merged } = mergeFactResults(
    [c1, c2],
    {
      claims: [
        {
          id: c1.id,
          status: "supported",
          sourceId: "s1",
          evidence: "居民消费价格同比上涨1.2%",
        },
        {
          id: c2.id,
          status: "supported",
          sourceId: "s1",
          evidence: "模型编造的不存在引文5.8%",
        },
      ],
    },
    [{ id: "s1", text: "国家统计局公布居民消费价格同比上涨1.2%。", hash: "hash-s1-v1" }],
  );
  assert.equal(merged[0].status, "supported");
  assert.equal(merged[0].sourceHash, "hash-s1-v1");
  assert.equal(merged[1].status, "unlocated", "来源中不存在的引文必须降级为 unlocated");

  const reusedCheck = filterChangedParagraphClaims(draft, merged, new Map([["s1", "hash-s1-v1"]]));
  assert.equal(reusedCheck.reused.length, 1);

  const changedCheck = filterChangedParagraphClaims(draft, merged, new Map([["s1", "hash-s1-v2"]]));
  assert.equal(changedCheck.reused.length, 0, "来源内容变化后旧 supported 结论必须重新核对");
  assert.ok(changedCheck.toVerify.length >= 2);
});
