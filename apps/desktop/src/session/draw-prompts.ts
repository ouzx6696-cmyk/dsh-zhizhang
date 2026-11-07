import { isRecord } from "../../../../packages/core/src/parse";
export type DrawScenario = "opening" | "chapter-end" | "title-brief";

/** 一路起草的产物：开头/章末落为候选（candidateId），书名简介与标题只回文本（无章可挂）。 */
export interface DrawDraft {
  label: string;
  candidateId?: string;
  body?: string;
  wordCount?: number;
}
/** 工具回执 details.draws 的单版：有评估带分数与理由，评估失败只按起草顺序列 label。 */
export type DrawResult = { label: string; score?: number; reasons?: string };

/** S3 标题五母体（原文：packages/toutiao/skill/references/s3-headline.md 第一节，任务文本按线取例）。 */
const TOUTIAO_MATRICES = [
  {
    name: "数字反差式",
    formula: "[大数/长周期] + 却/才/只 + [小数/意外结果]",
    news: "交了二十多年社保，我到退休才发现少算了一笔钱",
    story: "一只鸟衔了一辈子石头，原典没写海填没填平",
  },
  {
    name: "身份点名式",
    formula: "[具体处境的人群] + [变化] + [利好或提醒]",
    news: "家里有六十岁以上老人的，月底前这件事别忘了办",
    story: "小时候背过精卫填海的人，可能都漏看了一句",
  },
  {
    name: "悬念缺口式",
    formula: "[大家以为的常规] + [当事人反常举动或卡住]",
    news: "房租能全额提公积金了，他看完细则却把手机合上了",
    story: "后羿射完太阳以后，第一个疏远他的是谁",
  },
  {
    name: "原话现场式",
    formula: "“[带情绪的原话]” + [说话人与现场]",
    news: "“早说啊，我白跑三趟！”去办这事前先看清这一条",
    story: "“我不是来填海的，我是来讨一句话的”",
  },
  {
    name: "时间坐标式",
    formula: "[节点] + [变化] + [不行动的代价]",
    news: "明年元旦以后，回收旧手机得先清数据",
    story: "中秋前再读一遍嫦娥：原典里她拿的是什么药",
  },
];

const SCORING_DIMS = [
  "局面改变（是否把人物推入新的局面）",
  "本章变化（信息、关系或目标的推进量）",
  "钩子信息量（留下多少值得追的具体钩子）",
  "档位刻度（爽点或张力是否到位且不越档）",
  "病型命中（万能套话、空转连接等病型越少越高）",
].join("；");

export function draftLaneTask(scenario: DrawScenario, label: string, chapter?: string) {
  if (scenario === "title-brief")
    return [
      `【抽卡起草 ${label}】为本书起草一版书名与简介：`,
      "- 书名一行（尽量不超过 12 字），简介一段（120–200 字），只输出这两样，不要解释。",
      "- 本会话不调用任何工具，写完即止。",
    ].join("\n");
  const ask =
    scenario === "opening"
      ? "起草“本章开头”一版：300–500 字，从当前局面直接进入有阻力的一幕，不写完整章、不复述前情。"
      : "起草“本章章末”一版：300–500 字，承接本章已有进展直接写结尾段落，落到具体的残局、物品、威胁或钩子，不写完整章。";
  return [
    `【抽卡起草 ${label}】${ask}`,
    `写完立即调用 fanqie_candidate_stage 暂存：chapter=${chapter}，content=这段正文，draft_label=${label}，note=抽卡起草（${SCENARIO_LABELS[scenario]}）。`,
    "只起草这一版，不采纳、不定稿、不派编辑。",
  ].join("\n");
}

export function toutiaoTitleLaneTask(index: number, line: string): string {
  const matrix = TOUTIAO_MATRICES[index];
  const story = line === "故事线";
  return [
    `【抽卡起草 抽卡-${index + 1}】为这篇${story ? "故事线" : "资讯线"}头条出一版标题，只用母体「${matrix.name}」。`,
    `公式：${matrix.formula}。参考：${story ? matrix.story : matrix.news}。`,
    "- 只输出标题一行，18~28 字最好、34 字硬上限；不用绝对化与标题党词（最好/第一/震惊/必看…），单字“最”不禁。",
    ...(story ? ["- 不写“真实/揭秘/史书不敢写/考古证实”这类把传说当史实的词。"] : []),
    "- 本会话不调用任何工具，写完即止。",
  ].join("\n");
}

