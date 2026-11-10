import {
  PURSUIT_OUTLINE_SHAPE,
  parseUnitPlans,
} from "../../../../packages/fanqie/src/engine/domain/pursuit";
import { emptyUsage } from "../../../../packages/core/src/workflow";
import { stageCard } from "./methods";
import { jsonOutput, list, text, record, outline } from "./schema";
import type { WorkflowRun } from "./run";
export async function bookPipeline(run: WorkflowRun) {
  const enabled = run.host.options.fanqie?.pursuit?.enabled === true;
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
  const units = enabled
    ? await run.model(
        "units",
        "规划当前与下一单元",
        "planner",
        card,
        foundation,
        '只规划当前和紧接的下一单元，不铺满全书。返回 {"units":[{"id":"u001","title":"单元名","from":1,"to":20,"question":"核心问题","payoffs":["兑现清单"],"settlement":"收束结算","next":"引向下一单元的伏笔"}]}。章序为全书章序，两个单元范围连续不重叠；结合已发生事实和作者要求。',
        (value) => {
          const result = parseUnitPlans(jsonOutput(value).units);
          if (
            result[0].from > run.context.chapterPosition ||
            result[0].to < run.context.chapterPosition
          )
            throw new Error("当前单元没有覆盖待规划章序");
          return result;
        },
      )
    : undefined;
  const outlineCard = await stageCard(run, "fanqie", "plan-outline");
  const rolling = await run.model(
    "rolling-outline",
    "滚动规划后续章节",
    "planner",
    outlineCard,
    units === undefined ? foundation : { foundation, units },
    '只细化未来3至5章；返回 {"chapters":[{"id":"c001","title":"章名","pov":"视角","targetWords":2000,"locks":"约束","knowledge":"知识边界","synopsis":"梗概","conflict":"冲突","beats":"节拍","ending":"落点"}]}。已有章节不重编号。' +
      (enabled ? PURSUIT_OUTLINE_SHAPE : ""),
    (value) => {
      const rows = list(jsonOutput(value).chapters, "滚动章纲", 5);
      if (rows.length < 3) throw new Error("滚动章纲应包含3至5章");
      const chapters = rows.map((raw, index) => {
        const r = record(raw),
          id = text(r.id, "章节标识", 64);
        if (!/^[\p{L}\p{N}_-]+$/u.test(id)) throw new Error("章节标识无效");
        if (existingIds.has(id))
          throw new Error("滚动规划必须使用未来未建章节号，不能伪装覆盖已有章纲");
        const plan = outline(r, enabled);
        if (units !== undefined) {
          const unit = units.find((unit) => unit.id === plan.unit);
          const position = run.context.chapterPosition + index;
          if (
            unit === undefined ||
            position < unit.from ||
            position > unit.to ||
            plan.unitPos !== position - unit.from + 1
          )
            throw new Error("章纲单元或单元内章序与规划范围不一致");
        }
        return { id, ...plan };
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
        ...(units === undefined ? {} : { units }),
        chapters: rolling.chapters,
        note: "规划已保留，作者确认后采用；没有自动覆盖既有根基与章纲",
      },
      usage: emptyUsage(),
    }),
    run.signal,
    0,
  );
}
