/**
 * 头条规则、六维质检与台账桥（纯 TypeScript 进程内执行，无 Python 依赖）。
 */
import {
  BANDS,
  DRIVERS,
  ENDINGS,
  GENRE_MODE,
  LEDGER_STATUSES,
  LINES,
  OPENINGS,
  PASS_SCORE,
  RULES_VERSION,
  TITLE_MAX,
  allEndings,
  allOpenings,
} from "./constants.js";
import { runLedgerAdd, runLedgerShow, runLedgerStatus, runMetricsImport } from "./ledger-store.js";
import { QAInputError, evaluateDraftFile, loadCardFile } from "./qa-card.js";

export interface RulesLimits {
  rules_version: string;
  ok: boolean;
  title_max: number;
  pass_score: number;
  bands: Record<string, [number, number]>;
  genres: string[];
  lines: string[];
  drivers: string[];
  statuses: string[];
  styles?: StyleCatalog;
}

export interface StyleCatalog {
  byLine: Record<string, { openings: string[]; endings: string[] }>;
  allOpenings: string[];
  allEndings: string[];
}

export interface QaCheckResult {
  ok: boolean;
  overall: number;
  passed: boolean;
  score?: number;
  pass?: boolean;
  warnings?: string[];
  fails: Array<{ code: string; message: string; score?: number }>;
  hard_gates: string[];
  verdict?: string;
  title?: string;
  title_len?: number;
  chars?: number;
  code?: string;
  message?: string;
}

export interface LedgerShowResult {
  ok: boolean;
  rules_version: string;
  rows: Array<Record<string, string>>;
  total: number;
  code?: string;
  message?: string;
}

export interface LedgerMutateResult {
  ok: boolean;
  rules_version: string;
  row?: Record<string, string>;
  existing?: boolean;
  kept?: boolean;
  snapshot_date?: string;
  code?: string;
  message?: string;
}

export interface RulesBridgeOptions {
  signal?: AbortSignal;
}

function buildStyleCatalog(): StyleCatalog {
  const byLine: Record<string, { openings: string[]; endings: string[] }> = {};
  for (const line of Object.keys(LINES)) {
    byLine[line] = {
      openings: [...(OPENINGS[line] ?? [])],
      endings: [...(ENDINGS[line] ?? [])],
    };
  }
  return {
    byLine,
    allOpenings: allOpenings(),
    allEndings: allEndings(),
  };
}

function buildLimits(): RulesLimits {
  const bands: Record<string, [number, number]> = {};
  for (const [k, [lo, hi]] of Object.entries(BANDS)) {
    bands[k] = [lo, hi];
  }
  return {
    rules_version: RULES_VERSION,
    ok: true,
    title_max: TITLE_MAX,
    pass_score: PASS_SCORE,
    bands,
    genres: Object.keys(GENRE_MODE),
    lines: Object.keys(LINES),
    drivers: Object.keys(DRIVERS),
    statuses: [...LEDGER_STATUSES],
    styles: buildStyleCatalog(),
  };
}

export function createRulesBridge(_defaultOpts?: RulesBridgeOptions) {
  return {
    async limits(): Promise<RulesLimits> {
      return buildLimits();
    },
    async styles(): Promise<StyleCatalog> {
      return buildStyleCatalog();
    },
    async checkCard(cardPath: string): Promise<{ ok: boolean; errors: string[] }> {
      try {
        await loadCardFile(cardPath);
        return { ok: true, errors: [] };
      } catch (err) {
        if (err instanceof QAInputError) return { ok: false, errors: [err.message] };
        return { ok: false, errors: [err instanceof Error ? err.message : String(err)] };
      }
    },
    async qa(args: {
      file: string;
      card?: string;
      ledger?: string;
      mode?: string;
      articleId?: string;
    }): Promise<QaCheckResult> {
      try {
        const r = await evaluateDraftFile({
          file: args.file,
          card: args.card,
          ledger: args.ledger,
          mode: args.mode,
          articleId: args.articleId,
        });
        const itemFails = r.items
          .filter((i) => i.status === "fail")
          .map((i) => ({ code: `ITEM_${i.key.toUpperCase()}`, message: i.note, score: i.score }));
        const cardFails = (r.card_checks ?? [])
          .filter(([lv]) => lv === "fail")
          .map(([, msg]) => ({ code: "CARD", message: msg }));
        const cardWarns = (r.card_checks ?? [])
          .filter(([lv]) => lv !== "fail")
          .map(([, msg]) => msg);
        const homoChecks = r.homogeneity?.checks ?? [];
        const homoWarns = homoChecks.filter(([lv]) => lv !== "note").map(([, msg]) => msg);
        const homoNotes = homoChecks.filter(([lv]) => lv === "note").map(([, msg]) => msg);
        return {
          ok: true,
          overall: r.overall,
          passed: r.passed,
          score: r.overall,
          pass: r.passed,
          fails: [...itemFails, ...cardFails],
          warnings: [...r.risk_flags, ...r.hints, ...cardWarns, ...homoWarns, ...homoNotes],
          hard_gates: [...r.hard_gates],
          verdict: r.verdict,
          title: r.title,
          title_len: r.title_len,
          chars: r.chars,
        };
      } catch (err) {
        if (err instanceof QAInputError) {
          return {
            ok: false,
            overall: 0,
            passed: false,
            fails: [],
            hard_gates: [],
            code: "INVALID_INPUT",
            message: err.message.slice(0, 800),
          };
        }
        return {
          ok: false,
          overall: 0,
          passed: false,
          fails: [],
          hard_gates: [],
          code: "SCRIPT_FAILED",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async ledgerShow(args: { ledger: string; last?: number }): Promise<LedgerShowResult> {
      try {
        return await runLedgerShow(args);
      } catch (err) {
        return {
          ok: false,
          rules_version: RULES_VERSION,
          rows: [],
          total: 0,
          code: "SCRIPT_FAILED",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async ledgerAdd(args: {
      card: string;
      ledger: string;
      articleId?: string;
      status?: string;
      date?: string;
    }): Promise<LedgerMutateResult> {
      try {
        return await runLedgerAdd(args);
      } catch (err) {
        return {
          ok: false,
          rules_version: RULES_VERSION,
          code: "SCRIPT_FAILED",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async ledgerStatus(args: {
      title: string;
      to: string;
      ledger: string;
      articleId?: string;
    }): Promise<LedgerMutateResult> {
      try {
        return await runLedgerStatus(args);
      } catch (err) {
        return {
          ok: false,
          rules_version: RULES_VERSION,
          code: "SCRIPT_FAILED",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
    async metricsImport(args: {
      articleId: string;
      metricsJson: string;
      ledger: string;
      url?: string;
    }): Promise<LedgerMutateResult> {
      try {
        return await runMetricsImport(args);
      } catch (err) {
        return {
          ok: false,
          rules_version: RULES_VERSION,
          code: "SCRIPT_FAILED",
          message: err instanceof Error ? err.message : String(err),
        };
      }
    },
  };
}
