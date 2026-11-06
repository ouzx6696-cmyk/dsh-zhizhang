/**
 * 开篇三章专检（诊断旁路）：判据取自方法资产——platform「首章立住主线入口与
 * 主角处境」、rhythm 档位表「约前 300 字见到人物的具体处境」与「兑现要在场 /
 * 钩子必须有信息量」、write-chapter 第四节「局面改变测试」。
 * 词表只辅助定位引句；判定以结构特征为主（视角人物在场、压力词与主角同窗、
 * 改变谓语与卖点词同句、兑现后在场使用），定位不足时输出 unclear，不硬判。
 */
import { readChapter, listChapters } from "../../storage/chapters.js";
import { bodyTailOf } from "../../domain/ending-consistency.js";

import { asString, fail, openWork } from "../context.js";
import { S, WORK_OPT, WORKING_DIR } from "../schema.js";
import { defineTool } from "../types.js";
import type { Chapter, Outline } from "../../types.js";

/** 前 300 字处境窗口（rhythm 快爽档刻度；其余档只作参考不硬卡）。 */
const OPENING_WINDOW = 300;
/** 章纲卖点面里落到正文的候选词上限（避免长章纲刷满命中）。 */
const SELLING_POINT_TOKENS = 12;
/** 引句展示上限。 */
const QUOTE_MAX = 60;
/** 判定规则表（随报告返回，保持可读、可复核）。 */
const OPENING_AUDIT_RULES = [
  "situation 前 300 字处境：视角人物（章纲 pov 人名，缺省他/她/我）与压力源词同在前 300 字 → 有；只有其一 → unclear；都没有 → 无。",
  "sellingPoint 卖点亲自改变局面：章纲卖点面（冲突/节拍/亲历/概要）的词未落到正文 → 缺席；卖点词+改变谓语+主角同句 → 亲自；改变拍在但主角缺位且有他者/被动标记 → 旁观；卖点与主角同句但无改变谓语 → 参与；其余 → unclear。",
  "payoffOnce 三章内一次兑现：获得谓语或章纲承诺词命中的句子里（含邻句）出现使用/享受/承受 → 有；兑现拍只配公示/震惊类播报 → 无（播报式结算）；有兑现拍但判不了在场 → unclear。",
  "hook 末章钩子信息量：章末（末 1–2 句）命中新威胁/新信息/新决定/新疑点词表 → 有并给信息增量；只命中「看了看/窗外」类零信息停顿 → 无；其余 → unclear（可能是 rhythm 允许的完整收束）。",
];

