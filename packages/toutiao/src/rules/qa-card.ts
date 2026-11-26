/**
 * 头条立项卡校验与端到端质检入口（纯 TypeScript 实现）。
 */
import fs from "node:fs/promises";
import {
  ADAPT_WAYS,
  DRIVERS,
  ENDINGS,
  EXT_WAYS,
  FAKE_KIN_RE,
  GENRE_MODE,
  LINES,
  MODE_ALIAS,
  MOTIFS,
  OPENINGS,
  SAMPLE_NAMES,
  STORY_KIN_RE,
  STORY_REPEAT_DAYS,
  lineOf,
} from "./constants.js";
import { readLedgerFile } from "./ledger-store.js";
import { checkHomogeneity, loadHistory } from "./qa-homogeneity.js";
import {
  loadManuscript,
  markerDensityHints,
  normH,
  splitExt,
  type LoadedManuscript,
} from "./qa-parse.js";
import { analyzeManuscript, type QaReport } from "./qa-score.js";

const SAMPLE_NAME_SET = new Set<string>(SAMPLE_NAMES);
const ADAPT_WAY_SET = new Set<string>(ADAPT_WAYS);
const MOTIF_SET = new Set<string>(MOTIFS);

export class QAInputError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "QAInputError";
  }
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function asStr(value: unknown): string {
  return typeof value === "string" ? value : "";
}

function asList(value: unknown): unknown[] {
  if (!value) return [];
  return Array.isArray(value) ? value : [value];
}

const CARD_STRING_FIELDS = [
  "内容线",
  "体裁",
  "主驱动",
  "主问题",
  "主标题",
  "垂类",
  "人群",
  "故事",
  "母题",
  "母体",
  "改编方式",
  "主数字",
  "主数字出处",
] as const;

function validateCardTypes(card: unknown): Record<string, unknown> {
  if (!isPlainRecord(card)) throw new QAInputError("立项卡须为对象");
  for (const key of CARD_STRING_FIELDS) {
    if (key in card && typeof card[key] !== "string") {
      throw new QAInputError(`立项卡 ${key} 须为文本`);
    }
  }
  for (const [key, fields] of [
    ["延伸", ["起始小标题", "接的问题", "接法"]],
    ["锚点人物", ["名字"]],
  ] as const) {
    if (!(key in card)) continue;
    const val = card[key];
    if (!isPlainRecord(val)) throw new QAInputError(`立项卡 ${key} 须为对象`);
    for (const field of fields) {
      if (field in val && typeof val[field] !== "string") {
        throw new QAInputError(`立项卡 ${key}.${field} 须为文本`);
      }
    }
  }
  if ("蓝图" in card) {
    const bp = card["蓝图"];
    if (
      !Array.isArray(bp) ||
      bp.some(
        (row) => !isPlainRecord(row) || ("小标题" in row && typeof row["小标题"] !== "string"),
      )
    ) {
      throw new QAInputError("立项卡 蓝图须为对象数组，小标题须为文本");
    }
  }
  return card;
}

export async function loadCardFile(cardPath: string): Promise<Record<string, unknown>> {
  try {
    const raw = await fs.readFile(cardPath, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return validateCardTypes(parsed);
  } catch (err) {
    if (err instanceof QAInputError) throw err;
    throw new QAInputError(`读不到立项卡：${err instanceof Error ? err.message : String(err)}`);
  }
}

function daysAgo(dateStr: string | undefined, todayMs: number): number | null {
  if (!dateStr || !/^\d{4}-\d{2}-\d{2}$/.test(dateStr)) return null;
  const parsed = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(parsed)) return null;
  return Math.floor((todayMs - parsed) / 86_400_000);
}

