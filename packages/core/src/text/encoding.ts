import { AppError } from "../errors/app-error.js";
import { SIMPLIFIED_FREQUENT, TRADITIONAL_FREQUENT } from "./hanzi-freq.js";
import type { EncodingCandidate, EncodingGuess, TextEncoding } from "./types.js";

const HANZI = /\p{Script=Han}/u;
const PUNCTUATION = new Set("，。！？；：“”‘’《》、");
const clamp = (value: number) => Math.max(0, Math.min(1, value));

function preview(text: string): string {
  const end = Math.min(400, text.length);
  // 预览长度满足运行时 schema，且不在代理对中间截断。
  return text.slice(0, end > 0 && /[\uD800-\uDBFF]/u.test(text[end - 1]) ? end - 1 : end);
}

function certain(bytes: Uint8Array, encoding: TextEncoding, confidence: number, bom: boolean) {
  return {
    encoding,
    confidence,
    bom,
    candidates: [
      { encoding, score: confidence, preview: preview(new TextDecoder(encoding).decode(bytes)) },
    ],
  };
}

function score(text: string, frequent: ReadonlySet<string>): number {
  let count = 0,
    hanzi = 0,
    hits = 0,
    punctuation = 0,
    replacements = 0;
  for (const char of text) {
    count++;
    if (HANZI.test(char)) {
      hanzi++;
      if (frequent.has(char)) hits++;
    }
    if (PUNCTUATION.has(char)) punctuation++;
    if (char === "\uFFFD") replacements++;
  }
  return (
    0.6 * (hanzi ? hits / hanzi : 0) +
    0.2 * Math.min(count ? (punctuation / count) * 10 : 0, 1) -
    5 * (count ? replacements / count : 0)
  );
}

export function detectEncoding(bytes: Uint8Array): EncodingGuess {
  if (bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf)
    return certain(bytes, "utf-8", 1, true);
  if (bytes[0] === 0xff && bytes[1] === 0xfe) return certain(bytes, "utf-16le", 1, true);
  if (bytes[0] === 0xfe && bytes[1] === 0xff) return certain(bytes, "utf-16be", 1, true);
  const sample = bytes.subarray(0, 4096);
  let even = 0,
    odd = 0;
  for (let i = 0; i < sample.length; i++) {
    if (sample[i] === 0) {
      if (i % 2 === 0) even++;
      else odd++;
    }
  }
  if (sample.length >= 2 && even / Math.ceil(sample.length / 2) > 0.3)
    return certain(bytes, "utf-16be", 0.95, false);
  if (sample.length >= 2 && odd / Math.floor(sample.length / 2) > 0.3)
    return certain(bytes, "utf-16le", 0.95, false);
  try {
    new TextDecoder("utf-8", { fatal: true }).decode(bytes);
    return certain(bytes, "utf-8", 0.99, false);
  } catch {
    // 非 UTF-8 才进入统计检测；不把乱码替换字符当成解码成功。
  }
  const prefix = bytes.subarray(0, 65536);
  const alternatives: Array<{ candidate: EncodingCandidate; raw: number }> = [];
  for (const encoding of ["gb18030", "big5"] as const) {
    try {
      // 流模式避免 64 KB 取样恰好截断多字节字符而人为扣分。
      const decoded = new TextDecoder(encoding).decode(prefix, {
        stream: prefix.length < bytes.length,
      });
      const raw = score(
        decoded,
        encoding === "gb18030" ? SIMPLIFIED_FREQUENT : TRADITIONAL_FREQUENT,
      );
      alternatives.push({
        candidate: { encoding, score: clamp(raw), preview: preview(decoded) },
        raw,
      });
    } catch {
      // 精简 ICU 的宿主可能不支持某候选；保留可用编码，不添加运行时依赖。
    }
  }
  alternatives.sort((a, b) => b.raw - a.raw);
  const utf8: EncodingCandidate = {
    encoding: "utf-8",
    score: 0,
    preview: preview(new TextDecoder().decode(prefix)),
  };
  const best = alternatives[0];
  const candidates = [...alternatives.map((item) => item.candidate), utf8];
  if (!best || best.raw < 0.2)
    throw new AppError("input.invalid", "无法可靠识别文本编码，请另存为 UTF-8", {
      reason: "encoding_unsupported",
      candidates,
    });
  const difference = best.raw - (alternatives[1]?.raw ?? best.raw);
  const confidence = Math.min(difference < 0.1 ? 0.7 : 0.98, clamp(0.5 + difference));
  return { encoding: best.candidate.encoding, confidence, bom: false, candidates };
}
