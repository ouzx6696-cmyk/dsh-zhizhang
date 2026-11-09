import { emptyUsage } from "../../../../packages/core/src/workflow";
import { stageCard } from "./methods";
import { jsonOutput, list, text, record, outline } from "./schema";
import type { WorkflowRun } from "./run";
export async function bookPipeline(run: WorkflowRun) {
  const existingIds = new Set(
    list(
      record(record(record(JSON.parse(run.journal.record.basis)).document).book).chapters,
      "既有章节",
      10000,
    ).map((value) => text(record(value).id, "章节号")),
  );
  const card = await stageCard(run, "fanqie", "plan-foundation");
  const foundation = await run.model(
    "foundation",
    "规划本书",
    "planner",
    card,
    {},
    '返回 {"locks":"不可违背的设定","happened":"已有事实，没有则写无","characters":"人物","readerKnowledge":"读者已知","planned":"全书与卷级路线，每卷高潮及情绪变化","threads":"伏笔","style":"必须贯彻/绝对禁止/按场景调节的文风契约"}。事实与计划分开。',
    (value) => {
      const r = jsonOutput(value);
      return Object.fromEntries(
        ["locks", "happened", "characters", "readerKnowledge", "planned", "threads", "style"].map(
          (key) => [key, text(r[key], key, 10000)],
        ),
      );
    },
  );
  const outlineCard = await stageCard(run, "fanqie", "plan-outline");
  const rolling = await run.model(
    "rolling-outline",
    "滚动规划后续章节",
    "planner",
    outlineCard,
    foundation,
    '只细化未来3至5章；返回 {"chapters":[{"id":"c001","title":"章名","pov":"视角","targetWords":2000,"locks":"约束","knowledge":"知识边界","synopsis":"梗概","conflict":"冲突","beats":"节拍","ending":"落点"}]}。已有章节不重编号。',
    (value) => {
      const rows = list(jsonOutput(value).chapters, "滚动章纲", 5);
      if (rows.length < 3) throw new Error("滚动章纲应包含3至5章");
      const chapters = rows.map((raw) => {
        const r = record(raw),
          id = text(r.id, "章节标识", 64);
        if (!/^[\p{L}\p{N}_-]+$/u.test(id)) throw new Error("章节标识无效");
        if (existingIds.has(id))
          throw new Error("滚动规划必须使用未来未建章节号，不能伪装覆盖已有章纲");
        return { id, ...outline(r) };
      });
      if (new Set(chapters.map((row) => row.id)).size !== chapters.length)
        throw new Error("滚动章纲的章节标识重复");
      return { chapters };
    },
  );
  return run.journal.step(
    "delivery",
    "交付规划方案",
    { parse: record },
    async () => ({
      value: {
        foundation,
        chapters: rolling.chapters,
        note: "规划已保留，作者确认后采用；没有自动覆盖既有根基与章纲",
      },
      usage: emptyUsage(),
    }),
    run.signal,
    0,
  );
}