function checkCardAgainstDraft(
  card: Record<string, unknown>,
  paras: string[],
  title: string,
  ledgerRows: Array<Record<string, string>>,
  headings: string[],
  hpos: Array<[string, number]>,
): Array<["fail" | "warn", string]> {
  const out: Array<["fail" | "warn", string]> = [];
  const text = paras.join("\n");
  const line = lineOf(card);
  const rawLine = asStr(card["内容线"]);
  if (rawLine && !Object.hasOwn(LINES, rawLine)) {
    out.push(["fail", `立项卡内容线“${rawLine}”应为 ${Object.keys(LINES).join("/")}`]);
  }
  const drv = asStr(card["主驱动"]) || LINES[line]?.defaultDriver || "";
  if (!Object.hasOwn(DRIVERS, drv)) {
    out.push(["fail", `立项卡主驱动“${drv}”不在 ${Object.keys(DRIVERS).join("/")} 里`]);
  } else if (!LINES[line].drivers.includes(drv)) {
    out.push([
      "warn",
      `${line}的主驱动一般是 ${LINES[line].drivers.join("/")}，现在是“${drv}”，确认内容线没填错`,
    ]);
  }
  const genre = asStr(card["体裁"]);
  if (!Object.hasOwn(GENRE_MODE, genre)) {
    out.push(["warn", `立项卡体裁“${genre}”应为 长图文/短图文/微头条`]);
  } else if (genre === "快图文" || genre === "深图文") {
    out.push(["warn", `“${genre}”是 3.x 的体裁名，4.0.0 起统一叫“短图文”`]);
  }
  if (!asStr(card["主问题"]).trim()) {
    out.push(["warn", "立项卡没写“主问题”：主稿要回答读者心里的哪一个问号，立项时就定下"]);
  }

  if (GENRE_MODE[genre] === "long") {
    const ext = isPlainRecord(card["延伸"]) ? card["延伸"] : {};
    const startH = asStr(ext["起始小标题"]).trim();
    const followQ = asStr(ext["接的问题"]).trim();
    if (!startH) out.push(["fail", "长图文立项卡要写“延伸.起始小标题”"]);
    if (!followQ) {
      out.push(["fail", "长图文立项卡要写“延伸.接的问题”：延伸节接住主稿留下的哪个问题"]);
    } else if (normH(followQ) === normH(asStr(card["主问题"]))) {
      out.push(["warn", "“延伸.接的问题”和“主问题”是同一个：延伸要接主稿之后冒出来的下一个问题"]);
    }
    const way = asStr(ext["接法"]).trim();
    if (way && !EXT_WAYS[line].includes(way)) {
      out.push(["warn", `${line}的延伸接法写 ${EXT_WAYS[line].join("/")} 之一，现在是“${way}”`]);
    }
    if (asList(ext["出处"]).length === 0) {
      out.push(["warn", "“延伸.出处”为空：延伸节的新事实要单独核实、单独记出处"]);
    }
    if (startH && hpos.length > 0) {
      const split = splitExt(paras, hpos, startH);
      if (!split) {
        out.push(["fail", `正文里找不到延伸节小标题“${startH}”`]);
      } else {
        const anchor = isPlainRecord(card["锚点人物"]) ? card["锚点人物"] : {};
        const nm = asStr(anchor["名字"]).trim();
        if (nm && !split[1].join("\n").includes(nm)) {
          out.push(["warn", `延伸节里“${nm}”没再出现：延伸要接着同一个人或同一个问题往下走`]);
        }
      }
    }
  }

  if (Array.isArray(card["蓝图"]) && card["蓝图"].length > 0) {
    const hs = headings.map(normH);
    const miss: string[] = [];
    for (const row of card["蓝图"]) {
      const sub = isPlainRecord(row) ? asStr(row["小标题"]) : "";
      if (!sub) continue;
      const nsub = normH(sub);
      if (!hs.some((h) => h && (h.includes(nsub) || nsub.includes(h)))) miss.push(sub);
    }
    if (miss.length) {
      out.push([
        "warn",
        `蓝图里的小标题正文没对上：${miss.slice(0, 3).join("、")}。改了结构就回填立项卡`,
      ]);
    }
  }

  const anchor = isPlainRecord(card["锚点人物"]) ? card["锚点人物"] : {};
  const name = asStr(anchor["名字"]).trim();
  if (!name) {
    out.push(["warn", "立项卡没写锚点人物名字"]);
  } else {
    if (!text.includes(name)) {
      out.push(["fail", `锚点人物“${name}”正文里没出现`]);
    } else {
      if (!paras.slice(0, 3).join("\n").includes(name))
        out.push(["warn", `“${name}”没在前三段入场`]);
      if (!paras.slice(-3).join("\n").includes(name))
        out.push(["warn", `“${name}”没贯穿到结尾，最后三段没再出现`]);
    }
    if (SAMPLE_NAME_SET.has(name)) {
      out.push(["warn", `“${name}”是技能示例人名，换一个本篇自己的名字`]);
    }
  }
  if (!anchor["真实案例"]) {
    const m = new RegExp(FAKE_KIN_RE).exec(text);
    if (m) out.push(["fail", `合成人物写成了作者亲历：“${m[0]}…”，改成明示口吻或换真实案例`]);
    if (line === "故事线") {
      const sm = new RegExp(STORY_KIN_RE).exec(text);
      if (sm) out.push(["warn", `“${sm[0]}”：没有真实经历就别用亲历口吻包装故事`]);
    }
  } else if (!anchor["来源"]) {
    out.push(["warn", "标了真实案例，但没写来源"]);
  }

  const mainNum = String(card["主数字"] ?? "").trim();
  if (mainNum) {
    if (!text.includes(mainNum)) out.push(["fail", `主数字“${mainNum}”正文里没出现`]);
    if (!card["主数字出处"]) out.push(["warn", "主数字没写出处链接"]);
  } else if (drv === "账本型") {
    out.push(["warn", "账本型立项卡要写主数字"]);
  }
  if (!card["出处"])
    out.push(["warn", "出处清单为空：政策、金额、日期、所用版本都要有链接或用户素材"]);

  if (line === "故事线") {
    const adapt = asStr(card["改编方式"]);
    if (!ADAPT_WAY_SET.has(adapt)) {
      out.push(["warn", `故事线立项卡要写改编方式：${ADAPT_WAYS.join("/")}（见 s4-story.md）`]);
    }
    const mt = asStr(card["母题"]).trim();
    if (!mt) {
      out.push(["warn", "故事线立项卡要写母题（见 corpus/story/motifs.md），台账靠它查撞题"]);
    } else if (!MOTIF_SET.has(mt)) {
      out.push([
        "warn",
        `母题“${mt}”不在母题库里（${MOTIFS.join("/")}）；新母题先补进 rules/constants.ts 和 corpus/story/motifs.md`,
      ]);
    }
    if (!asStr(card["故事"]).trim()) {
      out.push(["warn", "故事线立项卡要写“故事”（如“精卫填海”），台账靠它查同一故事撞题"]);
    }
    if (asList(card["所用版本"]).length === 0) {
      out.push(["warn", "故事线立项卡要写“所用版本”：书名加篇名或通行译本，动笔前核实原典"]);
    }
  }

  const op = asStr(card["开头式"]);
  const ed = asStr(card["结尾式"]);
  if (op && !OPENINGS[line].includes(op)) {
    out.push(["warn", `${line}的开头式写 ${OPENINGS[line].join("/")} 之一，现在是“${op}”`]);
  }
  if (ed && !ENDINGS[line].includes(ed)) {
    out.push(["warn", `${line}的结尾式写 ${ENDINGS[line].join("/")} 之一，现在是“${ed}”`]);
  }

  const me = new Set([asStr(card["主标题"]), title].filter(Boolean));
  const rows = ledgerRows.filter((r) => !me.has(r["主标题"] ?? ""));
  if (rows.length === 0) return out;
  const todayStr = new Date().toISOString().slice(0, 10);
  const todayMs = Date.parse(`${todayStr}T00:00:00Z`);
  const same = rows.filter((r) => lineOf(r) === line);
  if (same.length > 0) {
    const last = same[same.length - 1];
    if (op && last["开头式"] === op)
      out.push(["warn", `开头式和${line}上一篇一样（${op}），换一种`]);
    if (ed && last["结尾式"] === ed)
      out.push(["warn", `结尾式和${line}上一篇一样（${ed}），换一种`]);
  }
  if (line === "资讯线") {
    const recent = rows.slice(-10).map((r) => r["锚点人名"] ?? "");
    if (name && recent.includes(name)) out.push(["warn", `“${name}”最近 10 篇里用过，撞脸`]);
    if (
      rows.some(
        (r) =>
          r["日期"] === todayStr && r["垂类"] === asStr(card["垂类"]) && lineOf(r) === "资讯线",
      )
    ) {
      out.push(["warn", `今天已经有一篇${asStr(card["垂类"])}，同赛道同日互斥`]);
    }
  } else {
    const win = same.filter((r) => {
      const d = daysAgo(r["日期"], todayMs);
      return d !== null && d >= 0 && d < STORY_REPEAT_DAYS;
    });
    const storyName = asStr(card["故事"]).trim();
    const mt = asStr(card["母题"]).trim();
    if (storyName && win.some((r) => (r["故事"] ?? "").trim() === storyName)) {
      out.push([
        "warn",
        `${STORY_REPEAT_DAYS} 天内写过“${storyName}”，同一故事撞题：换故事，或换一个读者没见过的版本和角度`,
      ]);
    } else if (mt && win.some((r) => (r["母题"] ?? "").trim() === mt)) {
      out.push(["warn", `${STORY_REPEAT_DAYS} 天内写过“${mt}”母题，换一个母题或拉开改编方式`]);
    }
    const way = asStr(card["改编方式"]);
    if (way && same.length > 0 && (same[same.length - 1]["改编方式"] ?? "") === way) {
      out.push(["warn", `连续两篇故事线都是“${way}”，换一种改编方式`]);
    }
  }
  const week: string[] = [];
  for (const r of rows) {
    const d = daysAgo(r["日期"], todayMs);
    if (d !== null && d >= 0 && d < 7) week.push(r["主驱动"] ?? "");
  }
  week.push(drv);
  const bookCount = week.filter((x) => x === "账本型").length;
  if (week.length >= 3 && bookCount / week.length > 0.5) {
    out.push(["warn", `近 7 天账本型 ${bookCount}/${week.length} 篇，超过一半`]);
  }
  return out;
}

