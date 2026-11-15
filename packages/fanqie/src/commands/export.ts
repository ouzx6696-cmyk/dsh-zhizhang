import path from "node:path";
import { atomicWrite, readTextIfExists } from "@zhizhang/core/fs";
import type { ChapterStatus } from "../domain/status.js";
import { readWorkMeta } from "../storage/work.js";
import type { ChapterRowView } from "../view/snapshot.js";
import { listChapters, readChapter } from "./chapter.js";

export interface StructureVolume {
  volume: number;
  title: string;
  summary?: string;
  startChapter: number;
  endChapter: number;
}

export interface ExportOptions {
  finalOnly?: boolean;
  onlyFinal?: boolean;
  outPath?: string;
}

export type ExportTxtOptions = ExportOptions;

export interface ExportChapterSection {
  id: string;
  position: number;
  title: string;
  heading: string;
  volume?: number;
  volumeTitle?: string;
  status: ChapterStatus;
  wordCount: number;
  paragraphs: string[];
  text: string;
}

export interface ExportVolumeSection {
  volume?: number;
  title?: string;
  chapters: ExportChapterSection[];
}

export interface ExportBookPayload {
  title: string;
  chapterCount: number;
  totalWords: number;
  chapters: ExportChapterSection[];
  volumes: ExportVolumeSection[];
  text: string;
}

export interface ExportTxtResult {
  title: string;
  chapterCount: number;
  totalWords: number;
  content: string;
  outPath?: string;
  chapters: ExportChapterSection[];
}

export interface ExportDocxOptions extends ExportOptions {
  pack?: (payload: ExportBookPayload) => Promise<Uint8Array>;
}

export interface ExportDocxResult {
  title: string;
  chapterCount: number;
  totalWords: number;
  payload: ExportBookPayload;
  outPath?: string;
}

function countChineseWords(text: string): number {
  return text.replace(/\s+/g, "").length;
}

function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

function isStructureVolume(item: unknown): item is StructureVolume {
  return (
    isRecord(item) &&
    typeof item.volume === "number" &&
    typeof item.title === "string" &&
    typeof item.startChapter === "number" &&
    typeof item.endChapter === "number"
  );
}