/** 压力源定位词表：紧缺/期限/威胁/损耗（只用于找引句，不构成判定）。 */
const PRESSURE_WORDS = [
  "欠",
  "还不上",
  "少了",
  "缺",
  "不够",
  "不足",
  "只剩",
  "仅剩",
  "来不及",
  "赶不上",
  "期限",
  "过期",
  "作废",
  "催",
  "逼",
  "躲",
  "逃",
  "追",
  "堵",
  "被拒",
  "危险",
  "死",
  "伤",
  "砸",
  "亏",
  "罚",
  "撑不住",
  "翻倍",
  "断",
];
/** 局面改变谓语（write-chapter 局面改变测试的定位词）。 */
const CHANGE_VERBS = [
  "改变",
  "扭转",
  "翻盘",
  "破局",
  "翻出",
  "识破",
  "拆穿",
  "戳穿",
  "查清",
  "算清",
  "救",
  "拦下",
  "拦住",
  "截下",
  "换回",
  "换到",
  "争取",
  "争到",
  "赢",
  "拿下",
  "逼退",
  "说服",
  "守住",
  "保住",
  "化解",
  "驳回",
  "夺回",
  "撬开",
];
/** 他者代做/被动标记：改变拍在但主角缺位时的旁观证据。 */
const PASSIVE_MARKERS = ["被", "遭", "眼睁睁", "任由", "对方", "对手", "旁人", "众人"];
/** 兑现后的在场使用/享受/承受（rhythm「兑现要在场」）。 */
const ENJOY_WORDS = [
  "用上",
  "真用",
  "用了",
  "使唤",
  "掏出",
  "递给",
  "递上",
  "穿上",
  "披上",
  "吃",
  "喝",
  "咽",
  "住进",
  "躺进",
  "花了",
  "花掉",
  "耗",
  "烧了",
  "磨掉",
  "疼",
  "痛",
  "代价",
  "付出",
  "生效",
  "启动",
  "发动",
  "署名",
  "名额",
  "换成",
  "换上",
  "到手",
  "落袋",
  "尝",
];
/** 获得类谓语（兑现拍定位）。 */
const GAIN_WORDS = [
  "拿到",
  "得到",
  "获得",
  "领到",
  "收到",
  "赢来",
  "换来",
  "争到",
  "批下",
  "批了",
  "判给",
  "归了",
  "解锁",
  "到手",
  "分到",
  "拨给",
];
/** 播报式结算特征：数字公示/路人震惊（rhythm：不是数字播报加路人震惊）。 */
const BROADCAST_WORDS = [
  "公告",
  "通报",
  "宣布",
  "广播",
  "公示",
  "榜单",
  "排名",
  "名单",
  "震惊",
  "哗然",
  "议论",
  "倒吸",
  "惊呼",
  "沸腾",
  "传遍",
  "轰动",
];
/** 零信息停顿特征（rhythm：「事办完了、他看了看窗外」不是钩子）。 */
const IDLE_ENDINGS = [
  "看了看",
  "望了望",
  "望着",
  "沉默",
  "点点头",
  "笑了笑",
  "叹了口气",
  "夜深了",
  "天亮了",
  "窗外",
  "发呆",
];
/** 钩子信息增量类型表（rhythm 五：新威胁/新信息/新决定/新疑点）。 */
const HOOK_INFO_KINDS = [
  {
    label: "新威胁",
    gain: "结尾引入未处理的外部压力，读者想知道怎么应对。",
    words: [
      "堵在",
      "堵门",
      "上门",
      "闯",
      "围住",
      "追来",
      "杀",
      "出事",
      "失踪",
      "不见了",
      "逼近",
      "砸门",
      "拦住去路",
      "来人",
      "跟了上来",
    ],
  },
  {
    label: "新信息",
    gain: "结尾揭示此前未知的事实，读者想验证与跟进。",
    words: [
      "原来",
      "才发现",
      "才知道",
      "亮出",
      "揭开",
      "露出",
      "翻出",
      "底牌",
      "真相",
      "秘密",
      "对不上",
      "多出",
    ],
  },
  {
    label: "新决定",
    gain: "结尾悬着一个未出口或刚下的决定，读者想看执行。",
    words: ["决定", "打定主意", "下了决心", "决意", "主意已定"],
  },
  {
    label: "新疑点",
    gain: "结尾留出待解问题，读者想知道答案。",
    words: ["为什么", "怎么会", "是谁", "什么来历", "？", "?"],
  },
];
/** 章纲词筛选的虚字表：含这些字的串不当卖点/承诺词（防代词虚词刷命中）。 */
const FUNCTION_CHARS =
  "的了是在我你他她们这那就都又再才只很被把让给和跟从向到去会能没不也还着过吧吗呢啊地得";
/** pov 字段里的通用词：不当人名候选。 */
const POV_GENERIC_WORDS = [
  "视角",
  "人物",
  "主角",
  "限知",
  "全知",
  "本章",
  "观察",
  "处境",
  "视线",
  "范围",
];

/** 各检查的判定词（situation/payoffOnce/hook 用有无与 unclear；sellingPoint 另有亲自/参与/旁观/缺席）。 */
type Verdict = "有" | "无" | "unclear" | "亲自" | "参与" | "旁观" | "缺席";
interface CheckResult {
  verdict: Verdict;
  quote?: string;
  note: string;
}

