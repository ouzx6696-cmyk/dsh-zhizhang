import type { ChapterStatus } from "./status.js";

export interface ChapterFrontMatter {
  id: string;
  title: string;
  status: ChapterStatus;
  revision: string;
  outline?: Record<string, string>;
  scenes?: string[];
  review?: {
    round: number;
    verdict: "pass" | "revise" | "reject";
    quotes: string[];
    at: string;
  };
  editorPass?: boolean;
  editorRejections?: number;
  finalizedAt?: string;
}

export interface ChapterDocument {
  meta: ChapterFrontMatter;
  body: string;
}

export function parseChapterMarkdown(raw: string): ChapterDocument {
  const match = /^<!--\s*zhizhang:meta\s*\n([\s\S]*?)\n-->\s*\n?([\s\S]*)$/.exec(raw);
  if (!match) {
    return {
      meta: { id: "", title: "", status: "drafting", revision: "rev-0" },
      body: raw,
    };
  }
  const meta = JSON.parse(match[1]) as ChapterFrontMatter;
  return { meta, body: match[2] };
}

export function serializeChapterMarkdown(doc: ChapterDocument): string {
  return `<!-- zhizhang:meta\n${JSON.stringify(doc.meta, null, 2)}\n-->\n${doc.body}`;
}
