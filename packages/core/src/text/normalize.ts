import type { NormalizeResult } from "./types.js";

/** 只删除约定字符与空白；偏移始终按 JS UTF-16 code unit 计，不做 Unicode 兼容归一。 */
export function normalize(text: string, opts?: { map?: boolean }): NormalizeResult {
  const chars: string[] = [];
  const offsets: number[] | undefined = opts?.map ? [] : undefined;
  let lineStart = 0;
  const trimEnd = () => {
    while (chars.length > lineStart && /\s/u.test(chars[chars.length - 1])) {
      chars.pop();
      offsets?.pop();
    }
  };
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "\u00a0" || /[\u200b-\u200d\ufeff]/u.test(char)) continue;
    if (char === "\r" || char === "\n") {
      trimEnd();
      if (!(chars.at(-1) === "\n" && chars.at(-2) === "\n")) {
        chars.push("\n");
        offsets?.push(i);
      }
      lineStart = chars.length;
      if (char === "\r" && text[i + 1] === "\n") i++;
    } else {
      chars.push(char);
      offsets?.push(i);
    }
  }
  trimEnd();
  return { text: chars.join(""), ...(offsets ? { map: Int32Array.from(offsets) } : {}) };
}
