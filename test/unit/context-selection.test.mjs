import assert from "node:assert/strict";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";
import { core } from "../support/v14.mjs";
const { buildChapterContext } = await importTs("packages/fanqie/src/context/index.ts"),
  { estimateTokensRaw } = await importTs("packages/core/src/model/estimate.ts");
const entity = {
  id: "ent-1",
  kind: "character",
  name: "林川",
  summary: "守灯人",
  aliases: [],
  locked: ["不说谎"],
  provenance: { source: "author", at: "now" },
  rev: 0,
};
const otherEntity = {
  ...entity,
  id: "ent-2",
  name: "沈砚",
  summary: "巡夜人",
};
function input() {
  return {
    chapterId: "ch-1",
    position: 3,
    outlineText: "林川找到铜哨",
    previousBody: "前".repeat(5000),
    requiredEntityIds: [entity.id],
    bible: {
      format: "zhizhang/1.3",
      entities: [entity],
      states: [],
      threads: [],
      knowledge: [],
      timeline: [],
      style: { contract: "", rules: [], voiceSamples: [] },
    },
    view: {
      position: 3,
      states: [
        { entity: "ent-1", facet: "relation", field: "信任", target: "ent-2", value: "互信" },
      ],
      recentFacts: [
        { id: "fact-recent", text: "两人找到铜哨", entities: ["ent-1"], position: 2 },
        { id: "fact-unrelated", text: "不相关的城门关闭", entities: ["other"], position: 2 },
      ],
      knowledge: [
        { holder: "ent-1", fact: "密道", level: "不知" },
        { holder: "other", fact: "不应出现", level: "知情" },
      ],
      threads: [],
    },
    hits: [
      { entity, count: 1, firstIndex: 0, matchedTerm: "林川" },
      { entity: otherEntity, count: 1, firstIndex: 0, matchedTerm: "沈砚" },
    ],
    recentSummaries: [],
    budget: 24000,
    previousTextMode: { kind: "tail", chars: 1500 },
  };
}
test("点名人物、知情边界、前章尾部 → 必带且只带在场持有人的知识", () => {
  const packet = buildChapterContext(input()),
    blocks = [...packet.prefix, ...packet.suffix];
  assert.ok(blocks.find((b) => b.id === "l2-required").required);
  const text = blocks.map((b) => b.text).join("\n");
  assert.ok(text.includes("不说谎") && text.includes("密道"));
  assert.ok(text.includes("两人找到铜哨") && text.includes("林川 信任 沈砚"));
  assert.ok(!text.includes("不相关的城门关闭"));
  assert.ok(!text.includes("不应出现"));
  assert.equal(
    blocks.find((b) => b.id === "l1-continuity").text.split("【前文】\n")[1],
    "前".repeat(1500),
  );
});
test("必带内容超过预算 → context_overflow，不能静默删章纲", () => {
  assert.throws(
    () => buildChapterContext({ ...input(), budget: 1100 }),
    (error) => error.code === "model.context_overflow",
  );
});
test("阶段方法和输出格式占用余量 → 可选块裁掉，原 packet 不变且必带保留", () => {
  const packet = buildChapterContext({
      ...input(),
      previousBody: "",
      recentSummaries: [{ position: 1, summary: "回顾".repeat(100) }],
    }),
    before = structuredClone(packet);
  const fitted = core.fitContext(packet, 1800, "方法".repeat(100), "输入", "JSON"),
    avail =
      1800 - estimateTokensRaw(["方法".repeat(100), "输入", "JSON"].join("\n\n")) - packet.reserve;
  assert.deepEqual(packet, before);
  assert.ok([...fitted.prefix, ...fitted.suffix].some((b) => b.id === "l0-task" && b.required));
  const optionalL2 = [...fitted.prefix, ...fitted.suffix]
    .filter((block) => block.layer === 2 && !block.required)
    .reduce((sum, block) => sum + estimateTokensRaw(block.text), 0);
  assert.ok(optionalL2 <= avail * 0.25);
  assert.ok(fitted.omitted.some((b) => b.id === "l4-recent"));
});

test("早期章节检索读取正文片段，并把命中带入 L5", () => {
  const packet = buildChapterContext({
    ...input(),
    position: 20,
    outlineText: "找回铜哨",
    earlyChapters: [
      { chapter: "ch-old", position: 2, summary: "走过回廊", body: "铜哨藏在回廊尽头的木箱里。" },
    ],
  });
  const l5 = [...packet.prefix, ...packet.suffix].find((block) => block.id === "l5-retrieval");
  assert.ok(l5);
  assert.match(l5.text, /铜哨藏在回廊尽头/u);
});
