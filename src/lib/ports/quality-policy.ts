/**
 * QualityPolicy — single product quality surface for 织章.
 * Feel/人味（写法+状态）· Book (书感) · Poison (毒点) · Payoff (兑付) · Style (AI腔)
 * are axes of ONE surface, not three siloed products.
 *
 * Agent-facing tips use positive craft cues; detection lives in HumanFeel / NovelSense gates.
 */
export type QualityAxisId = "feel" | "book" | "poison" | "payoff" | "style";

export interface QualityAxis {
  id: QualityAxisId;
  title: string;
  /** Where the agent should look for craft input. */
  craft: string;
  /** Soft sensor / gate (if any). */
  sensor: string;
}

export const QUALITY_AXES: readonly QualityAxis[] = [
  {
    id: "feel",
    title: "人味",
    craft: "craft 卡写法+状态（writerCraft + characterState + 毛边/failAsTemplate；场面状态，非台词范本）",
    sensor: "HumanFeelGate（过齐/任务句/冷清单 + 毒点码）",
  },
  {
    id: "book",
    title: "书感",
    craft: "读者合同 + novel_sense + 技法卡 bookCraft + 前章正文/happened",
    sensor: "NovelSenseGate（同构再演示/无书债/过闭环）",
  },
  {
    id: "poison",
    title: "毒点",
    craft: "本政策（设定与正文共用）",
    sensor: "HumanFeelGate：setting_enum_dump / ledger_dump / domestic_trivia",
  },
  {
    id: "payoff",
    title: "兑付",
    craft: "章纲 ending + tomato_four_q + draft",
    sensor: "PayoffGate / payoff_audit",
  },
  {
    id: "style",
    title: "AI腔",
    craft: "style_contract（按需；brief 已默认加载）",
    sensor: "StyleLinterPort（禁词/套话传感；≠质量过关）",
  },
] as const;

/**
 * Single poison policy — used by dissect / forge / reader contract / novel_sense tip.
 * Positive craft framing (what TO write); sensors still catch dump patterns in code.
 */
export const QUALITY_POISON_POLICY =
  "质量写法：细节与代价嵌进动作与当场压力；顿号多件收获写成带阻力的场面；账与数字只当这一刻的压力线索；生活琐事留一件有戏的；物件随场面自然带着。";

/** One-line variant for compact contract headers. */
export const QUALITY_POISON_HINT =
  "写法提醒：细节嵌进动作与当场压力；账与数字当压力线索；物件自然带着即可。";

/**
 * Book-debt / open-stake cues for NovelSense ending checks.
 * Situational openers only — deliberately EXCLUDES ledger-inventory words
 * (账本/账页/对账单/差额/账还) so «book debt» does not reward 对账流水毒点.
 */
export const QUALITY_BOOK_DEBT_CUE_RE =
  /下次|明天|后天|还没|还未|还摊|还压|不知|怎么办|会不会|究竟|若是|如果|钥匙|条子|监控|门外|门口|悬着|欠着|没说完|没敢|留着|留下|先这样|再说|等他|等她|等着|未完|未了|仍|依旧|对不上|缺口|下不为例|？|\.\.\.|…|——/;

/** Living-person wobble shared by soft radars (optional import). */
export const QUALITY_WOBBLE_RE =
  /愣|停住|停下|想说|算了|手指|嗓子|喉咙|没敢|差点|忽然|忘了|嘴边|半天|咽了|吞了|咬了|搓|攥|干笑|苦笑|没接|没答|偏开|避开|不想|懒得|随便|嗯了|啊了|叹|呼了口气|没敢说|话到嘴边|又咽/;

export const QualityPolicy = {
  id: "port.quality" as const,
  axes: QUALITY_AXES,
  poisonPolicy: QUALITY_POISON_POLICY,
  poisonHint: QUALITY_POISON_HINT,
  bookDebtCue: QUALITY_BOOK_DEBT_CUE_RE,
  wobble: QUALITY_WOBBLE_RE,

  /** Compact line for reader contract / brief engineering. */
  surfaceLine(): string {
    return "质量面（一体）：人味←技法卡写法+状态+HumanFeel；书感←读者合同+novel_sense+NovelSense；毒点←本政策+人味软雷达码；兑付←ending/payoff；AI腔←style_contract/lint。雷达 0 ≠ 质量过关。";
  },

  poisonPolicyLine(): string {
    return QUALITY_POISON_POLICY;
  },

  poisonHintLine(): string {
    return QUALITY_POISON_HINT;
  },

  formatAxesForAgent(): string {
    const lines = ["## 质量面 · QualityPolicy", QualityPolicy.surfaceLine(), ""];
    for (const a of QUALITY_AXES) {
      lines.push(`- **${a.title}**（${a.id}）：工艺=${a.craft}；传感=${a.sensor}`);
    }
    lines.push("", QUALITY_POISON_POLICY);
    return lines.join("\n");
  },
};
