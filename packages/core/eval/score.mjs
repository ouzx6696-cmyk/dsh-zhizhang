/** 读者评审纯逻辑：提示词拼装、评审输出解析、分项汇总。模型调用由验收脚本直连完成。 */

export const JUDGE_ITEMS = {
  chapter: [
    "期待清楚",
    "局面改变",
    "本章变化",
    "兑现在场",
    "对手",
    "章末",
    "接续",
    "人味",
    "追读意愿",
  ],
  article: ["标题", "开篇三段", "人物", "引语", "延伸", "节奏", "结尾", "不像模板", "读完意愿"],
};

const round2 = (value) => Math.round(value * 100) / 100;

const template = (kind) => {
  const names = JUDGE_ITEMS[kind];
  return `{"scores":{${names.map((name) => `"${name}":<1-5整数>`).join(",")}},"evidences":{${names
    .map((name) => `"${name}":"<一句证据>"`)
    .join(",")}}}`;
};

export function buildJudgePrompt(rubric, kind, title, text) {
  if (!JUDGE_ITEMS[kind]) throw new Error("未知评审对象类型：" + kind);
  return [
    rubric.trim(),
    "",
    "## 待评审作品",
    ...(title ? ["章节题名：" + title] : []),
    "",
    text.trim(),
    "",
    "## 输出提醒",
    "按标尺的输出格式只输出一个 JSON 对象，键名与下列模板完全一致：",
    template(kind),
  ].join("\n");
}

export function parseJudgeOutput(raw, kind) {
  const names = JUDGE_ITEMS[kind];
  if (!names) throw new Error("未知评审对象类型：" + kind);
  const start = raw.indexOf("{"),
    end = raw.lastIndexOf("}");
  if (start < 0 || end <= start) throw new Error("评审输出不含 JSON 对象");
  let parsed;
  try {
    parsed = JSON.parse(raw.slice(start, end + 1));
  } catch (error) {
    throw new Error("评审输出不是合法 JSON：" + error.message);
  }
  const scores = parsed.scores,
    evidences = parsed.evidences;
  if (!scores || typeof scores !== "object") throw new Error("评审 JSON 缺少 scores 对象");
  if (!evidences || typeof evidences !== "object") throw new Error("评审 JSON 缺少 evidences 对象");
  for (const name of names) {
    if (typeof scores[name] !== "number" || !Number.isInteger(scores[name]))
      throw new Error("评审 JSON 的「" + name + "」评分缺失或不是整数");
    if (scores[name] < 1 || scores[name] > 5)
      throw new Error("评审 JSON 的「" + name + "」评分超出 1–5");
    if (typeof evidences[name] !== "string" || !evidences[name].trim())
      throw new Error("评审 JSON 的「" + name + "」缺少证据");
  }
  return {
    scores: Object.fromEntries(names.map((name) => [name, scores[name]])),
    evidences: Object.fromEntries(names.map((name) => [name, evidences[name]])),
    average: round2(names.reduce((sum, name) => sum + scores[name], 0) / names.length),
  };
}

function averageOf(rows, pick) {
  return round2(rows.reduce((sum, row) => sum + pick(row), 0) / rows.length);
}

export function aggregateJudge(results, kind) {
  const rows = results.filter((row) => row.kind === kind);
  if (!rows.length) return null;
  return {
    count: rows.length,
    items: Object.fromEntries(
      JUDGE_ITEMS[kind].map((name) => [name, averageOf(rows, (row) => row.scores[name])]),
    ),
    overall: averageOf(rows, (row) => row.average),
  };
}

function willingnessAverage(results, kind) {
  const rows = results.filter((row) => row.kind === kind);
  if (!rows.length) return null;
  const name = JUDGE_ITEMS[kind][JUDGE_ITEMS[kind].length - 1];
  return averageOf(rows, (row) => row.scores[name]);
}

export function judgeSummary(results) {
  if (!results.length) return null;
  return {
    chapters: aggregateJudge(results, "chapter"),
    articles: aggregateJudge(results, "article"),
    willingness: {
      chapter: willingnessAverage(results, "chapter"),
      article: willingnessAverage(results, "article"),
    },
  };
}
