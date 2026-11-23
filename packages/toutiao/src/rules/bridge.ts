import fs from "node:fs/promises";
import path from "node:path";
import { runPythonJson, type PythonExecutor } from "@zhizhang/core/python";
import { arr, bool, int, num, obj, opt, record, str, type Parser } from "@zhizhang/core/schema";

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
  timeoutMs?: number;
  executor?: PythonExecutor;
}

const bandTuple: Parser<[number, number]> = (v, p = "$") => {
  const nums = arr(num())(v, p);
  if (nums.length !== 2) {
    return [nums[0] ?? 0, nums[1] ?? 0];
  }
  return [nums[0], nums[1]];
};

const LineStylesSchema = obj(
  {
    openings: arr(str()),
    endings: arr(str()),
  },
  { strict: false },
);

const StyleCatalogSchema: Parser<StyleCatalog> = obj(
  {
    byLine: record(LineStylesSchema),
    allOpenings: arr(str()),
    allEndings: arr(str()),
  },
  { strict: false },
);

export const RulesLimitsSchema = obj(
  {
    rules_version: str({ min: 1 }),
    ok: bool,
    title_max: int({ min: 1 }),
    pass_score: num({ min: 0 }),
    bands: record(bandTuple),
    genres: arr(str()),
    lines: arr(str()),
    drivers: arr(str()),
    statuses: arr(str()),
    styles: opt(StyleCatalogSchema),
  },
  { strict: false },
);

const RulesMarkdownSchema = obj(
  {
    ok: bool,
    markdown: opt(str()),
  },
  { strict: false },
);

export const CardCheckSchema = obj(
  {
    ok: bool,
    valid: opt(bool),
    errors: arr(str()),
  },
  { strict: false },
);

const QaFailSchema = obj(
  {
    code: str(),
    message: str(),
    score: opt(num()),
  },
  { strict: false },
);

export const QaCheckRawSchema = obj(
  {
    ok: bool,
    overall: opt(num()),
    passed: opt(bool),
    score: opt(num()),
    pass: opt(bool),
    warnings: opt(arr(str())),
    fails: opt(arr(QaFailSchema)),
    hard_gates: opt(arr(str())),
    verdict: opt(str()),
    title: opt(str()),
    title_len: opt(int()),
    chars: opt(int()),
    code: opt(str()),
    message: opt(str()),
  },
  { strict: false },
);

export const LedgerShowRawSchema = obj(
  {
    ok: bool,
    rules_version: str(),
    rows: opt(arr(record(str()))),
    total: opt(int()),
    code: opt(str()),
    message: opt(str()),
  },
  { strict: false },
);

export const LedgerMutateSchema = obj(
  {
    ok: bool,
    rules_version: str(),
    row: opt(record(str())),
    existing: opt(bool),
    kept: opt(bool),
    snapshot_date: opt(str()),
    code: opt(str()),
    message: opt(str()),
  },
  { strict: false },
);

function parseStyleCatalog(markdown: string): StyleCatalog {
  const byLine: Record<string, { openings: string[]; endings: string[] }> = {};
  const openingSet = new Set<string>();
  const endingSet = new Set<string>();

  for (const rawLine of markdown.split(/\r?\n/)) {
    const match = /^-\s*([^：]+)：.*开头式\s+([^；\n]+)；结尾式\s+([^；\n]+)/.exec(rawLine.trim());
    if (!match) continue;
    const lineName = match[1].trim();
    const openings = match[2]
      .split("、")
      .map((s) => s.trim())
      .filter(Boolean);
    const endings = match[3]
      .split("、")
      .map((s) => s.trim())
      .filter(Boolean);
    byLine[lineName] = { openings, endings };
    for (const op of openings) openingSet.add(op);
    for (const ed of endings) endingSet.add(ed);
  }

  return {
    byLine,
    allOpenings: [...openingSet],
    allEndings: [...endingSet],
  };
}

interface CachedLimits {
  mtimeMs: number;
  value: RulesLimits;
}

const limitsCache = new Map<string, CachedLimits>();

async function rulesMtimeMs(scriptsDir: string): Promise<number> {
  const st = await fs.stat(path.join(scriptsDir, "rules.py")).catch(() => undefined);
  return st?.mtimeMs ?? 0;
}

