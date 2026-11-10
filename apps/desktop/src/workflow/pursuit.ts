import { record, list, text, locate } from "./schema";

interface Receipt {
  payoffs: { type: string; quote: string }[];
  terms: { name: string; action: "introduced" | "used"; quote: string }[];
  characters: {
    name: string;
    tag: string;
    action: "debut" | "repeat" | "second-side";
    quote: string;
  }[];
  threads: {
    name: string;
    span: "short" | "medium" | "long";
    action: "open" | "close";
    due: number;
    quote: string;
  }[];
}
function choice<T extends string>(value: unknown, choices: readonly T[]): T {
  if (typeof value !== "string" || !choices.includes(value as T))
    throw new Error("追读记账类别无效");
  return value as T;
}
/** At extraction, every receipt must point into the finalized prose, never into the outline. */
export function pursuitReceipt(value: unknown, body?: string): Receipt {
  const r = record(value);
  const evidence = (raw: Record<string, unknown>) => {
    const quote = text(raw.quote, "追读证据", 1000);
    if (body === undefined) return quote;
    const exact = locate(body, quote);
    if (exact === undefined) throw new Error("追读记账证据不在定稿正文中");
    return exact;
  };
  const rows = (key: string) => list(r[key], key, 30).map(record);
  return {
    payoffs: rows("payoffs").map((row) => ({
      type: text(row.type, "兑现类别", 100),
      quote: evidence(row),
    })),
    terms: rows("terms").map((row) => ({
      name: text(row.name, "设定", 200),
      action: choice(row.action, ["introduced", "used"]),
      quote: evidence(row),
    })),
    characters: rows("characters").map((row) => ({
      name: text(row.name, "人物", 200),
      tag: text(row.tag, "标签", 200),
      action: choice(row.action, ["debut", "repeat", "second-side"]),
      quote: evidence(row),
    })),
    threads: rows("threads").map((row) => {
      if (typeof row.due !== "number" || !Number.isSafeInteger(row.due) || row.due < 1)
        throw new Error("悬念到期章须为正整数");
      return {
        name: text(row.name, "悬念", 200),
        span: choice(row.span, ["short", "medium", "long"]),
        action: choice(row.action, ["open", "close"]),
        due: row.due,
        quote: evidence(row),
      };
    }),
  };
}
export const PURSUIT_RECEIPT_SHAPE =
  '另返回 pursuit:{"payoffs":[{"type":"兑现类别","quote":"兑现原文"}],"terms":[{"name":"名词","action":"introduced/used","quote":"原文"}],"characters":[{"name":"姓名","tag":"标签","action":"debut/repeat/second-side","quote":"原文"}],"threads":[{"name":"稳定线索名","span":"short/medium/long","action":"open/close","due":10,"quote":"原文"}]}。due是全书到期章序；只记本章实际发生的动作，无则空数组，不能把章纲计划冒充兑现；既有主体沿用旧账名称。';
export interface PursuitChapter {
  id: string;
  hash: string;
  position?: number;
  revision?: string;
  unit?: string;
  hook: string;
  pursuit?: Receipt;
}
function ledgerWindow<T>(rows: T[]) {
  return { total: rows.length, items: rows.slice(0, 30), omitted: Math.max(0, rows.length - 30) };
}
/** These four views are derived from chapter receipts, so re-ledgering never increments a second counter. */
export function pursuitLedger(
  chapters: PursuitChapter[],
  position: number,
  unit: string | undefined,
  expectedChapters: number,
) {
  const ordered = chapters
    .filter((row) => row.position !== undefined && row.position < position)
    .sort((a, b) => (a.position ?? 0) - (b.position ?? 0));
  const known = ordered.filter((row) => row.pursuit !== undefined);
  const lastPayoff = known.filter((row) => (row.pursuit?.payoffs.length ?? 0) > 0).at(-1);
  const hooks = ordered
    .slice(-10)
    .map((row) => ({ chapter: row.id, position: row.position, type: row.hook }));
  const lastHook = hooks.at(-1)?.type;
  let sameHookRun = 0;
  for (const hook of [...hooks].reverse()) {
    if (hook.type !== lastHook || hook.position !== position - sameHookRun - 1) break;
    sameHookRun++;
  }
  const threads = new Map<string, { name: string; span: string; opened: number; due: number }>();
  const terms = new Map<string, { name: string; introduced?: number; used?: number }>();
  const characters = new Map<
    string,
    { name: string; tag: string; debut?: number; repeat?: number; secondSide?: number }
  >();
  for (const row of known) {
    const at = row.position ?? 0;
    const receipt = row.pursuit;
    if (receipt === undefined) continue;
    for (const item of receipt.threads) {
      if (item.action === "close") threads.delete(item.name);
      else if (!threads.has(item.name))
        threads.set(item.name, { name: item.name, span: item.span, opened: at, due: item.due });
    }
    for (const item of receipt.terms) {
      const previous = terms.get(item.name) ?? { name: item.name };
      terms.set(item.name, {
        ...previous,
        [item.action === "used" ? "used" : "introduced"]:
          item.action === "used" ? at : (previous.introduced ?? at),
      });
    }
    for (const item of receipt.characters) {
      const previous = characters.get(item.name) ?? { name: item.name, tag: item.tag };
      characters.set(item.name, {
        ...previous,
        tag: item.tag,
        [item.action === "second-side" ? "secondSide" : item.action]:
          item.action === "debut" ? (previous.debut ?? at) : at,
      });
    }
  }
  return {
    coverage: {
      recorded: known.length,
      preceding: expectedChapters,
      note: "未记账不等于未兑现；缺失章节不能推断",
    },
    payoffCalendar: {
      lastChapter: lastPayoff?.id ?? null,
      chaptersSince: lastPayoff?.position === undefined ? null : position - lastPayoff.position,
      unitPayoffs:
        unit === undefined
          ? null
          : known
              .filter((row) => row.unit === unit)
              .reduce((sum, row) => sum + (row.pursuit?.payoffs.length ?? 0), 0),
    },
    hooks: { recent: hooks, sameHookRun },
    threads: {
      counts: Object.fromEntries(
        ["short", "medium", "long"].map((span) => [
          span,
          [...threads.values()].filter((item) => item.span === span).length,
        ]),
      ),
      ...ledgerWindow(
        [...threads.values()]
          .sort((a, b) => a.due - b.due)
          .map((item) => ({ ...item, overdue: item.due < position })),
      ),
    },
    terms: ledgerWindow(
      [...terms.values()]
        .sort((a, b) => Number(a.used !== undefined) - Number(b.used !== undefined))
        .map((item) => ({
          ...item,
          notUsed: item.used === undefined,
          notIntroduced: item.introduced === undefined,
        })),
    ),
    characters: ledgerWindow(
      [...characters.values()].map((item) => ({
        ...item,
        repeatOverdue: item.debut !== undefined && position - (item.repeat ?? item.debut) > 10,
        secondSideOverdue:
          item.debut !== undefined && item.secondSide === undefined && position - item.debut > 15,
      })),
    ),
  };
}
