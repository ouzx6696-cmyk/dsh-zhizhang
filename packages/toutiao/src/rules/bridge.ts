import path from "node:path";
import { runPythonJson } from "@zhizhang/core/python";

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
  /** qa_check.py 的六维明细（key/score/status/note）；TS 侧收拢为 fails。 */
  items?: Array<{ key: string; score?: number; status?: string; note?: string }>;
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
  kept?: number;
  snapshot_date?: string;
  code?: string;
  message?: string;
}

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

const CARD_CHECK_PY = [
  "import json, sys",
  "sys.path.insert(0, sys.argv[1])",
  "import qa_check",
  "try:",
  "    qa_check.load_card(sys.argv[2])",
  "    print(json.dumps({'ok': True, 'errors': []}, ensure_ascii=False))",
  "except qa_check.QAInputError as exc:",
  "    print(json.dumps({'ok': False, 'errors': [str(exc)]}, ensure_ascii=False))",
].join("\n");

export function createRulesBridge(scriptsDir: string) {
  const bridgeScript = path.join(scriptsDir, "writer_bridge.py");
  const qaScript = path.join(scriptsDir, "qa_check.py");

  return {
    limits(): Promise<RulesLimits> {
      return runPythonJson<RulesLimits>(bridgeScript, ["limits"]);
    },
    async styles(): Promise<StyleCatalog> {
      const res = await runPythonJson<{ ok: boolean; markdown?: string }>(bridgeScript, ["rules"]);
      return parseStyleCatalog(res.markdown ?? "");
    },
    /** 立项卡结构预检：只调 qa_check 的 load_card（类型校验），不需要稿件；规则本身不在 TS 复刻。 */
    checkCard(cardPath: string): Promise<{ ok: boolean; errors: string[] }> {
      return runPythonJson<{ ok: boolean; errors: string[] }>("-c", [
        CARD_CHECK_PY,
        path.dirname(qaScript),
        cardPath,
      ]);
    },
    async qa(args: {
      file: string;
      card?: string;
      ledger?: string;
      mode?: string;
      articleId?: string;
    }): Promise<QaCheckResult> {
      const cmd = ["qa", "--file", args.file];
      if (args.card) cmd.push("--card", args.card);
      if (args.ledger) cmd.push("--ledger", args.ledger);
      if (args.mode) cmd.push("--mode", args.mode);
      if (args.articleId) cmd.push("--article-id", args.articleId);
      const raw = await runPythonJson<QaCheckResult>(bridgeScript, cmd);
      return {
        ...raw,
        overall: raw.overall ?? raw.score ?? 0,
        passed: raw.passed ?? raw.pass ?? false,
        // qa_check.py 只输出六维 items（含 warn/fail），不给 fails 字段；
        // 这里按 status != "pass" 收拢，供打回提示与质检改稿引用。
        fails:
          raw.fails ??
          (raw.items ?? [])
            .filter((item) => item.status !== "pass")
            .map((item) => ({
              code: item.key,
              message: `${item.key}${item.score ?? ""}分：${item.note ?? ""}`,
              score: item.score,
            })),
      };
    },
    ledgerShow(args: { ledger: string; last?: number }): Promise<LedgerShowResult> {
      const cmd = ["ledger-show", "--ledger", args.ledger];
      if (args.last !== undefined) cmd.push("--last", String(args.last));
      return runPythonJson<LedgerShowResult>(bridgeScript, cmd);
    },
    ledgerAdd(args: {
      card: string;
      ledger: string;
      articleId?: string;
      status?: string;
      date?: string;
    }): Promise<LedgerMutateResult> {
      const cmd = ["ledger-add", "--card", args.card, "--ledger", args.ledger];
      if (args.articleId) cmd.push("--article-id", args.articleId);
      if (args.status) cmd.push("--status", args.status);
      if (args.date) cmd.push("--date", args.date);
      return runPythonJson<LedgerMutateResult>(bridgeScript, cmd);
    },
    ledgerStatus(args: {
      title: string;
      to: string;
      ledger: string;
      articleId?: string;
    }): Promise<LedgerMutateResult> {
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
      return runPythonJson<LedgerMutateResult>(bridgeScript, cmd);
    },
    metricsImport(args: {
      articleId: string;
      metricsJson: string;
      ledger: string;
      url?: string;
    }): Promise<LedgerMutateResult> {
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
      return runPythonJson<LedgerMutateResult>(bridgeScript, cmd);
    },
  };
}