export async function evaluateDraftFile(args: {
  file: string;
  card?: string;
  ledger?: string;
  mode?: string;
  articleId?: string;
  titleOverride?: string;
}): Promise<QaReport> {
  const card = args.card ? await loadCardFile(args.card) : null;
  let line = card ? lineOf(card) : undefined;
  let mode = args.mode ?? (card ? GENRE_MODE[asStr(card["体裁"])] : undefined);
  let driver =
    card && Object.hasOwn(DRIVERS, asStr(card["主驱动"])) ? asStr(card["主驱动"]) : undefined;
  if (line && !driver) driver = LINES[line]?.defaultDriver ?? undefined;
  if (driver === "故事型" && !line) line = "故事线";
  mode = mode ? (MODE_ALIAS[mode] ?? mode) : undefined;

  let doc: LoadedManuscript;
  try {
    doc = await loadManuscript(args.file);
  } catch (err) {
    throw new QAInputError(`读不到稿件：${err instanceof Error ? err.message : String(err)}`);
  }
  const t = (args.titleOverride || doc.title || (card ? asStr(card["主标题"]) : ""))
    .trim()
    .replace(/^[《》“”"]+|[《》“”"]+$/g, "");
  if (doc.paras.length === 0) throw new QAInputError("稿件没有正文段落");
  if (!t && mode !== "micro") {
    throw new QAInputError(
      "缺少标题（--title、文内 # 一级标题或立项卡主标题）；微头条请加 --mode micro",
    );
  }
  const extObj = card && isPlainRecord(card["延伸"]) ? card["延伸"] : undefined;
  const extStart = extObj ? asStr(extObj["起始小标题"]) : "";
  const anchorObj = card && isPlainRecord(card["锚点人物"]) ? card["锚点人物"] : undefined;
  const names = anchorObj ? [asStr(anchorObj["名字"])] : [];

  const report = analyzeManuscript({
    title: t,
    headings: doc.headings,
    paras: doc.paras,
    images: doc.images,
    mode,
    driver,
    extStart,
    hpos: doc.hpos,
    line,
    names,
    bold: doc.bold,
  });
  report.hints = [...report.hints, ...markerDensityHints(doc.paras, doc.boldByPara, doc.hpos)];

  const history = await loadHistory(args.ledger, args.articleId ?? "", t);
  if (history.length > 0) {
    report.homogeneity = {
      samples: history.length,
      checks: checkHomogeneity(
        { paras: doc.paras, headings: doc.headings, hpos: doc.hpos },
        history,
      ),
    };
  }
  if (card) {
    const ledgerRows = args.ledger ? await readLedgerFile(args.ledger).catch(() => []) : [];
    const cc = checkCardAgainstDraft(card, doc.paras, t, ledgerRows, doc.headings, doc.hpos);
    report.card_checks = cc;
    const fails = cc.filter(([lv]) => lv === "fail").map(([, msg]) => msg);
    if (fails.length > 0) {
      report.hard_gates.push("立项卡不符");
      report.passed = false;
      report.verdict = `综合${report.overall}分，打回。立项卡不符：${fails.join("；")}。`;
    }
  }
  return report;
}
