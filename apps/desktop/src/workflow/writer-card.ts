import { stageCard } from "./methods";
import type { WorkflowRun } from "./run";

const BEATS =
  "章内节拍：接前章最后一拍，回顾不超过两句；按因果安排2–3场，中段有推进、反转或代价。兑现后写旁观者的具体反应，300字内带出新麻烦。新设定尽量不超过3个并挂在动作上。章末落在具体人事物，末段参考30字，不写感悟。用本书物件、数字与人物声线落地，勿为凑数硬塞。账本中的计划与实际记录分开，缺记录不等于未发生。";
const OPENING =
  "开篇规格：首段有违和，可开门见山在300字内出现异常，也可让日常在全章40%内碎裂；首句用冲突对白、反常动作或带信息的档案句，避免泛环境铺陈。第2章尽早给以弱压强的小兑现；第3章前露出独有办法，规则分批给，完成一轮交锋并开新问题；第4–10章大兑现用已讲规则组合触发。标尺供参考，不临时加能力强行达标。";

export async function pursuitWriterCard(run: WorkflowRun) {
  const [write, prose, rhythm] = await Promise.all([
    stageCard(run, "fanqie", "write-chapter", { maxChars: 800, examples: false }),
    stageCard(run, "fanqie", "prose", { maxChars: 450, examples: false }),
    stageCard(run, "fanqie", "rhythm", { maxChars: 350, examples: false }),
  ]);
  const ledger = run.context.readingLedger;
  const summary =
    ledger === undefined
      ? "账本未提供，不推断未发生。"
      : JSON.stringify({
          兑现: ledger.payoffCalendar,
          钩子连跑: ledger.hooks.sameHookRun,
          悬念在挂: ledger.threads.counts,
          临近悬念: ledger.threads.items
            .slice(0, 2)
            .map((item) => ({ 名: item.name.slice(0, 30), 到期: item.due })),
          待使用设定: ledger.terms.items
            .filter((item) => item.notUsed)
            .slice(0, 2)
            .map((item) => item.name.slice(0, 30)),
          人物提醒: ledger.characters.items
            .filter((item) => item.repeatOverdue || item.secondSideOverdue)
            .slice(0, 2)
            .map((item) => item.name.slice(0, 30)),
          已记录章数: ledger.coverage.recorded,
        });
  const timing = run.context.readingBenchmark?.opening;
  const openingReference = timing
    ? `对标开篇人工标注：首章异常在${Math.round(timing.anomalyRatio * 100)}%处；独有办法第${timing.abilityChapter}章、首次兑现第${timing.firstPayoffChapter}章。参考机制，不复制人设或桥段。`
    : "";
  const card = [
    write,
    prose,
    rhythm,
    BEATS,
    openingReference,
    "四账摘要（完整记录见材料）：" + summary,
    ...(run.context.chapterPosition <= 3 ? [OPENING] : []),
  ].join("\n\n");
  if ([...card].length > 2500) throw new Error("写手规则卡超过2500字，未静默删减规则");
  return card;
}
