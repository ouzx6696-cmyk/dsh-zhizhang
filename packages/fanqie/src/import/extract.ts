import { AppError } from "@zhizhang/core/errors";
import { matchKey, type Para, locateQuote, type QuoteHit } from "@zhizhang/core/text";
import { ExtractResultSchema } from "./schema.js";
import type { ExtractItem, ExtractResult } from "./types.js";
import type { BibleSnapshot } from "../bible/types.js";

export function parseExtract(raw: string): ExtractResult {
  try {
    const input: unknown = JSON.parse(raw.replace(/^\s*```(?:json)?\s*|\s*```\s*$/gu, ""));
    if (input && typeof input === "object" && "items" in input && Array.isArray(input.items)) {
      input.items = input.items.slice(0, 80).map((item: unknown) => {
        if (
          item &&
          typeof item === "object" &&
          "confidence" in item &&
          typeof item.confidence === "string" &&
          item.confidence.trim()
        )
          return { ...item, confidence: Number(item.confidence) };
        return item;
      });
    }
    return ExtractResultSchema(input);
  } catch (error) {
    throw new AppError("model.output_invalid", "抽取结果不符合约定", {
      detail: error instanceof Error ? error.message : String(error),
    });
  }
}
export function buildLookup(bible: BibleSnapshot, text: string, cap = 4000): string {
  const entities = bible.entities.map((entity) => ({
    id: entity.id,
    kind: entity.kind,
    name: entity.name,
    aliases: entity.aliases,
    global: entity.global,
    hits: [entity.name, ...entity.aliases].reduce(
      (sum, name) => sum + (name ? text.split(name).length - 1 : 0),
      0,
    ),
  }));
  const rows = [
    ...entities,
    ...bible.threads.map((thread) => ({
      id: thread.id,
      kind: "thread",
      name: thread.title,
      aliases: [],
      global: false,
      hits: text.split(thread.title).length - 1,
    })),
  ].sort((a, b) => b.hits - a.hits || Number(b.global) - Number(a.global));
  const lines: string[] = [];
  let used = 0,
    omitted = 0;
  for (const row of rows) {
    const line = `${row.id} | ${row.kind} | ${row.name} | ${row.aliases.join(",")}`;
    if (used + line.length > cap - 40) {
      omitted++;
      continue;
    }
    used += line.length;
    lines.push(line);
  }
  if (omitted) lines.push(`已截断 ${omitted} 条`);
  return lines.join("\n");
}
export interface LocatedItem {
  item: ExtractItem;
  hit: QuoteHit;
  chunk: number;
  paragraphText?: string;
}
export function locateExtract(
  text: string,
  paras: Para[],
  items: ExtractItem[],
  index: number,
  contextOnly: string[] = [],
): LocatedItem[] {
  return items.flatMap((item) => {
    const hit = locateQuote(text, paras, item.src, item.quote);
    if (hit.para && contextOnly.includes(hit.para)) return [];
    const paragraph = hit.para ? paras.find((para) => para.id === hit.para) : undefined;
    return [
      {
        item: { ...item, tmp: `c${index}:${item.tmp}` },
        hit,
        chunk: index,
        paragraphText: paragraph ? text.slice(paragraph.start, paragraph.end) : undefined,
      },
    ];
  });
}
export function nameKey(name: string): string {
  return matchKey(name.replace(/(?:长老|师兄|师姐|执事|前辈|大人|公子|姑娘|掌门|宗主)$/u, "")).key;
}
