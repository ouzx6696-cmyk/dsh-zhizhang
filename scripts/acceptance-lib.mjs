/** 验收脚本的纯逻辑：模式与任务组、指标汇总、诊断日志聚合、盲评配对。文件读写与模型调用在 acceptance.mjs。 */

export const PACE_BOOKS = [
  { pace: "快爽", tag: "kuai" },
  { pace: "稳推", tag: "wen" },
  { pace: "慢燃", tag: "man" },
];

export function resolveMode({ matrix, long, finalizeTrack, judge, ab, v2 }) {
  return {
    matrix: !!matrix,
    long: !!long,
    finalizeTrack: !!finalizeTrack || !!long,
    judge: !!judge,
    ab: !!ab,
    /** A/B 臂标签：true=交接 v2 开（RC3），false=关（RC2 基线）；不改任务集，只改交接注入 */
    v2: !!v2,
  };
}

/** mode.json 是 --run 写下的模式事实；读取属于边界，坏文件报错而不是猜。 */
export function normalizeMode(value) {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("mode.json 须为对象");
  const bool = (name) => {
    const item = value[name];
    if (item !== undefined && typeof item !== "boolean")
      throw new Error("mode.json 的 " + name + " 须为布尔值");
    return !!item;
  };
  if (value.round !== undefined && typeof value.round !== "string")
    throw new Error("mode.json 的 round 须为文本");
  return {
    ...resolveMode({
      matrix: bool("matrix"),
      long: bool("long"),
      finalizeTrack: bool("finalizeTrack"),
      judge: bool("judge"),
      ab: bool("ab"),
      v2: bool("v2"),
    }),
    round: value.round ?? null,
  };
}

const chapterIds = (count) =>
  Array.from({ length: count }, (_, index) => "c" + String(index + 1).padStart(3, "0"));

/** ab 小样本模式的头条子集：三种体裁各一篇（资讯/故事/微头条），caseId 保持全量编号便于日后扩表对照 */
export const AB_HEAD_IDS = ["head-1", "head-4", "head-6"];

export function casePlan(mode) {
  const books = [
    { prefix: "novel", chapters: mode.ab ? 3 : mode.long ? 30 : 10 },
    ...(mode.matrix && !mode.ab
      ? PACE_BOOKS.map(({ pace, tag }) => ({ prefix: "novel-matrix-" + tag, chapters: 10, pace }))
      : []),
  ];
  for (const book of books) book.chapterIds = chapterIds(book.chapters);
  const headIds = mode.ab
    ? AB_HEAD_IDS
    : Array.from({ length: 7 }, (_, index) => "head-" + (index + 1));
  const caseIds = [
    ...headIds,
    ...books.flatMap((book) => [
      book.prefix + "-plan",
      ...book.chapterIds.map((id) => book.prefix + "-" + id),
    ]),
  ];
  return {
    books,
    caseIds,
    headCount: headIds.length,
    chapterCount: books.reduce((sum, book) => sum + book.chapters, 0),
    scoredCount: caseIds.length - books.length,
    // ab 模式单方案单臂运行，没有 original 对照 profile
    totalRecords: caseIds.length * (mode.ab ? 1 : 2),
  };
}

export function bookOfCase(books, caseId) {
  return books.find(
    (item) => caseId === item.prefix + "-plan" || caseId.startsWith(item.prefix + "-c"),
  );
}

/** 档位指定是验收作为“作者”下的指令，复用方法方案里 pace 与各档刻度的既有术语，不改方法原文。 */
export function pacePromptLine(pace) {
  return (
    "本书节奏档位由作者指定为「" +
    pace +
    "」：用 fanqie_foundation_set 写进根基 pace 字段，并按" +
    pace +
    "档刻度安排开篇、回报间隔、受压时长与章末；档位已由作者明确，不需要再给建议档。"
  );
}

export function describeMode(mode) {
  const parts = [];
  if (mode.ab)
    parts.push(
      "A/B 小样本（" +
        (mode.v2 ? "交接 v2 开，RC3 臂" : "交接 v2 关，RC2 基线臂") +
        "）：三种体裁头条各一篇 + 3 章长篇（第 2 章前开新对话），定稿轨",
    );
  if (mode.matrix) parts.push("另含快爽、稳推、慢燃三本 10 章对照长篇（各在第 6 章前开新对话）");
  if (mode.long) parts.push("主书为 30 章定稿轨，单任务超时放宽为 30 分钟");
  else if (mode.finalizeTrack) parts.push("定稿轨：confirm 全部放行，模拟作者确认定稿与交稿");
  if (mode.judge) parts.push("任务完成后由评审模型对每篇头条稿与每章正文按读者标尺打分");
  return parts.length ? "本轨模式：" + parts.join("；") + "。" : "";
}