export function stripExportMarkers(text: string): string {
  return text
    .replace(/\r\n?/g, "\n")
    .replace(/<!--[\s\S]*?-->/g, "")
    .replace(/^\s*\x60{3}[^\n]*\n|^\s*\x60{3}\s*$/gm, "")
    .replace(/^\s*#{1,6}\s+/gm, "")
    .replace(/^\s*>\s?/gm, "")
    .replace(/\x60([^\x60\n]+)\x60/g, "$1")
    .replace(/!\[[^\]]*\]\([^)]*\)/g, "")
    .replace(/\[([^\]]+)\]\([^)]*\)/g, "$1")
    .replace(/\*\*([^*]+)\*\*|__([^_]+)__/g, "$1$2")
    .replace(/(?<!\*)\*([^*\n]+)\*(?!\*)/g, "$1")
    .replace(/(?<!_)_([^_\n]+)_(?!_)/g, "$1")
    .replace(/【批注[：:][^】]*】|\[批注[：:][^\]]*\]|（批注[：:][^）]*）|\(批注[：:][^)]*\)/g, "")
    .replace(/^\s*[（(【\[]?(?:配图|配图提示|配图建议|插图建议|图片提示|批注)[：:][^\n]*$/gm, "")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}

async function readStructureVolumes(workPath: string): Promise<StructureVolume[]> {
  const raw = await readTextIfExists(path.join(workPath, "plan", "structure.json"));
  if (!raw) return [];
  try {
    const parsed: unknown = JSON.parse(raw);
    const list: unknown[] = Array.isArray(parsed)
      ? parsed
      : isRecord(parsed) && Array.isArray(parsed.volumes)
        ? parsed.volumes
        : [];
    return list.filter(isStructureVolume).sort((a, b) => a.volume - b.volume);
  } catch {
    return [];
  }
}

function orderChaptersByStructure(
  rows: ChapterRowView[],
  volumes: StructureVolume[]
): Array<{ row: ChapterRowView; volume?: StructureVolume }> {
  const sortedRows = [...rows].sort((a, b) => a.position - b.position || a.id.localeCompare(b.id));
  if (volumes.length === 0) {
    return sortedRows.map((row) => ({ row }));
  }

  const ordered: Array<{ row: ChapterRowView; volume?: StructureVolume }> = [];
  const used = new Set<string>();

  for (const vol of volumes) {
    const inVol = sortedRows.filter(
      (r) => !used.has(r.id) && r.position >= vol.startChapter && r.position <= vol.endChapter
    );
    for (const row of inVol) {
      used.add(row.id);
      ordered.push({ row, volume: vol });
    }
  }

  for (const row of sortedRows) {
    if (!used.has(row.id)) {
      ordered.push({ row });
    }
  }
  return ordered;
}

export async function assembleBookExport(
  workPath: string,
  opts: ExportOptions = {}
): Promise<ExportBookPayload> {
  const meta = await readWorkMeta(workPath);
  const rows = await listChapters(workPath);
  const finalOnly = opts.finalOnly ?? opts.onlyFinal ?? false;
  const filtered = finalOnly ? rows.filter((r) => r.status === "final") : rows;
  const volumesMeta = await readStructureVolumes(workPath);
  const ordered = orderChaptersByStructure(filtered, volumesMeta);

  const chapters: ExportChapterSection[] = [];
  const volumeGroups = new Map<string, ExportVolumeSection>();
  let totalWords = 0;

  for (let i = 0; i < ordered.length; i++) {
    const { row, volume } = ordered[i];
    const doc = await readChapter(workPath, row.id);
    const cleaned = stripExportMarkers(doc.body);
    const num = row.position > 0 ? row.position : i + 1;
    const chapterTitle = stripExportMarkers(doc.meta.title || row.title || row.id);
    const heading = `第${num}章 ${chapterTitle}`;
    const paragraphs = cleaned
      .split(/\n+/)
      .map((p) => p.trim())
      .filter(Boolean);
    const words = countChineseWords(cleaned);
    totalWords += words;

    const section: ExportChapterSection = {
      id: row.id,
      position: num,
      title: chapterTitle,
      heading,
      volume: volume?.volume,
      volumeTitle: volume?.title,
      status: doc.meta.status,
      wordCount: words,
      paragraphs,
      text: cleaned,
    };
    chapters.push(section);

    const groupKey = volume ? `vol-${volume.volume}` : "unassigned";
    const existingGroup = volumeGroups.get(groupKey);
    if (existingGroup) {
      existingGroup.chapters.push(section);
    } else {
      volumeGroups.set(groupKey, {
        volume: volume?.volume,
        title: volume?.title,
        chapters: [section],
      });
    }
  }

  const textParts: string[] = [`《${meta.title}》`];
  for (const ch of chapters) {
    textParts.push(`${ch.heading}\n\n${ch.text}`);
  }
  const text = textParts.join("\n\n") + "\n";

  return {
    title: meta.title,
    chapterCount: chapters.length,
    totalWords,
    chapters,
    volumes: [...volumeGroups.values()],
    text,
  };
}

export async function exportWorkTxt(
  workPath: string,
  opts: ExportTxtOptions = {}
): Promise<ExportTxtResult> {
  const payload = await assembleBookExport(workPath, opts);
  if (opts.outPath) {
    await atomicWrite(opts.outPath, payload.text);
  }

  return {
    title: payload.title,
    chapterCount: payload.chapterCount,
    totalWords: payload.totalWords,
    content: payload.text,
    outPath: opts.outPath,
    chapters: payload.chapters,
  };
}

export async function exportWorkDocx(
  workPath: string,
  opts: ExportDocxOptions = {}
): Promise<ExportDocxResult> {
  const payload = await assembleBookExport(workPath, opts);
  if (opts.outPath && opts.pack) {
    const bytes = await opts.pack(payload);
    await atomicWrite(opts.outPath, Buffer.from(bytes));
  }

  return {
    title: payload.title,
    chapterCount: payload.chapterCount,
    totalWords: payload.totalWords,
    payload,
    outPath: opts.outPath,
  };
}
