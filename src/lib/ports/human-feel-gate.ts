/**
 * HumanFeelGate — soft sensor for 人味(写法+状态面) + poison axes of QualityPolicy
 * Not a "must sound like character X" gate.
 * （范文腔 / 过齐 / 任务句连排 / 设定清单·账本流水·家长里短）.
 * Heuristics are humble (not a quality law). Default soft warn; strictHuman → deny.
 */
import { allow, deny, warn, info, type GateDecision, type GateMessage } from "./types.js";
import { QUALITY_WOBBLE_RE } from "./quality-policy.js";

export type HumanFeelHitCode =
  | "uniform_short_run"
  | "task_dialogue_wall"
  | "object_list_cold"
  | "setting_enum_dump"
  | "ledger_dump"
  | "domestic_trivia";

export interface HumanFeelHit {
  code: HumanFeelHitCode;
  text: string;
  evidence: string;
}

export interface HumanFeelAuditResult {
  hitCount: number;
  hits: HumanFeelHit[];
  summary: string;
}

/** Markers that prose still has a living person in it (晃动 / 半截 / 身体). */
const WOBBLE_RE = QUALITY_WOBBLE_RE;

/** Dialogue that is mostly transactional / 办事. */
const TASK_DIALOGUE_RE =
  /^(?:把|拿|交|查|点|对|补|报|签|请|过来|过去|打开|关上|放回|拿走|核对|登记|确认|盘点|实点|差价|货架|收据|发票|金额|下次|现在|立刻|马上|必须|需要|应该|给我|你把|你去|你来|先|再|然后)/;

const DIALOGUE_PAIR = /([“「])([\s\S]*?)([”」])/g;

const MIN_CHARS = 120;

export function auditHumanFeel(text: string): HumanFeelAuditResult {
  const body = String(text ?? "").trim();
  const hits: HumanFeelHit[] = [];
  if (body.length < MIN_CHARS) {
    return {
      hitCount: 0,
      hits: [],
      summary: `正文过短（${body.length} 字），人味软雷达跳过`,
    };
  }

  const uniform = detectUniformShortRun(body);
  if (uniform) hits.push(uniform);

  const taskWall = detectTaskDialogueWall(body);
  if (taskWall) hits.push(taskWall);

  const objectCold = detectObjectListCold(body);
  if (objectCold) hits.push(objectCold);

  const enumDump = detectSettingEnumDump(body);
  if (enumDump) hits.push(enumDump);

  const ledger = detectLedgerDump(body);
  if (ledger) hits.push(ledger);

  const domestic = detectDomesticTrivia(body);
  if (domestic) hits.push(domestic);

  const summary =
    hits.length === 0
      ? "人味软雷达未命中（启发式；≠质量过关）"
      : `人味软雷达命中 ${hits.length} 类：${hits.map((h) => h.code).join("、")}`;

  return { hitCount: hits.length, hits, summary };
}

function detectUniformShortRun(text: string): HumanFeelHit | null {
  const sentences = splitSentences(text).filter((s) => s.length >= 4);
  if (sentences.length < 6) return null;

  let bestRun = 0;
  let bestStart = 0;
  let run = 0;
  let runStart = 0;
  let prevLen = -1;

  for (let i = 0; i < sentences.length; i++) {
    const len = sentences[i]!.length;
    const shortish = len >= 4 && len <= 24;
    const nearPrev = prevLen < 0 || Math.abs(len - prevLen) <= 8;
    if (shortish && nearPrev) {
      if (run === 0) runStart = i;
      run += 1;
      if (run > bestRun) {
        bestRun = run;
        bestStart = runStart;
      }
    } else {
      run = shortish ? 1 : 0;
      runStart = i;
    }
    prevLen = len;
  }

  if (bestRun < 6) return null;
  const sample = sentences.slice(bestStart, bestStart + Math.min(bestRun, 4)).join(" / ");
  return {
    code: "uniform_short_run",
    text: `过齐：连续 ${bestRun} 句短句长度接近，节奏像说明书。可拆长短、加停顿或半截念头，让节奏有起伏。`,
    evidence: sample.slice(0, 80),
  };
}

function detectTaskDialogueWall(text: string): HumanFeelHit | null {
  const lines: string[] = [];
  DIALOGUE_PAIR.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = DIALOGUE_PAIR.exec(text)) !== null) {
    const inner = (m[2] ?? "").replace(/\s+/g, "").trim();
    if (inner.length >= 2) lines.push(inner);
  }
  if (lines.length < 4) return null;

  let task = 0;
  for (const line of lines) {
    if (TASK_DIALOGUE_RE.test(line) || /差价|货架|盘点|核对|签字|收据|实点/.test(line)) {
      task += 1;
    }
  }
  const ratio = task / lines.length;
  if (task < 3 || ratio < 0.65) return null;

  return {
    code: "task_dialogue_wall",
    text: `任务句连排：对白约 ${task}/${lines.length} 句在办事（查/点/交/补…），人味偏薄。可掺半截话、跑题、停顿或没说出口的念头。`,
    evidence: lines.slice(0, 3).map((l) => `「${l.slice(0, 24)}」`).join(" "),
  };
}

function detectObjectListCold(text: string): HumanFeelHit | null {
  const paras = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 40);

  for (const para of paras) {
    if (WOBBLE_RE.test(para)) continue;
    const commas = (para.match(/、/g) ?? []).length;
    const deNouns = (para.match(/的[\u4e00-\u9fff]{1,8}/g) ?? []).length;
    // Dense object inventory without wobble
    if (commas >= 4 || deNouns >= 7) {
      return {
        code: "object_list_cold",
        text: `器物清单偏冷：大段物件枚举且少见人物晃动（愣/停/半截话/身体反应）。可留一件物件，把反应写到人身上。`,
        evidence: para.slice(0, 72),
      };
    }
  }
  return null;
}

