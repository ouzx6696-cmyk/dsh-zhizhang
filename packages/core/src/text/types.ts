/** 文本机制层类型：只描述字符串与编码，不含任何业务语义。 */

export type TextEncoding = "utf-8" | "utf-16le" | "utf-16be" | "gb18030" | "big5";

export interface EncodingCandidate {
  encoding: TextEncoding;
  score: number;
  preview: string;
}

export interface EncodingGuess {
  encoding: TextEncoding;
  confidence: number;
  bom: boolean;
  candidates: EncodingCandidate[];
}

export interface Para {
  /** P<节序>.<段序>；超长段按句切分后加 a/b 后缀。 */
  id: string;
  start: number;
  end: number;
  /** sha256 前 12 位，用于缓存键与变更检测。 */
  hash: string;
  oversized?: boolean;
}

export interface Segment {
  /** S<n>；第一个标题之前的前言为 S0。 */
  id: string;
  level: 1 | 2 | 3 | 4 | 5 | 6;
  title: string;
  semantic?: "volume" | "act" | "chapter";
  /** 节类型初值，由标题与首段关键词粗判。 */
  hint?: string;
  start: number;
  end: number;
  paras: Para[];
  titlePath: string[];
}

export interface SegmentRules {
  volume?: string[];
  act?: string[];
  chapter?: string[];
  ignore?: string[];
}

export interface SegmentPattern {
  sample: string;
  level: number;
  semantic?: string;
}

export interface SegmentResult {
  /** 分块与重建偏移所需的源文本；落盘时可与 source.txt 分离保存。 */
  text: string;
  format: "md" | "txt";
  segments: Segment[];
  unassigned: Para[];
  patterns: SegmentPattern[];
}

export interface Chunk {
  /** 超长段的纯函数切片表；不修改原 SegmentResult。 */
  fragments?: Para[];
  index: number;
  total: number;
  segmentIds: string[];
  /** 本块正文段落 id；同一段只出现在一个块的 paras 中。 */
  paras: string[];
  /** 仅为衔接带入的上一块末段，不重复计入正文。 */
  contextOnly: string[];
  tokens: number;
  breadcrumb: string;
}

export interface QuoteHit {
  located: "exact" | "fuzzy" | false;
  para?: string;
  start?: number;
  end?: number;
  score: number;
  text?: string;
}

export interface NormalizeResult {
  text: string;
  /** 仅在调试模式生成：规范化后偏移 → 原文偏移。 */
  map?: Int32Array;
}

export interface MatchKeyResult {
  key: string;
  /** key 中每个字符对应的原文偏移。 */
  toOrig: Int32Array;
}

export interface SegmentOptions {
  format: "md" | "txt";
  rules?: SegmentRules;
}

export interface ChunkOptions {
  maxTokens: number;
  overlapParas?: number;
  estimate: (text: string) => number;
}
