/**
 * 头条创作规则常量与配置表（唯一规则源，纯 TypeScript 实现）。
 * 对齐 toutiao-viral-writer 4.0.0 规则口径，无需外部 Python 运行时。
 */
export * from "./lexicon.js";

export const RULES_VERSION = "4.0.0";
export const TITLE_MAX = 34;
export const PASS_SCORE = 84;
export const STRUCTURE_BASE = 34;
export const ALONG_PEN = 2;
export const ALONG_CAP = 8;

export const OPEN_TPL = "在当今社会|随着[^。，\\n]{2,10}的(发展|进步|普及|推进)|越来越多的";
export const EMPTY_END = "立于不败之地|美好的明天|共同开创|积极(?:应对|拥抱|转型)|深刻变革";
export const INTERACT = "评论区|你怎么看|聊聊|留言";

export const WEIGHTS: Record<string, number> = {
  ai: 24 / 104,
  read: 16 / 104,
  title: 16 / 104,
  detail: 16 / 104,
  structure: 14 / 104,
  compliance: 18 / 104,
};

export const PASS_LINE: Record<string, number> = {
  ai: 85,
  read: 78,
  title: 80,
  detail: 75,
  structure: 80,
  compliance: 90,
};

export const BANDS: Record<string, [number, number]> = {
  long: [2600, 3400],
  short: [1100, 2200],
  micro: [300, 1000],
};

export const MODE_ALIAS: Record<string, string> = { quick: "short", deep: "short" };
export const MODE_NAME: Record<string, string> = {
  long: "长图文",
  short: "短图文",
  micro: "微头条",
};
export const GENRE_MODE: Record<string, string> = {
  长图文: "long",
  短图文: "short",
  微头条: "micro",
  快图文: "short",
  深图文: "short",
};

export const LONG_SPLIT: Record<"main" | "ext", readonly [number, number]> = {
  main: [1700, 2300],
  ext: [800, 1300],
};
export const EXT_OVERLAP_WARN = 0.12;
export const EXT_OVERLAP_FAIL = 0.25;
export const EXT_SHINGLE = 8;
export const LONG_BUDGET_SCALE = 1.5;

export const IMG_RE = /^!\[[^\]]*\]\([^)]*\)$/;
export const IMG_MARK_RE = /^【配图[：:][^】]*】$/;
export const PRONOUN_STRIP = /其他|他们|她们|他人|她人|他乡|他日|他处|利他|吉他|无他|排他/g;
export const SENT_SPLIT = /(?<=[。！？][””’’])|(?<=[。！？])(?![””’’。！？])/;

const SURNAME =
  "王张李刘陈杨赵黄周吴徐孙马朱胡郭何林罗高郑梁谢宋唐许韩冯邓曹彭曾肖田董袁潘蒋蔡余杜叶程苏魏吕丁任沈" +
  "姚卢姜崔钟谭陆汪范金石廖贾夏韦方白邹孟熊秦邱江尹薛段雷侯龙史陶黎贺顾毛郝龚邵万钱严武戴莫孔汤";

export const NUM_T = "\\d|[一二两三四五六七八九十百千万]+(?:年|天|块|元|岁|次|个|趟|万|千)";
export const PERSON_T =
  "我|你|咱|家里|我们|身边|老人|孩子|爸|妈|父母|老板|师傅|阿姨|大爷|表姐|表哥|表弟|老舅|老[" +
  SURNAME +
  "]";
export const HOOK_T = "却|才|终于|竟然|别再|注意|没人|没想到|不敢|偏偏|居然|还是";
export const HEAD8_EXTRA = "|家|钱|房|娃|别";

export const NUM_RE =
  "\\d+(?:\\.\\d+)?|[一两二三四五六七八九十百千万亿]+(?=[块元趟次年月天岁张条单])";
export const BILL_RE =
  "算了?一?笔账|这笔账|一笔笔|账本|暗账|明账|到手|扣掉|扣完|相当于|差额|合计|" +
  "一年下来|算下来|省下|省出|划算|回本|毛利|净利|进出账";

export interface DriverBudgetDef {
  numbers: number;
  convert: number;
  dense: number;
  desc: string;
}

export const DRIVERS: Record<string, DriverBudgetDef> = {
  账本型: {
    numbers: 18,
    convert: 1,
    dense: 2,
    desc: "一笔钱怎么来、怎么没的；一笔主账，可单设一节拆它",
  },
  处境型: {
    numbers: 8,
    convert: 1,
    dense: 0,
    desc: "一个人卡在一件事里；3~5 个关键数字，不设算账节",
  },
  冲突型: { numbers: 8, convert: 1, dense: 0, desc: "两方各有各的理；数字只立双方底线" },
  信息型: {
    numbers: 14,
    convert: 1,
    dense: 1,
    desc: "规则变了怎么办；只放办事必需的日期、门槛、电话",
  },
  情感型: { numbers: 4, convert: 0, dense: 0, desc: "关系、体面、说不出口的话；尽量不用数字" },
  故事型: {
    numbers: 6,
    convert: 0,
    dense: 0,
    desc: "神话、传说、民间故事改编；讲情节和人物，年代、卷次够用即可",
  },
};