/** Acquire/list dump: 「获得了A、B、C」设定清单腔（结构密度，非禁词表）. */
const ACQUIRE_RE = /(?:获得了?|拿到了?|得到了?|收入了?|解锁了?|拥有了?|装备了?|携带了?|收获了?)/;

function detectSettingEnumDump(text: string): HumanFeelHit | null {
  const sentences = splitSentences(text).filter((s) => s.length >= 8);
  for (const s of sentences) {
    if (!ACQUIRE_RE.test(s)) continue;
    const commas = (s.match(/、/g) ?? []).length;
    // 获得了X、Y、Z → at least 2顿号 (3 items); or longer dump
    if (commas >= 2) {
      return {
        code: "setting_enum_dump",
        text: `设定清单腔：获得/拿到类句子里用顿号摊开多件（${commas + 1} 项）。改法：嵌进动作与当场压力，一件一件带着阻力写。`,
        evidence: s.slice(0, 72),
      };
    }
  }
  return null;
}

/** Ledger/accounting dump without living wobble — 对账记账流水毒点. */
function detectLedgerDump(text: string): HumanFeelHit | null {
  const paras = text
    .split(/\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length >= 40);

  for (const para of paras) {
    if (WOBBLE_RE.test(para)) continue;
    // Fresh /g each call — avoid lastIndex bleed on module-level regex.
    const money = (para.match(/\d+\s*[元块毛角]|[￥¥]\s*\d+/g) ?? []).length;
    const ops = (para.match(/核对|对账|记账|入账|结余|差额|差价|实点|盘点|金额|收据|发票|价签|账本|账页|记账本/g) ?? []).length;
    // Dense money or ops without person wobble → 流水账
    if (money >= 3 || ops >= 4) {
      return {
        code: "ledger_dump",
        text: `对账记账毒点：段内金额/账务动作过密（金额≈${money}，账务词≈${ops}）且少见人物晃动。改法：账与数字只当这一刻压力，人物带着晃动。`,
        evidence: para.slice(0, 72),
      };
    }
  }
  return null;
}

/** Domestic trivia stretch without stakes — 家长里短毒点. */
const DOMESTIC_RE =
  /洗碗|拖地|叠衣服|电饭煲|拖鞋|买菜|晾衣服|倒垃圾|刷锅|扫地|擦桌子|热饭|泡茶|围裙|抹布|菜板|洗洁精|垃圾袋|晾衣架/;
const STAKE_RE =
  /怎么办|悬着|欠着|门外|门口|钥匙|监控|？|\?\.\.\.|…|还不|还未|会不会|究竟|若是|下次|明天/;

function detectDomesticTrivia(text: string): HumanFeelHit | null {
  const sentences = splitSentences(text).filter((s) => s.length >= 4);
  if (sentences.length < 5) return null;

  let best = 0;
  let run = 0;
  let sampleStart = 0;
  let bestStart = 0;
  for (let i = 0; i < sentences.length; i++) {
    const s = sentences[i]!;
    const domestic = DOMESTIC_RE.test(s);
    const hasStake = STAKE_RE.test(s) || WOBBLE_RE.test(s);
    if (domestic && !hasStake) {
      if (run === 0) sampleStart = i;
      run += 1;
      if (run > best) {
        best = run;
        bestStart = sampleStart;
      }
    } else {
      run = 0;
    }
  }
  if (best < 4) return null;
  const sample = sentences.slice(bestStart, bestStart + Math.min(best, 4)).join(" / ");
  return {
    code: "domestic_trivia",
    text: `家长里短毒点：连续 ${best} 句家务琐事且无压力/书债线索。改法：留一件有戏的生活细节，接回场面压力。`,
    evidence: sample.slice(0, 80),
  };
}

function splitSentences(text: string): string[] {
  const cleaned = text.replace(/[“「][\s\S]*?[”」]/g, " ");
  return cleaned
    .split(/[。！？!?；;\n]+/)
    .map((s) => s.replace(/\s+/g, "").trim())
    .filter(Boolean);
}

export function formatHumanFeelAudit(label: string, result: HumanFeelAuditResult): string {
  const head = [
    `人味软雷达 · ${label}`,
    `- 命中类数：${result.hitCount}`,
    `- ${result.summary}`,
    "",
    "说明：启发式传感，不是质量法；默认 accept 仅警告，strict_human=true 可硬拒。",
  ];
  if (result.hits.length === 0) return [...head, "", "未发现范文腔类命中。"].join("\n");
  const lines = result.hits.map(
    (h, i) => `${i + 1}. [${h.code}] ${h.text}${h.evidence ? `\n   例：${h.evidence}` : ""}`,
  );
  return [...head, "", ...lines].join("\n");
}

export const HumanFeelGate = {
  audit: auditHumanFeel,

  evaluateAccept(opts: {
    body: string;
    strictHuman: boolean;
  }): GateDecision {
    const result = auditHumanFeel(opts.body);
    if (opts.strictHuman && result.hitCount > 0) {
      return deny(
        "human_feel_strict",
        `strict_human=true：人味软雷达命中 ${result.hitCount} 类（${result.hits.map((h) => h.code).join("、")}），拒绝采纳。请改稿后重扫，或关闭 strict_human（默认仅警告 human_feel_hits）。`,
      );
    }
    if (result.hitCount > 0) {
      const msgs: GateMessage[] = result.hits.map((h) =>
        warn("human_feel_hits", `${h.code}：${h.text}`),
      );
      return allow(msgs);
    }
    return allow([info("human_feel_ok", result.summary)]);
  },
};
