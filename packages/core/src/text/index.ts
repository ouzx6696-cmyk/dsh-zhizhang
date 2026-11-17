import { AppError } from "../errors/app-error.js";
import type {
  Chunk,
  ChunkOptions,
  EncodingGuess,
  MatchKeyResult,
  NormalizeResult,
  Para,
  QuoteHit,
  SegmentOptions,
  SegmentResult,
} from "./types.js";

export * from "./types.js";
export * from "./schema.js";

/** A-02 只冻结签名；实现归 C-01（文本机制）。 */
function pending(): never {
  throw new AppError("internal", "未实现：C-01");
}

export function detectEncoding(bytes: Uint8Array): EncodingGuess {
  void bytes;
  return pending();
}

export function normalize(text: string, opts?: { map?: boolean }): NormalizeResult {
  void text;
  void opts;
  return pending();
}

export function matchKey(text: string): MatchKeyResult {
  void text;
  return pending();
}

export function segment(text: string, options: SegmentOptions): SegmentResult {
  void text;
  void options;
  return pending();
}

export function chunk(result: SegmentResult, options: ChunkOptions): Chunk[] {
  void result;
  void options;
  return pending();
}

export function locateQuote(text: string, paras: Para[], ids: string[], quote: string): QuoteHit {
  void text;
  void paras;
  void ids;
  void quote;
  return pending();
}