function clip(text: string, max: number) {
  return text.length <= max ? text : `${text.slice(0, max)}…`;
}
function sentencesOf(text: string) {
  return text
    .split(/(?<=[。！？!?…；;])/)
    .map((s) => s.trim())
    .filter(Boolean);
}
function povNameCandidates(pov: string) {
  const runs = pov.match(/[\u4e00-\u9fff]{2,4}/g) ?? [];
  return [...new Set(runs.filter((r) => !POV_GENERIC_WORDS.some((g) => r.includes(g))))];
}
/** 章纲文本里的候选词：逐段生成 2–6 字子串，含虚字的串丢弃，避免代词虚词当命中词。 */
function outlineTokens(text: string) {
  const seen = new Set<string>();
  for (const frag of text.split(/[^\u4e00-\u9fff]+/)) {
    for (let len = 2; len <= 6; len++) {
      for (let i = 0; i + len <= frag.length; i++) {
        const sub = frag.slice(i, i + len);
        if ([...sub].some((ch) => FUNCTION_CHARS.includes(ch))) continue;
        seen.add(sub);
      }
    }
  }
  return [...seen];
}
/** 处境窗口内的句子：按章序累积，正文去空白后不超窗口。 */
function headSentences(body: string, limit: number) {
  const picked: string[] = [];
  let chars = 0;
  for (const s of sentencesOf(body)) {
    if (chars >= limit) break;
    picked.push(s);
    chars += s.replace(/\s+/g, "").length;
  }
  return { sentences: picked, chars };
}

function checkSituation(pov: string, body: string): CheckResult {
  const head = headSentences(body, OPENING_WINDOW);
  if (!head.chars) return { verdict: "无", note: "正文为空，前 300 字无处境可核" };
  const names = povNameCandidates(pov);
  const nameHit = names.find((n) => head.sentences.some((s) => s.includes(n)));
  const protagonistIn = nameHit !== undefined || /他|她|我/.test(head.sentences.join(""));
  const pressure = PRESSURE_WORDS.find((w) => head.sentences.some((s) => s.includes(w)));
  if (protagonistIn && pressure) {
    const quote = head.sentences.find((s) => s.includes(pressure));
    return {
      verdict: "有",
      quote: quote && clip(quote, QUOTE_MAX),
      note: `前 ${head.chars} 字见主角与压力源「${pressure}」——处境已建立（快爽档刻度：约前 300 字；其余档按各自标准）`,
    };
  }
  if (protagonistIn) {
    return {
      verdict: "unclear",
      quote: clip(head.sentences[0], QUOTE_MAX),
      note: "主角在场但前 300 字未定位到压力源——压力写法可能不在定位词表内，请复核引句",
    };
  }
  if (pressure) {
    return {
      verdict: "unclear",
      quote: clip(head.sentences[0], QUOTE_MAX),
      note: "压力源在场但视角人物未入景——警惕开篇只背设定、不见处境",
    };
  }
  return {
    verdict: "无",
    quote: clip(head.sentences[0], QUOTE_MAX),
    note: "前 300 字未见主角与压力源；开篇现为以上引句所述内容",
  };
}

/** 卖点词 = 本章章纲卖点面落到正文的词；无命中即卖点未落地。 */
function sellingPointTokensOf(outline: Outline, body: string) {
  const source = [outline.conflict, outline.beats, outline.livedScene, outline.synopsis].join("\n");
  return outlineTokens(source)
    .filter((t) => body.includes(t))
    .slice(0, SELLING_POINT_TOKENS);
}

