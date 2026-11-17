/** 文本机制类型的运行时解析器（F2 §5.1 / §8）。 */
import { arr, bool, int, lit, num, obj, opt, str, type Parser } from "../schema/parse.js";
import type { Chunk, EncodingGuess, Para, Segment } from "./types.js";

export const TextEncodingSchema = lit("utf-8", "utf-16le", "utf-16be", "gb18030", "big5");

const segmentLevel: Parser<Segment["level"]> = (value, path = "$") => {
  const level = int({ min: 1, max: 6 })(value, path);
  if (level === 1) return 1;
  if (level === 2) return 2;
  if (level === 3) return 3;
  if (level === 4) return 4;
  if (level === 5) return 5;
  return 6;
};

export const ParaSchema: Parser<Para> = obj({
  id: str({ min: 1, max: 60 }),
  start: int({ min: 0 }),
  end: int({ min: 0 }),
  hash: str({ min: 1, max: 200 }),
  oversized: opt(bool),
});

export const SegmentSchema: Parser<Segment> = obj({
  id: str({ min: 1, max: 60 }),
  level: segmentLevel,
  title: str({ max: 500 }),
  semantic: opt(lit("volume", "act", "chapter")),
  hint: opt(str({ max: 200 })),
  start: int({ min: 0 }),
  end: int({ min: 0 }),
  paras: arr(ParaSchema),
  titlePath: arr(str({ max: 500 })),
});

export const ChunkSchema: Parser<Chunk> = obj({
  index: int({ min: 0 }),
  total: int({ min: 0 }),
  segmentIds: arr(str({ max: 60 })),
  paras: arr(str({ max: 60 })),
  contextOnly: arr(str({ max: 60 })),
  tokens: int({ min: 0 }),
  breadcrumb: str({ max: 1000 }),
});

export const EncodingGuessSchema: Parser<EncodingGuess> = obj({
  encoding: TextEncodingSchema,
  confidence: num({ min: 0, max: 1 }),
  bom: bool,
  candidates: arr(
    obj({
      encoding: TextEncodingSchema,
      score: num({ min: 0, max: 1 }),
      preview: str({ max: 500 }),
    }),
  ),
});