/** s3-headline 第三节的 CTR 自评四问（排序用，每问过或不过）。 */
const TOUTIAO_CTR_QUESTIONS = [
  "1 画得出来吗——读完标题，脑子里有没有一个具体的人（或神、或鸟）在一个具体的地方；",
  "2 有缺口吗——有没有一个让人想问“为什么”“后来呢”的反常；",
  "3 接得住吗——标题里的人、数、悬念，正文前两段兑现了吗（下面没有正文时跳过这一问）；",
  "4 认得出是谁吗——目标读者一眼能对号入座（“我”“我爸妈”“我小时候听过的那个故事”）。",
].join("\n");

export function toutiaoTitleEvaluateTask(drafts: DrawDraft[], opening: string | undefined) {
  return [
    `你是标题抽卡评估编辑。下面是同一次抽卡的 ${drafts.length} 版头条标题（标签 抽卡-N），互为备选。`,
    `按 s3-headline 的 CTR 四问逐问判断（过/不过）：\n${TOUTIAO_CTR_QUESTIONS}`,
    "score = 通过的问题数（0–4），同分再看标题具体度。只输出一个 JSON 数组，按 score 从高到低排序，不要输出其他文字：",
    '[{"label":"抽卡-1","score":3,"reason":"一句理由"}]',
    ...(opening ? ["", "【正文前两段】", opening] : []),
    "",
    "【标题草稿】",
    ...drafts.flatMap((draft) => [`=== ${draft.label} ===`, draft.body?.trim() || "（空）", ""]),
  ].join("\n");
}

export function evaluateTask(scenario: DrawScenario, drafts: DrawDraft[]) {
  return [
    `你是抽卡评估编辑。下面是同一次抽卡的 ${drafts.length} 版${SCENARIO_LABELS[scenario]}草稿（标签 抽卡-N），互为备选。`,
    `按五项各打 1–5 分并加总为 score：${SCORING_DIMS}。`,
    "只输出一个 JSON 数组，按 score 从高到低排序，不要输出其他文字：",
    '[{"label":"抽卡-1","score":19,"reason":"一句理由"}]',
    "",
    "【草稿】",
    ...drafts.flatMap((draft) => [`=== ${draft.label} ===`, draft.body?.trim() || "（空）", ""]),
  ].join("\n");
}

export function parseRanking(raw: string): { label: string; score: number; reason: string }[] {
  const start = raw.indexOf("[");
  const end = raw.lastIndexOf("]");
  if (start < 0 || end <= start) throw new Error("评估输出没有 JSON 数组");
  const items: unknown = JSON.parse(raw.slice(start, end + 1));
  if (!Array.isArray(items) || items.length === 0) throw new Error("评估数组为空");
  return items.map((item) => {
    const row = isRecord(item) ? item : null;
    if (
      !row ||
      typeof row["label"] !== "string" ||
      typeof row["score"] !== "number" ||
      typeof row["reason"] !== "string"
    )
      throw new Error("评估条目缺少 label/score/reason");
    return { label: row["label"], score: row["score"], reason: row["reason"] };
  });
}

/** 评估标签与草稿对不上的条目丢弃；一条都对不上视为评估失败。 */
export function filterRanking(
  ranking: { label: string; score: number; reason: string }[],
  drafts: DrawDraft[],
) {
  const labels = new Set(drafts.map((draft) => draft.label));
  const rows = ranking.filter((row) => labels.has(row.label));
  if (rows.length === 0) throw new Error("评估结果与草稿标签对不上");
  return rows;
}

export function drawReport(
  label: string,
  drafts: DrawDraft[],
  ranking: { label: string; score: number; reason: string }[] | undefined,
  rankError: string | undefined,
  failures: string[],
  whereNext: string,
) {
  const lines: string[] = [];
  if (ranking) {
    lines.push(`【抽卡评估 · ${label}】${drafts.length} 版已按总分排序：`);
    ranking.forEach((row, index) =>
      lines.push(`${index + 1}. ${row.label} · ${row.score} 分：${row.reason}`),
    );
  } else {
    lines.push(`【抽卡评估失败，未排序 · ${label}】${rankError}`);
    lines.push(
      "各版草稿按起草顺序如下，请作者自行比较：",
      ...drafts.map(
        (draft, index) =>
          `${index + 1}. ${draft.label}${draft.wordCount ? `（约 ${draft.wordCount} 字）` : ""}`,
      ),
    );
  }
  if (failures.length) lines.push("失败的路：", ...failures.map((row) => `- ${row}`));
  lines.push(whereNext, "把排序、分数与理由汇报给作者，等作者选定后再采纳，不要自动采纳。");
  return lines.join("\n");
}

export const SCENARIO_LABELS: Record<DrawScenario, string> = {
  opening: "本章开头",
  "chapter-end": "本章章末",
  "title-brief": "书名与简介",
};
