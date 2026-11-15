import { sha256 } from "../fs/hash.js";

export interface StageTakeRule {
  file: string;
  sections?: string[];
  maxChars?: number;
}

export type StageMap = Record<string, { take: StageTakeRule[] }>;

export interface Profile {
  id: string;
  name: string;
  mode: string;
  files: Record<string, string>;
  stageMap: StageMap;
  hash: string;
}

function extractSections(markdown: string, wanted?: string[]): { text: string; missing: string[] } {
  if (!wanted || wanted.length === 0) {
    return { text: markdown.trim(), missing: [] };
  }
  const lines = markdown.split(/\r?\n/);
  const blocks = new Map<string, string[]>();
  let current: string | undefined;

  for (const line of lines) {
    const match = /^##\s+(.+?)\s*$/.exec(line);
    if (match) {
      current = match[1].trim();
      if (!blocks.has(current)) blocks.set(current, [line]);
    } else if (current) {
      blocks.get(current)?.push(line);
    }
  }

  const out: string[] = [];
  const missing: string[] = [];
  for (const name of wanted) {
    const sec = blocks.get(name);
    if (sec) out.push(sec.join("\n").trim());
    else missing.push(name);
  }
  return { text: out.join("\n\n"), missing };
}

export function methodFor(
  profile: Profile,
  stage: string,
): { text: string; hash: string; omitted: string[] } {
  const rule = profile.stageMap[stage];
  if (!rule) {
    return { text: "", hash: sha256(""), omitted: [] };
  }
  const parts: string[] = [];
  const omitted: string[] = [];

  for (const take of rule.take) {
    const raw = profile.files[take.file];
    if (raw === undefined) {
      omitted.push(take.file);
      continue;
    }
    const extracted = extractSections(raw, take.sections);
    for (const m of extracted.missing) omitted.push(`${take.file}#${m}`);
    let content = extracted.text;
    if (take.maxChars !== undefined && content.length > take.maxChars) {
      content = content.slice(0, take.maxChars);
      omitted.push(`${take.file}(truncated)`);
    }
    if (content) parts.push(content);
  }

  const text = parts.join("\n\n");
  return { text, hash: sha256(text), omitted };
}