export const LOW_NUMBER_DRIVERS = ["故事型", "情感型"] as const;
export const NUMBER_CREDIT_FLOOR = 12;
export const CONVERT_RE = "相当于|顶得上|够[^。，！？\\n]{0,6}(?:交|买|付|吃|用)|折合";

export interface LineDef {
  defaultDriver: string | null;
  drivers: readonly string[];
  desc: string;
}

export const LINES: Record<string, LineDef> = {
  资讯线: {
    defaultDriver: null,
    drivers: ["账本型", "处境型", "冲突型", "信息型", "情感型"],
    desc: "热点、政策、生活实用；先定主驱动，再按数字预算成文",
  },
  故事线: {
    defaultDriver: "故事型",
    drivers: ["故事型"],
    desc: "神话、传说、民间故事、各国神话改编；主驱动默认故事型",
  },
};
export const DEFAULT_LINE = "资讯线";

export const OPENINGS: Record<string, readonly string[]> = {
  资讯线: ["现场动作", "跑腿卡点", "原话顶门", "时间死线", "直球亮底牌", "账单暴击"],
  故事线: ["定格画面", "原典一句", "反常结局", "配角开口", "直球亮底牌"],
};

export const ENDINGS: Record<string, readonly string[]> = {
  资讯线: ["经历共鸣", "两难选择", "潜台词追问", "帮亲友问计", "观点碰撞", "晒坐标"],
  故事线: ["画面留白", "两难选择", "经历共鸣", "观点碰撞", "古今对照"],
};

export const EXT_WAYS: Record<string, readonly string[]> = {
  资讯线: ["下一步", "另一面", "往深一层"],
  故事线: ["别国同母题", "原典与流行说法", "今天的痕迹"],
};

export const ADAPT_WAYS = ["原典重述", "视角改写", "母题对照"] as const;
export const MOTIFS = [
  "大洪水",
  "射日",
  "盗火",
  "冥府寻人",
  "变形",
  "创世",
  "屠龙斩怪",
  "天鹅处女",
  "逐日",
  "不死药与奔月",
  "徒劳与坚持",
] as const;
export const STORY_REPEAT_DAYS = 30;
export const STORY_FACT_RE = "真实存在|考古证实|史书记载确有|确有其人|真实历史|历史上真的发生";
export const STORY_KIN_RE = "我(?:奶奶|外婆|姥姥|爷爷|外公|姥爷)(?:亲口|当年|小时候)?(?:讲|说)过";

export const LEDGER_FIELDS = [
  "日期",
  "内容线",
  "体裁",
  "垂类",
  "主驱动",
  "母题",
  "母体",
  "故事",
  "改编方式",
  "开头式",
  "结尾式",
  "锚点人名",
  "主标题",
  "状态",
] as const;
export const LEDGER_METRIC_FIELDS = [
  "链接",
  "数据日期",
  "展现",
  "阅读",
  "完读率",
  "平均时长",
  "评论",
  "转发",
  "涨粉",
] as const;
export const METRIC_SNAPSHOT_FIELDS = LEDGER_METRIC_FIELDS.slice(2);
export const LEDGER_STATUSES = ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"] as const;

export const HOMOGENEITY_WINDOW = 10;
export const HOMOGENEITY_MIN_DRAFTS = 3;
export const PARA_BINS = [60, 120, 240] as const;
export const PARA_DIST_WARN = 0.2;
export const END_QUESTION_RATIO = 0.5;
export const MARKER_BOLD_RUN = 3;
export const MARKER_QUOTE_RUN = 3;
export const SHORT_SECTION_LIMIT = 2;

export const FAKE_KIN_RE =
  "我(?:表弟|表妹|表姐|表哥|堂哥|堂弟|舅舅|老舅|姨|姑|叔|妈|爸|爷爷|奶奶|姥姥|姥爷|同事|邻居)(?:上周|上个月|昨天|前天|刚|去年)";

export function lineOf(cardOrRow: Record<string, unknown> | null | undefined): string {
  const ln = typeof cardOrRow?.["内容线"] === "string" ? cardOrRow["内容线"] : "";
  if (ln && Object.hasOwn(LINES, ln)) return ln;
  return cardOrRow?.["主驱动"] === "故事型" ? "故事线" : DEFAULT_LINE;
}

export function allOpenings(): string[] {
  const set = new Set<string>();
  for (const list of Object.values(OPENINGS)) for (const x of list) set.add(x);
  return [...set].sort();
}

export function allEndings(): string[] {
  const set = new Set<string>();
  for (const list of Object.values(ENDINGS)) for (const x of list) set.add(x);
  return [...set].sort();
}
