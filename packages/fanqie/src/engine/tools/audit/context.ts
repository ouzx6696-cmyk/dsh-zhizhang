import { config } from "../context.js";

import { forgeLint } from "../../../forge.js";
export async function extraLintText(
  text: string,
  title?: string,
  known: { match: string }[] = [],
): Promise<string | undefined> {
  if (!text.trim()) return undefined;
  try {
    const r = await forgeLint(typeof config.python === "string" ? config.python : undefined, {
      text,
      title,
      known: [...new Set(known.map((hit) => hit.match).filter(Boolean))],
    });
    return r ? `\n### ${r.source}（${r.hits} 处，仅提示回看位置）\n${r.text}` : undefined;
  } catch (err) {
    return `\n（追加体检暂不可用：${err instanceof Error ? err.message.slice(0, 120) : String(err).slice(0, 120)}）`;
  }
}
