/**
 * 方法包决策表：把「模式 + 作者消息 + 焦点意图 + 作品状态快照」映射到本次任务要装载的方法与附件。
 * 纯函数：不读盘、不碰全局状态；快照由接线侧从 work/article 存储收集后传入。
 * 行按序匹配，第一条命中的行决定结果；表尾兜底是 inspect（没有把握就不装载方法）。
 */

/** 任务意图。比桌面 Focus.intent 多 "revise"（接线任务扩展桌面联合）；番茄没有 library 意图，
 * 拆书用 "plan" 承载、methods 精确指向 library，调用方以 methods 区分拆书与其他规划任务。 */
export type MethodPackIntent = "write" | "review" | "plan" | "inspect" | "revise";

/** 附件语义：告诉接线侧本次任务要附上的材料是什么，不是方法原文。 */
export type MethodAttachmentKind =
  | "previous-ending" // 上一章结尾节选（WorkMeta.continuity）
  | "act-outline" // 卷/幕大纲节选（WorkMeta.planning）
  | "review-report" // 最新编辑审读回报全文（渲染后的 ReviewReport）
  | "revision-scope" // 修改范围说明：只改回报指出的位置
  | "rhythm-excerpt" // rhythm 方法的三档节奏节选
  | "prose-table" // prose 方法的病型表
  | "lean-brief" // fanqie_chapter_brief 的 lean 交接简报
  | "delegation-note" // 编辑委派说明：编辑不改正文、不定稿
  | "corpus-excerpt"; // 头条语料节选（corpus-*）

export interface MethodPack {
  intent: MethodPackIntent;
  /** 头条为 S1–S7 环节（S5/S6 可同时两个）；番茄用不到步骤名，恒为空数组。 */
  steps: string[];
  methods: { id: string }[];
  attachments: { kind: MethodAttachmentKind }[];
}

/** 与桌面 Focus 结构对齐，便于直接透传；决策表只读 intent。 */
export interface MethodPackFocus {
  article?: string;
  chapter?: string;
  candidate?: string;
  revision?: string | number;
  title?: string;
  workTitle?: string;
  source?: "chapter" | "candidate" | "article" | "split";
  dirty?: boolean;
  /** 桌面 Focus.intent 的联合加上 "revise" */
  intent?: MethodPackIntent;
}

/** 番茄章节快照，由接线侧从 ChapterMeta 与 chapterReviewInfo 收集。 */
export interface FanqieChapterSnapshot {
  id: string;
  /** 是否已有章纲（ChapterMeta.outline 是否存在） */
  hasOutline: boolean;
  /** 章纲是否通过 fanqie_outline_check（8 字段齐全、无占位） */
  outlinePassed: boolean;
  /** 章状态，取值同 fanqie ChapterStatus；判定只看章纲与审读字段，带上它便于接线侧对账 */
  status: "planned" | "drafting" | "drafted" | "reviewed" | "final";
  /** 最新编辑审读是否通过且对应当前正文；null = 还没有回报 */
  latestReviewPassed: boolean | null;
}

export interface FanqieSnapshot {
  /** 是否已打开一部作品 */
  hasWork: boolean;
  /** 本次指向的章；没有指向章、或作品里还没有可指向的章时为 null */
  chapter: FanqieChapterSnapshot | null;
}

/** 头条文章快照，由接线侧从 ArticleMeta 与立项卡文件收集。 */
export interface ToutiaoArticleSnapshot {
  /** 状态词，取值同 toutiao STATUSES */
  stage: "初稿待改" | "待验收" | "已验收" | "验收退回" | "已交稿";
  /** 体裁线：资讯线→news、故事线→story、微头条→micro（由 line+genre 归并） */
  contentLine: "news" | "story" | "micro";
  /** 立项卡是否已保存（S2 的产出） */
  hasCard: boolean;
  /** 主标题是否已定（S3 的产出） */
  hasHeadline: boolean;
  /** 是否已有任何一版稿件（S4 的产出） */
  hasDraft: boolean;
}

export interface ToutiaoSnapshot {
  article: ToutiaoArticleSnapshot | null;
}

export interface MethodPackInput {
  mode: "fanqie" | "toutiao";
  text: string;
  focus: MethodPackFocus;
  fanqie?: FanqieSnapshot;
  toutiao?: ToutiaoSnapshot;
}

const pack = (
  intent: MethodPackIntent,
  methods: string[],
  attachments: MethodAttachmentKind[] = [],
  steps: string[] = [],
): MethodPack => ({
  intent,
  steps,
  methods: methods.map((id) => ({ id })),
  attachments: attachments.map((kind) => ({ kind })),
});

interface DecisionRow<Subject> {
  matches: (subject: Subject) => boolean;
  pack: (subject: Subject) => MethodPack;
}

function decide<Subject>(rows: DecisionRow<Subject>[], subject: Subject, fallback: MethodPack) {
  const row = rows.find((candidate) => candidate.matches(subject));
  return row ? row.pack(subject) : fallback;
}

// 文本触发词集中成表：focus=plan 分支与文本行共用同一组正则，避免两处口径漂移。
const LIBRARY_TEXT = /拆书|拆解|原文分析|参考分析/;
const OPINION_TEXT = /看看|怎么样|评价|如何/;
const OUTLINE_TEXT = /章纲|大纲/;
const STRUCTURE_TEXT = /卷|幕|结构/;
const FOUNDATION_TEXT = /开书|新书|立项|根基/;
const WRITE_TEXT = /续写|开写|写正文|写这章|写一章|写第.{1,4}章/;
const REVISE_TEXT = /改|修|润色|按.*意见/;