function checkSellingPoint(outline: Outline, body: string): CheckResult {
  const sentences = sentencesOf(body);
  const tokens = sellingPointTokensOf(outline, body);
  if (!tokens.length)
    return {
      verdict: "缺席",
      note: "章纲卖点面（冲突/节拍/亲历/概要）的词均未落到正文——卖点未落地；安静过渡章可不亮，但不连续两章缺席",
    };
  const names = povNameCandidates(outline.pov).filter((n) => body.includes(n));
  const actors = names.length ? names : ["他", "她", "我"];
  const hasActor = (s: string) => actors.some((a) => s.includes(a));
  const hasVerb = (s: string) => CHANGE_VERBS.some((v) => s.includes(v));
  const hasToken = (s: string) => tokens.some((t) => s.includes(t));
  const personal = sentences.find((s) => hasActor(s) && hasVerb(s) && hasToken(s));
  if (personal)
    return {
      verdict: "亲自",
      quote: clip(personal, QUOTE_MAX),
      note: "卖点词、改变谓语与主角同句——局面改变测试：删掉这一拍，结果应当不同",
    };
  const doneByOther = sentences.find(
    (s) => hasVerb(s) && hasToken(s) && !hasActor(s) && PASSIVE_MARKERS.some((p) => s.includes(p)),
  );
  if (doneByOther)
    return {
      verdict: "旁观",
      quote: clip(doneByOther, QUOTE_MAX),
      note: "改变拍存在但句内主角缺位且有他者/被动标记——常见病灶：对方在主角介入前已自己做完决定",
    };
  const joined = sentences.find((s) => hasActor(s) && hasToken(s));
  if (joined)
    return {
      verdict: "参与",
      quote: clip(joined, QUOTE_MAX),
      note: "卖点词与主角同句在场，但未定位到改变局面的谓语拍——参与而非亲自改变",
    };
  const vague = sentences.find((s) => hasVerb(s) && hasToken(s));
  if (vague)
    return {
      verdict: "unclear",
      quote: clip(vague, QUOTE_MAX),
      note: "卖点词与改变谓语同现但主语不明（中文常省略主语），请人工复核引句",
    };
  return {
    verdict: "unclear",
    note: "卖点词落到正文，但改变谓语词表未命中任何改变拍——可能是词表外的破局写法，请人工复核",
  };
}

interface PayoffChapterInput {
  chapterId: string;
  position: number;
  outline: Outline;
  body: string;
}
/** 兑现拍 = 获得谓语或章纲承诺词命中的句子；在场 = 同句或邻句出现使用/享受/承受。 */
function checkPayoffOnce(chapters: PayoffChapterInput[]): CheckResult {
  let broadcast: { quote: string; chapter: PayoffChapterInput } | undefined;
  let undetermined: { quote: string; chapter: PayoffChapterInput } | undefined;
  for (const ch of chapters) {
    const sentences = sentencesOf(ch.body);
    const tokens = outlineTokens(
      [ch.outline.ending, ch.outline.beats, ch.outline.livedScene, ch.outline.synopsis].join("\n"),
    ).filter((t) => ch.body.includes(t));
    const hasGain = (s: string) => GAIN_WORDS.some((w) => s.includes(w));
    const hasToken = (s: string) => tokens.some((t) => s.includes(t));
    const hasEnjoy = (s: string) => ENJOY_WORDS.find((w) => s.includes(w));
    const hasBroadcast = (s: string) => BROADCAST_WORDS.some((w) => s.includes(w));
    for (let i = 0; i < sentences.length; i++) {
      const s = sentences[i];
      if (!hasGain(s) && !hasToken(s)) continue;
      const next = sentences[i + 1] ?? "";
      const enjoyed = hasEnjoy(s) ?? hasEnjoy(next);
      if (enjoyed)
        return {
          verdict: "有",
          quote: clip(s, QUOTE_MAX),
          note: `第 ${ch.position} 章承诺兑现且在场使用/承受（命中「${enjoyed}」），非播报式结算`,
        };
      if (!broadcast && !undetermined) {
        const spot = { quote: clip(s, QUOTE_MAX), chapter: ch };
        if (hasBroadcast(s)) broadcast = spot;
        else undetermined = spot;
      }
    }
  }
  if (broadcast)
    return {
      verdict: "无",
      quote: broadcast.quote,
      note: `第 ${broadcast.chapter.position} 章的兑现拍为播报式结算（公示/震惊类），未见使用、享受或承受——rhythm：回报要被使用、享受或承受`,
    };
  if (undetermined)
    return {
      verdict: "unclear",
      quote: undetermined.quote,
      note: `第 ${undetermined.chapter.position} 章有兑现拍，但结构特征不足以判在场/播报，请人工复核引句`,
    };
  return { verdict: "无", note: "前三章未见承诺兑现拍（获得谓语与章纲承诺词均未在正文落点）" };
}

