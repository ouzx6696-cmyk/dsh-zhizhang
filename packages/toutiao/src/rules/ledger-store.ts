/**
 * 头条发稿台账（log.csv / ledger.csv）纯 TypeScript 读写与回流合并实现。
 * 兼容 UTF-8 BOM、RFC-4180 CSV 转义、公式注入防护、原子写与跨调用写锁。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import {
  GENRE_MODE,
  LEDGER_FIELDS,
  LEDGER_METRIC_FIELDS,
  LINES,
  METRIC_SNAPSHOT_FIELDS,
  RULES_VERSION,
  lineOf,
} from "./constants.js";
import { escapeCsvFormula, formatCsvCell, parseCsvRows, unescapeCsvFormula } from "./csv.js";

const ledgerLock = createLockService(systemClock);

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function isErrnoCode(err: unknown, code: string): boolean {
  return Boolean(err && typeof err === "object" && "code" in err && err.code === code);
}

export async function readLedgerFile(filePath: string): Promise<Array<Record<string, string>>> {
  let bytes: Buffer;
  try {
    bytes = await fs.readFile(filePath);
  } catch (err) {
    if (isErrnoCode(err, "ENOENT")) return [];
    throw err;
  }
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  } catch {
    throw new AppError("input.invalid", `台账 ${filePath} 不是 UTF-8 编码，请用 UTF-8 另存后重试`, {
      filePath,
    });
  }
  const grid = parseCsvRows(text).filter((r) => r.some((cell) => cell.length > 0));
  if (grid.length === 0) return [];
  const header = grid[0];
  const out: Array<Record<string, string>> = [];
  for (let i = 1; i < grid.length; i += 1) {
    const raw = grid[i];
    const record: Record<string, string> = {};
    for (let j = 0; j < header.length; j += 1) {
      const key = header[j];
      if (!key) continue;
      record[key] = unescapeCsvFormula(raw[j] ?? "");
    }
    out.push(record);
  }
  return out;
}

async function writeLedgerFile(
  filePath: string,
  rows: Array<Record<string, string>>,
): Promise<void> {
  const fields: string[] = [...LEDGER_FIELDS, ...LEDGER_METRIC_FIELDS];
  if (rows.some((r) => Boolean(r["文章ID"]))) fields.push("文章ID");
  const lines: string[] = [fields.map(formatCsvCell).join(",")];
  for (const raw of rows) {
    const row = { ...raw };
    if (!row["内容线"]) row["内容线"] = lineOf(row);
    const cells = fields.map((field) => formatCsvCell(escapeCsvFormula(row[field] ?? "")));
    lines.push(cells.join(","));
  }
  await atomicWrite(filePath, `\uFEFF${lines.join("\r\n")}\r\n`);
}

async function withLedgerLock<T>(ledgerPath: string, fn: () => Promise<T>): Promise<T> {
  const abs = path.resolve(ledgerPath);
  await fs.mkdir(path.dirname(abs), { recursive: true });
  return ledgerLock.write({ kind: "ledger", path: abs }, fn);
}

function strVal(value: unknown): string {
  return typeof value === "string"
    ? value
    : value === undefined || value === null
      ? ""
      : String(value);
}

function rowFromCard(
  card: Record<string, unknown>,
  date: string,
  status: string,
): Record<string, string> {
  const ln = lineOf(card);
  const anchor = isRecord(card["锚点人物"]) ? card["锚点人物"] : {};
  return {
    日期: date,
    内容线: ln,
    体裁: strVal(card["体裁"]),
    垂类: strVal(card["垂类"]),
    主驱动: strVal(card["主驱动"]) || LINES[ln]?.defaultDriver || "",
    母题: ln === "故事线" ? strVal(card["母题"]) : "",
    母体: strVal(card["母体"]),
    故事: ln === "故事线" ? strVal(card["故事"]) : "",
    改编方式: ln === "故事线" ? strVal(card["改编方式"]) : "",
    开头式: strVal(card["开头式"]),
    结尾式: strVal(card["结尾式"]),
    锚点人名: strVal(anchor["名字"]),
    主标题: strVal(card["主标题"]),
    状态: status,
  };
}

export async function runLedgerShow(args: { ledger: string; last?: number }): Promise<{
  ok: boolean;
  rules_version: string;
  rows: Array<Record<string, string>>;
  total: number;
}> {
  return withLedgerLock(args.ledger, async () => {
    const rows = await readLedgerFile(args.ledger);
    const last = args.last ?? 10;
    const sliced = last > 0 ? rows.slice(-last) : rows;
    const out = sliced.map((r) => ({ ...r, 内容线: r["内容线"] || lineOf(r) }));
    return { ok: true, rules_version: RULES_VERSION, rows: out, total: rows.length };
  });
}

export async function runLedgerAdd(args: {
  card: string;
  ledger: string;
  articleId?: string;
  status?: string;
  date?: string;
}): Promise<{
  ok: boolean;
  rules_version: string;
  row?: Record<string, string>;
  existing?: boolean;
  code?: string;
  message?: string;
}> {
  return withLedgerLock(args.ledger, async () => {
    const parsed: unknown = JSON.parse(await fs.readFile(args.card, "utf8"));
    if (!isRecord(parsed)) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: "立项卡须为对象",
      };
    }
    const genre = strVal(parsed["体裁"]);
    if (!Object.hasOwn(GENRE_MODE, genre)) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: "立项卡体裁应为 长图文/短图文/微头条",
      };
    }
    const line = strVal(parsed["内容线"]);
    if (line && !Object.hasOwn(LINES, line)) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: `立项卡内容线应为 ${Object.keys(LINES).join("/")}`,
      };
    }
    const rows = await readLedgerFile(args.ledger);
    const date = args.date ?? new Date().toISOString().slice(0, 10);
    const row = rowFromCard(parsed, date, args.status ?? "已验收");
    const identity = args.articleId ?? "";
    const hits = identity ? rows.filter((r) => r["文章ID"] === identity) : [];
    const legacy = rows.filter((r) => !r["文章ID"] && r["主标题"] === row["主标题"]);
    if (hits.length > 1 || (hits.length === 0 && legacy.length > 1)) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: "旧台账存在歧义，请核对重复记录",
      };
    }
    if (identity) row["文章ID"] = identity;
    const existing = hits[0] ?? legacy[0];
    if (existing) {
      existing["主标题"] = row["主标题"];
      if (identity) existing["文章ID"] = identity;
      await writeLedgerFile(args.ledger, rows);
      return { ok: true, rules_version: RULES_VERSION, row: existing, existing: true };
    }
    rows.push(row);
    await writeLedgerFile(args.ledger, rows);
    return { ok: true, rules_version: RULES_VERSION, row };
  });
}

export async function runLedgerStatus(args: {
  title: string;
  to: string;
  ledger: string;
  articleId?: string;
}): Promise<{
  ok: boolean;
  rules_version: string;
  row?: Record<string, string>;
  code?: string;
  message?: string;
}> {
  return withLedgerLock(args.ledger, async () => {
    const rows = await readLedgerFile(args.ledger);
    let hit = args.articleId ? rows.filter((r) => r["文章ID"] === args.articleId) : [];
    if (hit.length === 0) {
      hit = rows.filter((r) => !r["文章ID"] && r["主标题"] === args.title);
    }
    if (hit.length > 1) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: "旧台账存在同标题记录，请先核对",
      };
    }
    if (hit.length === 0) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "NOT_FOUND",
        message: `台账里没有“${args.title}”`,
      };
    }
    const target = hit[hit.length - 1];
    target["状态"] = args.to;
    await writeLedgerFile(args.ledger, rows);
    return { ok: true, rules_version: RULES_VERSION, row: target };
  });
}

export async function runMetricsImport(args: {
  articleId: string;
  metricsJson: string;
  ledger: string;
  url?: string;
}): Promise<{
  ok: boolean;
  rules_version: string;
  row?: Record<string, string>;
  kept?: boolean;
  snapshot_date?: string;
  code?: string;
  message?: string;
}> {
  let entries: unknown;
  try {
    entries = JSON.parse(args.metricsJson);
  } catch (err) {
    return {
      ok: false,
      rules_version: RULES_VERSION,
      code: "INVALID_INPUT",
      message: `metrics JSON 无法解析：${err instanceof Error ? err.message : String(err)}`,
    };
  }
  if (!Array.isArray(entries) || entries.length === 0) {
    return {
      ok: false,
      rules_version: RULES_VERSION,
      code: "INVALID_INPUT",
      message: "metrics 须为非空数组",
    };
  }
  const items: Array<Record<string, unknown>> = [];
  for (const item of entries) {
    if (!isRecord(item)) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: "metrics 数组里含非对象项",
      };
    }
    if (!strVal(item["日期"]).trim()) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: "metrics 每行都要有 日期",
      };
    }
    if (!METRIC_SNAPSHOT_FIELDS.some((f) => strVal(item[f]).trim().length > 0)) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "INVALID_INPUT",
        message: "有一行没有任何指标值",
      };
    }
    items.push(item);
  }

  return withLedgerLock(args.ledger, async () => {
    const rows = await readLedgerFile(args.ledger);
    let hits = rows.filter((r) => r["文章ID"] === args.articleId);
    if (hits.length === 0 && args.url) hits = rows.filter((r) => r["链接"] === args.url);
    if (hits.length === 0) {
      return {
        ok: false,
        rules_version: RULES_VERSION,
        code: "NOT_FOUND",
        message: `台账里没有文章 ${args.articleId}（先 toutiao_ledger_add 记账）`,
      };
    }
    const row = hits[hits.length - 1];
    let latest = items[0];
    for (const item of items) {
      if (strVal(item["日期"]) > strVal(latest["日期"])) latest = item;
    }
    const latestDate = strVal(latest["日期"]);
    const stored = (row["数据日期"] ?? "").trim();
    if (stored && stored > latestDate) {
      return {
        ok: true,
        rules_version: RULES_VERSION,
        row,
        kept: true,
        snapshot_date: row["数据日期"] ?? "",
      };
    }
    if (args.url) row["链接"] = args.url;
    row["数据日期"] = latestDate;
    for (const field of METRIC_SNAPSHOT_FIELDS) {
      row[field] = strVal(latest[field]).trim();
    }
    await writeLedgerFile(args.ledger, rows);
    return {
      ok: true,
      rules_version: RULES_VERSION,
      row,
      kept: false,
      snapshot_date: row["数据日期"] ?? "",
    };
  });
}
