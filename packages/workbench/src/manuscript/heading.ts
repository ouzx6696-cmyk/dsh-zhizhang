/**
 * 稿纸正文首行 `# 标题` 的拆分与还原（M0-2 编辑态标题）：
 * 与阅读态稿纸一致，只把“首个非空行且为 `# ` 一级标题”的行识别为标题；
 * `##` 二级标题、`#` 后无空格的行都不算。拆分只移除标题行本身，
 * 其余内容（含行尾与空行）逐字保留，保证“拆开再拼回”与原文一致。
 */

export interface LeadHeadingSplit {
  /** 首行标题文字（已去除首尾空白）；没有可拆分的标题时为 undefined。 */
  title?: string;
  /** 去掉标题行后的正文，其余内容逐字保留。 */
  rest: string;
  /** 正文是否存在已拆出的首行标题。 */
  hadHeading: boolean;
}

const LEAD_HEADING = /^#[ \t]+(.*\S)[ \t]*$/;
const EOL = /\r\n|\n|\r/;

function splitLines(body: string): string[] {
  // 每个条目自带行尾；末尾再补一个空条目，保证没有行尾的最后一行也在列。
  return body.match(/[^\r\n]*(?:\r\n|\n|\r|$)/g) ?? [];
}

/** 把标题行拼回正文首行；标题为空时原样返回 rest。行尾风格跟随 rest 的实际内容。 */
export function joinLeadHeading(title: string, rest: string): string {
  const heading = title.trim();
  if (!heading) return rest;
  if (!rest) return `# ${heading}`;
  return `# ${heading}${EOL.exec(rest)?.[0] ?? "\n"}${rest}`;
}

export function splitLeadHeading(body: string): LeadHeadingSplit {
  const lines = splitLines(body);
  let index = 0;
  while (index < lines.length - 1 && lines[index].trim().length === 0) index += 1;
  const candidate = (lines[index] ?? "").replace(EOL, "");
  const match = LEAD_HEADING.exec(candidate);
  if (!match) return { rest: body, hadHeading: false };
  const rest = lines.slice(0, index).join("") + lines.slice(index + 1).join("");
  return { title: match[1], rest, hadHeading: true };
}