export function createRulesBridge(scriptsDir: string, defaultOpts?: RulesBridgeOptions) {
  const bridgeScript = path.join(scriptsDir, "writer_bridge.py");
  const callOpts = (override?: RulesBridgeOptions) => ({
    ...defaultOpts,
    ...override,
  });

  const fetchLimits = async (opts?: RulesBridgeOptions): Promise<RulesLimits> => {
    const merged = callOpts(opts);
    if (!merged.executor) {
      const mtimeMs = await rulesMtimeMs(scriptsDir);
      const cached = limitsCache.get(scriptsDir);
      if (cached && cached.mtimeMs === mtimeMs && mtimeMs > 0) {
        return cached.value;
      }
      const fresh = await runPythonJson(bridgeScript, ["limits"], RulesLimitsSchema, merged);
      if (mtimeMs > 0) limitsCache.set(scriptsDir, { mtimeMs, value: fresh });
      return fresh;
    }
    return runPythonJson(bridgeScript, ["limits"], RulesLimitsSchema, merged);
  };

  return {
    limits(opts?: RulesBridgeOptions): Promise<RulesLimits> {
      return fetchLimits(opts);
    },
    async styles(opts?: RulesBridgeOptions): Promise<StyleCatalog> {
      const lim = await fetchLimits(opts);
      if (lim.styles) return lim.styles;
      const res = await runPythonJson(bridgeScript, ["rules"], RulesMarkdownSchema, callOpts(opts));
      return parseStyleCatalog(res.markdown ?? "");
    },
    /** 立项卡结构预检：经 writer_bridge.py check-card 调 qa_check.load_card，规则不在 TS 复刻。 */
    async checkCard(
      cardPath: string,
      opts?: RulesBridgeOptions,
    ): Promise<{ ok: boolean; errors: string[] }> {
      const res = await runPythonJson(
        bridgeScript,
        ["check-card", "--card", cardPath],
        CardCheckSchema,
        callOpts(opts),
      );
      return { ok: res.ok && (res.valid ?? true), errors: res.errors };
    },
    async qa(
      args: {
        file: string;
        card?: string;
        ledger?: string;
        mode?: string;
        articleId?: string;
      },
      opts?: RulesBridgeOptions,
    ): Promise<QaCheckResult> {
      const cmd = ["qa", "--file", args.file];
      if (args.card) cmd.push("--card", args.card);
      if (args.ledger) cmd.push("--ledger", args.ledger);
      if (args.mode) cmd.push("--mode", args.mode);
      if (args.articleId) cmd.push("--article-id", args.articleId);
      const raw = await runPythonJson(bridgeScript, cmd, QaCheckRawSchema, callOpts(opts));
      return {
        ...raw,
        fails: raw.fails ?? [],
        hard_gates: raw.hard_gates ?? [],
        overall: raw.overall ?? raw.score ?? 0,
        passed: raw.passed ?? raw.pass ?? false,
      };
    },
    async ledgerShow(
      args: { ledger: string; last?: number },
      opts?: RulesBridgeOptions,
    ): Promise<LedgerShowResult> {
      const cmd = ["ledger-show", "--ledger", args.ledger];
      if (args.last !== undefined) cmd.push("--last", String(args.last));
      const raw = await runPythonJson(bridgeScript, cmd, LedgerShowRawSchema, callOpts(opts));
      return {
        ...raw,
        rows: raw.rows ?? [],
        total: raw.total ?? 0,
      };
    },
    ledgerAdd(
      args: {
        card: string;
        ledger: string;
        articleId?: string;
        status?: string;
        date?: string;
      },
      opts?: RulesBridgeOptions,
    ): Promise<LedgerMutateResult> {
      const cmd = ["ledger-add", "--card", args.card, "--ledger", args.ledger];
      if (args.articleId) cmd.push("--article-id", args.articleId);
      if (args.status) cmd.push("--status", args.status);
      if (args.date) cmd.push("--date", args.date);
      return runPythonJson(bridgeScript, cmd, LedgerMutateSchema, callOpts(opts));
    },
    ledgerStatus(
      args: {
        title: string;
        to: string;
        ledger: string;
        articleId?: string;
      },
      opts?: RulesBridgeOptions,
    ): Promise<LedgerMutateResult> {
      const cmd = [
        "ledger-status",
        "--title",
        args.title,
        "--to",
        args.to,
        "--ledger",
        args.ledger,
      ];
      if (args.articleId) cmd.push("--article-id", args.articleId);
      return runPythonJson(bridgeScript, cmd, LedgerMutateSchema, callOpts(opts));
    },
    metricsImport(
      args: {
        articleId: string;
        metricsJson: string;
        ledger: string;
        url?: string;
      },
      opts?: RulesBridgeOptions,
    ): Promise<LedgerMutateResult> {
      const cmd = [
        "metrics-import",
        "--article-id",
        args.articleId,
        "--metrics-json",
        args.metricsJson,
        "--ledger",
        args.ledger,
      ];
      if (args.url) cmd.push("--url", args.url);
      return runPythonJson(bridgeScript, cmd, LedgerMutateSchema, callOpts(opts));
    },
  };
}
