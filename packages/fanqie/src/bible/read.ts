/** 设定集真源读取：V1 schema 校验、索引与批次读取。 */
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { arr, type Parser } from "@zhizhang/core/schema";
import {
  BibleIndexSchema,
  EntitySchema,
  KnowledgeRowSchema,
  LedgerEntrySchema,
  StateEntrySchema,
  StyleContractSchema,
  ThreadSchema,
  TimelineEventSchema,
} from "./schema.js";
import { PendingBatchSchema } from "./ops-schema.js";
import type { BibleIndex, BibleSnapshot, LedgerEntry, PendingBatch } from "./types.js";

export function emptyBible(): BibleSnapshot {
  return {
    entities: [],
    timeline: [],
    states: [],
    threads: [],
    knowledge: [],
    style: { contract: "", rules: [], voiceSamples: [] },
  };
}

export const SNAPSHOT_FILES = {
  entities: "entities.json",
  timeline: "timeline.json",
  states: "states.json",
  threads: "threads.json",
  knowledge: "knowledge.json",
  style: "style.json",
} as const;

export type SnapshotKey = keyof typeof SNAPSHOT_FILES;

export type BibleLib = {
  bible: BibleSnapshot;
  ledgers: Map<string, LedgerEntry>;
};

export const BIBLE_DIR = (workPath: string): string => path.join(workPath, "bible");

function safeFileId(value: string, field: string): string {
  if (value.length === 0 || value === "." || value === ".." || /[\\/:*?"<>|\0]/.test(value)) {
    throw new AppError("input.invalid", `非法${field}：${value}`, {
      path: `$.${field}`,
      rule: "invalid_id",
      id: value,
    });
  }
  return value;
}

export function pendingFilePath(workPath: string, batch: string): string {
  return path.join(BIBLE_DIR(workPath), "pending", `${safeFileId(batch, "batch")}.json`);
}

export function ledgerFilePath(workPath: string, chapter: string): string {
  return path.join(BIBLE_DIR(workPath), "ledger", `${safeFileId(chapter, "chapter")}.json`);
}

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

async function readFile<T>(file: string, parser: Parser<T>, fallback: T): Promise<T>;
async function readFile<T>(file: string, parser: Parser<T>): Promise<T | undefined>;
async function readFile<T>(file: string, parser: Parser<T>, fallback?: T): Promise<T | undefined> {
  let raw: string;
  try {
    raw = await fs.readFile(file, "utf8");
  } catch (err) {
    if (isEnoent(err)) return fallback;
    throw new AppError("storage.format_unsupported", `Cannot read bible file: ${file}`, { file });
  }
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new AppError("storage.format_unsupported", `Invalid JSON in bible file: ${file}`, {
      file,
    });
  }
  try {
    return parser(value, "$");
  } catch (err) {
    if (err instanceof AppError) {
      throw new AppError("storage.format_unsupported", `Invalid bible file: ${file}`, {
        file,
        reason: err.code,
        path: err.data?.path,
      });
    }
    throw err;
  }
}

async function readOptional<T>(file: string, parser: Parser<T>): Promise<T | undefined> {
  try {
    await fs.access(file);
  } catch {
    return undefined;
  }
  return readFile(file, parser);
}

async function readJsonDir<T>(dir: string, parser: Parser<T>): Promise<T[]> {
  const names = (await fs.readdir(dir).catch((): string[] => []))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const out: T[] = [];
  for (const name of names) {
    const value = await readOptional(path.join(dir, name), parser);
    if (value !== undefined) out.push(value);
  }
  return out;
}

export const EntitiesSchema = arr(EntitySchema);
export const TimelineSchema = arr(TimelineEventSchema);
export const StatesSchema = arr(StateEntrySchema);
export const ThreadsSchema = arr(ThreadSchema);
export const KnowledgeSchema = arr(KnowledgeRowSchema);
export { StyleContractSchema };

export async function readBible(workPath: string): Promise<BibleSnapshot> {
  const dir = BIBLE_DIR(workPath);
  const empty = emptyBible();
  const [entities, timeline, states, threads, knowledge, style] = await Promise.all([
    readFile(path.join(dir, "entities.json"), EntitiesSchema, empty.entities),
    readFile(path.join(dir, "timeline.json"), TimelineSchema, empty.timeline),
    readFile(path.join(dir, "states.json"), StatesSchema, empty.states),
    readFile(path.join(dir, "threads.json"), ThreadsSchema, empty.threads),
    readFile(path.join(dir, "knowledge.json"), KnowledgeSchema, empty.knowledge),
    readFile(path.join(dir, "style.json"), StyleContractSchema, empty.style),
  ]);
  return { entities, timeline, states, threads, knowledge, style };
}

export async function readLedgers(workPath: string): Promise<LedgerEntry[]> {
  const list = await readJsonDir(path.join(BIBLE_DIR(workPath), "ledger"), LedgerEntrySchema);
  return list.sort((a, b) => a.position - b.position);
}

export async function lastLedger(workPath: string): Promise<LedgerEntry | undefined> {
  return (await readLedgers(workPath)).at(-1);
}

export async function readPendingBatches(workPath: string): Promise<PendingBatch[]> {
  return readJsonDir(path.join(BIBLE_DIR(workPath), "pending"), PendingBatchSchema);
}

export async function readPendingBatch(
  workPath: string,
  batch: string,
): Promise<PendingBatch | undefined> {
  return readOptional(pendingFilePath(workPath, batch), PendingBatchSchema);
}

export async function pendingCount(workPath: string): Promise<number> {
  const batches = await readPendingBatches(workPath);
  return batches.reduce(
    (sum, batch) => sum + batch.items.filter((item) => item.decision === "undecided").length,
    0,
  );
}

export async function readIndex(workPath: string): Promise<BibleIndex | undefined> {
  const file = path.join(BIBLE_DIR(workPath), "index.json");
  return readOptional(file, BibleIndexSchema);
}

export function indexRev(index: BibleIndex | undefined): number {
  if (!index) return 0;
  return Math.max(0, ...Object.values(index.files).map((file) => file.rev));
}

export async function readLib(workPath: string): Promise<BibleLib> {
  const [bible, ledgerList] = await Promise.all([readBible(workPath), readLedgers(workPath)]);
  return {
    bible,
    ledgers: new Map(ledgerList.map((entry) => [entry.chapter, entry])),
  };
}

export async function readIndexOrEmpty(workPath: string): Promise<BibleIndex> {
  return (
    (await readIndex(workPath)) ?? {
      format: "zhizhang/1.3",
      files: {
        entities: { rev: 0, hash: "" },
        timeline: { rev: 0, hash: "" },
        states: { rev: 0, hash: "" },
        threads: { rev: 0, hash: "" },
        knowledge: { rev: 0, hash: "" },
        style: { rev: 0, hash: "" },
        outline: { rev: 0, hash: "" },
      },
    }
  );
}