/** 末章章末钩子：新威胁/新信息/新决定/新疑点任一即有信息增量。 */
function checkHook(body: string): CheckResult & { infoGain?: string } {
  const tail = bodyTailOf(body, 120);
  if (!tail) return { verdict: "无", note: "正文为空，无章末可核" };
  const idle = IDLE_ENDINGS.filter((w) => tail.includes(w));
  for (const kind of HOOK_INFO_KINDS) {
    const hit = kind.words.find((w) => tail.includes(w));
    if (hit === undefined) continue;
    return {
      verdict: "有",
      quote: tail,
      infoGain: `${kind.label}：${kind.gain}`,
      note: `章末按词表判为「${kind.label}」（命中「${hit}」）；rhythm 提醒：能收束就收束，硬留钩子会与落点自相矛盾`,
    };
  }
  if (idle.length)
    return {
      verdict: "无",
      quote: tail,
      note: `章末为零信息停顿（${idle.join("、")}）——牵引力来自想知道会发生什么，不来自把句子砍断`,
    };
  return {
    verdict: "unclear",
    quote: tail,
    note: "章末未命中钩子类型词表，也未命中零信息停顿——可能是完整收束（rhythm 允许）或词表外的新接口类钩子，请人工复核",
  };
}

export const openingAudit = defineTool({
  name: "fanqie_opening_audit",
  description:
    "【旁路·诊断】开篇三章专检：逐章核「前 300 字处境」与「卖点是否由主角亲自改变局面」，合并核「三章内一次在场兑现」与「末章章末钩子信息量」。输出 JSON 报告（判定+引句+规则表）；词表只辅助定位引句，拿不准判 unclear。不阻断流程，不改写正文。",
  properties: {
    work: WORK_OPT,
    working_dir: WORKING_DIR,
    chapters: S("可选：逗号分隔的章节 id（缺省取章序前三章）"),
  },
  required: [],
  async execute(args, exec) {
    const { dir, key } = await openWork(exec, args);
    const chapterIds = (asString(args, "chapters") ?? "").split(/[,\s，、]+/).filter(Boolean);
    const all = await listChapters(dir);
    const targets: Chapter[] = [];
    if (chapterIds.length) {
      for (const id of chapterIds) targets.push(await readChapter(dir, id));
    } else {
      if (!all.length) fail("还没有章节，先用 fanqie_outline_set 或 fanqie_chapter_save 创建");
      for (const row of all.slice(0, 3)) targets.push(await readChapter(dir, row.id));
    }
    const sections = targets.map((ch) => ({
      chapterId: ch.id,
      title: ch.title,
      position: ch.position,
      status: ch.status,
      situation: checkSituation(ch.outline.pov, ch.body),
      sellingPoint: checkSellingPoint(ch.outline, ch.body),
    }));
    const payoffChapters: PayoffChapterInput[] = targets.map((ch) => ({
      chapterId: ch.id,
      position: ch.position,
      outline: ch.outline,
      body: ch.body,
    }));
    const last = targets[targets.length - 1];
    const report = {
      work: key,
      auditedCount: targets.length,
      rules: OPENING_AUDIT_RULES,
      chapters: sections,
      payoffOnce: checkPayoffOnce(payoffChapters),
      hook: { chapterId: last.id, ...checkHook(last.body) },
      note: "本报告是诊断候选清单，不是质量法；判定词表只辅助定位引句，unclear 请人工复核。",
    };
    return JSON.stringify(report, null, 2);
  },
});