/** 单方案指标：观测计数由验收脚本核对产物后传入，这里只做确定性的数值汇总。 */
export function profileMetric({
  profile,
  plan,
  author,
  issues,
  articles,
  firstQaPass,
  twoQaPass,
  reviews,
  editorPass,
  hardIssues,
  rows,
  instrumentation,
  judge,
}) {
  const graded = plan.caseIds
    .filter((id) => !id.endsWith("-plan"))
    .flatMap((id) => {
      const matches = author.cases.filter((row) => row.id === id);
      return matches.length === 1 &&
        [matches[0].readability, matches[0].voice].every(
          (score) => Number.isFinite(score) && score >= 1 && score <= 5,
        )
        ? matches
        : [];
    });
  const item = {
    profile,
    issues,
    articles,
    firstQaPassRate: firstQaPass / plan.headCount,
    twoQaPassRate: twoQaPass / plan.headCount,
    chapterReviews: reviews,
    editorPassRate: editorPass / plan.chapterCount,
    averageHardIssues: reviews ? hardIssues / reviews : null,
    tokens: rows.reduce((sum, row) => sum + (row.tokens || 0), 0),
    cost: author.actualCost ?? null,
    currency: author.currency,
    authorScored: graded.length,
    authorAverage:
      graded.length === plan.scoredCount
        ? graded.reduce((sum, row) => sum + (row.readability + row.voice) / 2, 0) / plan.scoredCount
        : null,
    continuityErrors: author.continuityErrors,
    resumedWithoutExtraSetup: author.resumedWithoutExtraSetup,
  };
  item.automaticThresholdsMet =
    !item.issues.length &&
    item.articles === plan.headCount &&
    item.chapterReviews === plan.chapterCount &&
    item.firstQaPassRate >= 0.6 &&
    item.twoQaPassRate >= 0.9 &&
    item.editorPassRate >= 0.7 &&
    item.averageHardIssues <= 1;
  if (instrumentation) item.instrumentation = instrumentation;
  if (judge) item.judge = judge;
  return item;
}

export function finalizeSummary(metrics, records, plan) {
  const complete =
    records.length === plan.totalRecords &&
    records.every((row) => row.state === "completed") &&
    metrics.every((row) => !row.issues.length);
  const human = metrics.every(
    (row) =>
      row.authorAverage !== null &&
      Number.isInteger(row.continuityErrors) &&
      row.continuityErrors <= 2 &&
      row.resumedWithoutExtraSetup === true &&
      row.cost !== null,
  );
  const passed =
    complete &&
    human &&
    metrics.every((row) => row.automaticThresholdsMet) &&
    // 单方案轨（ab 臂）没有第二方案可比较，跨方案对比由 A/B 报告承担
    (metrics.length < 2 || metrics[0].authorAverage >= metrics[1].authorAverage);
  return { complete, human, passed };
}

const sessionKey = (row, file) =>
  typeof row.conversationId === "string"
    ? row.conversationId
    : typeof row.taskId === "string"
      ? row.taskId
      : file;

const bump = (map, key) => {
  map[key] = (map[key] || 0) + 1;
};

/**
 * 汇总 `<home>/logs/*.jsonl` 的诊断事件。T0 事件字段允许缺失（handoff/tool_call 契约里
 * intentSource、methodIds、error、denied、trigger 都可缺），缺了记入“未记录”桶而不是丢事件；
 * 末行被截断的坏行（进程中断）是已知情况，计数进 malformedLines 并随 metrics 暴露。
 */
export function aggregateLogs(files) {
  const result = {
    logFiles: files.length,
    events: 0,
    malformedLines: 0,
    handoff: { count: 0, intentSource: {}, methodReads: null },
    toolCalls: { total: 0, deniedOrErrored: 0, share: null },
    contextCompacted: { count: 0, triggers: {} },
  };
  const perSession = new Map();
  let methodOccurrences = 0;
  for (const file of files)
    for (const line of file.lines) {
      if (!line.trim()) continue;
      let row;
      try {
        row = JSON.parse(line);
      } catch {
        result.malformedLines++;
        continue;
      }
      result.events++;
      if (row.event === "handoff") {
        result.handoff.count++;
        bump(
          result.handoff.intentSource,
          typeof row.intentSource === "string" ? row.intentSource : "未记录",
        );
        if (Array.isArray(row.methodIds))
          for (const id of row.methodIds)
            if (typeof id === "string") {
              const session = sessionKey(row, file.name);
              const counts = perSession.get(session) ?? new Map();
              counts.set(id, (counts.get(id) || 0) + 1);
              perSession.set(session, counts);
              methodOccurrences++;
            }
      }
      if (row.event === "tool_call") {
        result.toolCalls.total++;
        if (row.denied === true || row.error) result.toolCalls.deniedOrErrored++;
      }
      if (row.event === "context_compacted") {
        result.contextCompacted.count++;
        bump(
          result.contextCompacted.triggers,
          typeof row.trigger === "string"
            ? row.trigger
            : typeof row.reason === "string"
              ? row.reason
              : "未记录",
        );
      }
    }
  const distinct = [...perSession.values()].reduce((sum, counts) => sum + counts.size, 0);
  result.handoff.methodReads = distinct
    ? {
        occurrences: methodOccurrences,
        distinct,
        average: Math.round((methodOccurrences / distinct) * 100) / 100,
      }
    : null;
  result.toolCalls.share = result.toolCalls.total
    ? Math.round((result.toolCalls.deniedOrErrored / result.toolCalls.total) * 100) / 100
    : null;
  return result;
}

const seedHash = (text) => {
  let hash = 0x811c9dc5;
  for (let index = 0; index < text.length; index++) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return hash >>> 0;
};

/** 同 caseId+轮次种子得到同一 A/B 指派，保证盲评可复现。 */
export function blindAssign(caseIds, seed) {
  return caseIds.map((caseId) => {
    const flip = seedHash(caseId + "#" + seed) % 2 === 1;
    return {
      caseId,
      pairId: "pair-" + caseId,
      a: flip ? "original" : "default",
      b: flip ? "default" : "original",
    };
  });
}