const WRITE_PACK = pack(
  "write",
  ["write-chapter"],
  ["rhythm-excerpt", "prose-table", "lean-brief"],
);
const PLAN_OUTLINE_PACK = pack("plan", ["plan-outline"], ["previous-ending", "act-outline"]);
const REVISE_PACK = pack("revise", ["revise"], ["review-report", "revision-scope"]);
const REVIEW_PACK = pack("review", [], ["delegation-note"]);
const INSPECT_FALLBACK = pack("inspect", []);

const chapterOf = (input: MethodPackInput) => input.fanqie?.chapter ?? null;

const outlineReady = (input: MethodPackInput) => {
  const chapter = chapterOf(input);
  return chapter !== null && chapter.hasOutline && chapter.outlinePassed;
};

const PLAN_TEXT_METHODS: Array<[RegExp, string]> = [
  [OUTLINE_TEXT, "plan-outline"],
  [STRUCTURE_TEXT, "plan-structure"],
];

const planMethodFor = (text: string) =>
  PLAN_TEXT_METHODS.find(([expression]) => expression.test(text))?.[1] ?? "plan-foundation";

/**
 * 番茄行序：
 * 1. 拆书与作者提问放最前（K-02：「帮我看看这章写得怎么样」含"写"，不能先落到写章正则）；
 * 2. 章缺章纲的状态行压过按钮的 write 意图——状态优先于泛化意图，续写按钮也得先补章纲；
 * 3. focus.intent 行优先于文本推断；「最新审读没过 + 明说要改」的文本行让位于 review 意图，
 *    否则审读回报失败之后，"派编辑审读"按钮会被正文里的"改正文"字样改成改稿任务。
 */
const FANQIE_ROWS: Array<DecisionRow<MethodPackInput>> = [
  { matches: (i) => LIBRARY_TEXT.test(i.text), pack: () => pack("plan", ["library"]) },
  { matches: (i) => OPINION_TEXT.test(i.text), pack: () => pack("inspect", []) },
  {
    matches: (i) => {
      const chapter = chapterOf(i);
      return chapter !== null && (!chapter.hasOutline || !chapter.outlinePassed);
    },
    pack: () => PLAN_OUTLINE_PACK,
  },
  {
    matches: (i) => i.focus.intent === "plan",
    pack: (i) => pack("plan", [planMethodFor(i.text)]),
  },
  { matches: (i) => i.focus.intent === "revise", pack: () => REVISE_PACK },
  { matches: (i) => i.focus.intent === "review", pack: () => REVIEW_PACK },
  {
    matches: (i) =>
      chapterOf(i)?.latestReviewPassed === false &&
      i.focus.intent !== "review" &&
      REVISE_TEXT.test(i.text),
    pack: () => REVISE_PACK,
  },
  { matches: (i) => i.focus.intent === "write" && outlineReady(i), pack: () => WRITE_PACK },
  { matches: (i) => outlineReady(i) && WRITE_TEXT.test(i.text), pack: () => WRITE_PACK },
  { matches: (i) => OUTLINE_TEXT.test(i.text), pack: () => PLAN_OUTLINE_PACK },
  { matches: (i) => STRUCTURE_TEXT.test(i.text), pack: () => pack("plan", ["plan-structure"]) },
  {
    matches: (i) => (!i.fanqie?.hasWork || !i.fanqie?.chapter) && FOUNDATION_TEXT.test(i.text),
    pack: () => pack("plan", ["plan-foundation"]),
  },
];

const S4_METHOD_BY_LINE: Record<ToutiaoArticleSnapshot["contentLine"], string> = {
  news: "s4-news",
  story: "s4-story",
  micro: "s4-micro",
};

/** 头条按流程推进：快照里第一个没完成的环节就是当前步骤；focus/文本与状态冲突时以状态为准。
 * intent 语义：找题/立项=plan，标题/成文/交稿=write，红笔与质检=review。 */
const TOUTIAO_ROWS: Array<DecisionRow<ToutiaoArticleSnapshot>> = [
  { matches: (a) => !a.hasCard, pack: () => pack("plan", ["s2-selection"], [], ["S2"]) },
  { matches: (a) => !a.hasHeadline, pack: () => pack("write", ["s3-headline"], [], ["S3"]) },
  {
    matches: (a) => !a.hasDraft || a.stage === "初稿待改" || a.stage === "验收退回",
    pack: (a) =>
      pack("write", ["s4-common", S4_METHOD_BY_LINE[a.contentLine]], ["corpus-excerpt"], ["S4"]),
  },
  {
    matches: (a) => a.stage === "待验收",
    pack: () => pack("review", ["s5-editing", "s6-qa"], [], ["S5", "S6"]),
  },
  {
    matches: (a) => a.stage === "已验收",
    pack: () => pack("write", ["s7-delivery", "template-delivery"], [], ["S7"]),
  },
];
const TOUTIAO_FIND_TOPIC = pack("plan", ["s1-hot", "s1-evergreen"], [], ["S1"]);
// 已交稿后流程走完，没有要装载的方法；作者再发消息按查阅处理。
const TOUTIAO_DELIVERED = pack("inspect", [], [], ["S7"]);

/** 决策表入口：输入快照，输出方法包；本单不接线，由会话层接线任务调用。 */
export function buildMethodPack(input: MethodPackInput): MethodPack {
  if (input.mode === "toutiao") {
    const article = input.toutiao?.article ?? null;
    return article === null ? TOUTIAO_FIND_TOPIC : decide(TOUTIAO_ROWS, article, TOUTIAO_DELIVERED);
  }
  return decide(FANQIE_ROWS, input, INSPECT_FALLBACK);
}
