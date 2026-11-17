import assert from "node:assert/strict";
import test from "node:test";
import { workspace } from "../support/v14.mjs";
import { importTs } from "../support/ts-loader.mjs";

const { proposeBookPlan } = await importTs("packages/fanqie/src/pipelines/book/proposal.ts");

test("全书规划提案 → 同批确认会保存书卡、主线冲突和分卷章纲", async (t) => {
  const { work, locks, store, library } = await workspace(t);
  const result = await proposeBookPlan(
    work,
    "book-run-1",
    {
      card: {
        title: "星河守夜人",
        genre: "幻想",
        hook: "一位守夜人追踪失落的星火。",
        sellingPoints: ["伙伴冒险", "古代谜团"],
        targetAudience: "喜欢冒险故事的读者",
      },
      foundation: {
        protagonist: {
          name: "林川",
          goal: "寻找失落星火",
          flaw: "不信任他人",
          goldenFinger: "听见星火回声",
        },
        worldview: "群星在夜空中迁徙。",
        powerSystem: "星火共鸣",
        coreConflict: "守夜人必须决定是否点燃最后一颗星。",
      },
      structure: {
        volumes: [
          {
            volume: 1,
            title: "失落之光",
            summary: "寻找第一枚星火。",
            startChapter: 1,
            endChapter: 1,
          },
        ],
      },
      outline: {
        chapters: [
          {
            position: 1,
            title: "夜航",
            synopsis: "林川收到星火来信。",
            conflict: "守夜人阻拦他。",
            hook: "星火回应。",
          },
        ],
      },
      outlineCount: 1,
    },
    locks,
  );
  const batchId = result.writtenPlanFiles[0]
      .split("/")
      .at(-1)
      .replace(/\.json$/, ""),
    batch = await library.readPendingBatch(work, batchId),
    bookItem = batch.items.find((item) => item.op.type === "book.update");
  assert.ok(bookItem);
  assert.equal(bookItem.op.patch.title, "星河守夜人");
  assert.equal(bookItem.op.patch.logline, "一位守夜人追踪失落的星火。");
  assert.equal(bookItem.op.patch.coreConflict, "守夜人必须决定是否点燃最后一颗星。");
  assert.deepEqual(bookItem.op.patch.sellingPoints, ["伙伴冒险", "古代谜团"]);
  assert.equal(bookItem.decision, "undecided");

  await library.decide(
    work,
    batchId,
    batch.items.map((item) => ({ id: item.id, decision: "accept" })),
  );
  const index = await (await import("../support/v14.mjs")).bible.readBibleIndex(work);
  await library.commit(work, batchId, index.files);
  const outline = await store.get(work);
  assert.equal(outline.book.title, "星河守夜人");
  assert.equal(outline.book.logline, "一位守夜人追踪失落的星火。");
  assert.equal(outline.book.coreConflict, "守夜人必须决定是否点燃最后一颗星。");
  assert.equal(outline.nodes.find((node) => node.level === "chapter")?.title, "夜航");
});
