import { createHash } from "node:crypto";
import { AppError } from "../errors/app-error.js";
import type { Chunk, ChunkOptions, Para, SegmentResult } from "./types.js";

function suffix(index: number): string {
  let result = "";
  do {
    result = String.fromCharCode(97 + (index % 26)) + result;
    index = Math.floor(index / 26) - 1;
  } while (index >= 0);
  return result;
}

export function chunk(result: SegmentResult, options: ChunkOptions): Chunk[] {
  const { maxTokens, estimate } = options;
  if (!Number.isFinite(maxTokens) || maxTokens < 1)
    throw new AppError("input.invalid", "文本块预算必须为正数");
  const source = result.text;
  const size = (start: number, end: number) => {
    const tokens = estimate(source.slice(start, end));
    if (!Number.isFinite(tokens) || tokens < 0)
      throw new AppError("input.invalid", "无效的文本用量估计");
    return Math.ceil(tokens);
  };
  const items: Array<{
    para: Para;
    segment: string;
    breadcrumb: string;
    fragment: boolean;
    tokens: number;
  }> = [];
  for (const segment of result.segments) {
    for (const para of segment.paras) {
      const total = size(para.start, para.end);
      const parts: Array<[number, number]> = [];
      if (total <= maxTokens) parts.push([para.start, para.end]);
      else {
        let from = para.start;
        let to = from;
        for (const match of source
          .slice(para.start, para.end)
          .matchAll(/[^。！？\n]*[。！？\n]+|[^。！？\n]+$/gu)) {
          const end = para.start + match.index + match[0].length;
          if (size(from, end) > maxTokens && to > from) {
            parts.push([from, to]);
            from = to;
          }
          to = end;
          // 没有可切句界时，按 Unicode 字符边界切，保证任一块都不超预算。
          while (size(from, to) > maxTokens) {
            let low = from,
              high = to;
            while (low < high) {
              const mid = Math.ceil((low + high) / 2);
              if (size(from, mid) <= maxTokens) low = mid;
              else high = mid - 1;
            }
            let cut = low;
            if (cut > from && /[\uD800-\uDBFF]/u.test(source[cut - 1])) cut--;
            if (cut <= from) throw new AppError("input.invalid", "预算不足以容纳一个字符");
            parts.push([from, cut]);
            from = cut;
          }
        }
        if (to > from) parts.push([from, to]);
      }
      parts.forEach(([start, end], index) =>
        items.push({
          para:
            parts.length === 1
              ? para
              : {
                  id: para.id + suffix(index),
                  start,
                  end,
                  oversized: true,
                  hash: createHash("sha256")
                    .update(source.slice(start, end))
                    .digest("hex")
                    .slice(0, 12),
                },
          segment: segment.id,
          breadcrumb: segment.titlePath.join(" › "),
          fragment: parts.length > 1,
          tokens: size(start, end),
        }),
      );
    }
  }
  const chunks: Chunk[] = [];
  let current: Chunk | undefined;
  const overlap = Math.max(0, Math.floor(options.overlapParas ?? 1));
  const lookup = new Map(items.map((item) => [item.para.id, item]));
  const totals = new Map<string, number>();
  for (const item of items) totals.set(item.segment, (totals.get(item.segment) ?? 0) + item.tokens);
  for (let index = 0; index < items.length; index++) {
    const item = items[index];
    const newSection = index === 0 || items[index - 1].segment !== item.segment;
    const sectionTokens = newSection ? (totals.get(item.segment) ?? 0) : 0;
    if (
      !current ||
      current.tokens + item.tokens > maxTokens ||
      (newSection && current.tokens + sectionTokens > maxTokens)
    ) {
      const previous = current;
      current = {
        index: chunks.length,
        total: 0,
        segmentIds: [],
        paras: [],
        contextOnly: [],
        tokens: 0,
        breadcrumb: item.breadcrumb,
      };
      if (previous && overlap > 0) {
        for (const id of previous.paras.slice(-overlap)) {
          const tokens = lookup.get(id)?.tokens ?? 0;
          if (
            current.tokens +
              tokens +
              (newSection && sectionTokens <= maxTokens ? sectionTokens : item.tokens) <=
            maxTokens
          ) {
            current.contextOnly.push(id);
            current.tokens += tokens;
          }
        }
      }
      chunks.push(current);
    }
    current.paras.push(item.para.id);
    current.tokens += item.tokens;
    if (!current.segmentIds.includes(item.segment)) current.segmentIds.push(item.segment);
    if (item.fragment) (current.fragments ??= []).push(item.para);
  }
  return chunks.map((item) => ({ ...item, total: chunks.length }));
}
