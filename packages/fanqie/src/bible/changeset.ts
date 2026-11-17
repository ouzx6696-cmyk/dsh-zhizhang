/** 变更集 JSONL、索引与 Intent 写入计划。 */
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, sha256 } from "@zhizhang/core/fs";
import type { IntentWrite } from "@zhizhang/core/journal";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { ChangeSetSchema } from "./ops-schema.js";
import type { BibleLib, SnapshotKey } from "./read.js";
import {
  BIBLE_DIR,
  EntitiesSchema,
  KnowledgeSchema,
  SNAPSHOT_FILES,
  StatesSchema,
  StyleContractSchema,
  ThreadsSchema,
  TimelineSchema,
  indexRev,
  ledgerFilePath,
  readIndex,
} from "./read.js";
import { LedgerEntrySchema } from "./schema.js";
import type { BibleIndex, BibleSnapshot, ChangeSet } from "./types.js";

export async function readChangeSets(workPath: string): Promise<ChangeSet[]> {
  const dir = path.join(BIBLE_DIR(workPath), "changes");
  const names = (await fs.readdir(dir).catch((): string[] => []))
    .filter((name) => name.endsWith(".jsonl"))
    .sort();
  const out: ChangeSet[] = [];
  for (const name of names) {
    const file = path.join(dir, name);
    const raw = await fs.readFile(file, "utf8");
    for (const [index, line] of raw.split(/\r?\n/).entries()) {
      if (line.trim().length === 0) continue;
      let value: unknown;
      try {
        value = JSON.parse(line);
      } catch {
        throw new AppError(
          "storage.format_unsupported",
          `Invalid changes JSONL: ${file}:${index + 1}`,
          {
            file,
            line: index + 1,
          },
        );
      }
      try {
        out.push(ChangeSetSchema(value, "$"));
      } catch (err) {
        throw new AppError(
          "storage.format_unsupported",
          `Invalid change set: ${file}:${index + 1}`,
          {
            file,
            line: index + 1,
            reason: err instanceof AppError ? err.code : "invalid",
          },
        );
      }
    }
  }
  return out;
}

export async function findChangeSet(
  workPath: string,
  changeId: string,
): Promise<ChangeSet | undefined> {
  return (await readChangeSets(workPath)).find((change) => change.id === changeId);
}

export function changeSetPath(workPath: string, at: string): string {
  return path.join(BIBLE_DIR(workPath), "changes", `${at.slice(0, 7)}.jsonl`);
}

function rel(workPath: string, file: string): string {
  return path.relative(workPath, file).split(path.sep).join("/");
}

/** 经 schema 解析后序列化，保证键序不受内存构造路径影响。 */
function snapshotJson(bible: BibleSnapshot, key: SnapshotKey): string {
  switch (key) {
    case "entities":
      return JSON.stringify(EntitiesSchema(bible.entities), null, 2);
    case "timeline":
      return JSON.stringify(TimelineSchema(bible.timeline), null, 2);
    case "states":
      return JSON.stringify(StatesSchema(bible.states), null, 2);
    case "threads":
      return JSON.stringify(ThreadsSchema(bible.threads), null, 2);
    case "knowledge":
      return JSON.stringify(KnowledgeSchema(bible.knowledge), null, 2);
    case "style":
      return JSON.stringify(StyleContractSchema(bible.style), null, 2);
  }
}

async function writeOf(file: string, after: string): Promise<IntentWrite> {
  const before = await readTextIfExists(file);
  return { path: file, beforeHash: before === undefined ? null : sha256(before), after };
}

export interface CommitWritesInput {
  work: string;
  lib: BibleLib;
  touched: Set<SnapshotKey>;
  ledgerChapters: Set<string>;
  pendingFile?: string;
  pendingAfter?: string;
  change: ChangeSet;
}

export interface CommitWrites {
  writes: IntentWrite[];
  files: string[];
  index: BibleIndex;
  removedLedgers: string[];
}

export async function buildCommitWrites(input: CommitWritesInput): Promise<CommitWrites> {
  const { work, lib, touched, ledgerChapters, change } = input;
  const dir = BIBLE_DIR(work);
  const writes: IntentWrite[] = [];
  const files: string[] = [];
  const removedLedgers: string[] = [];
  const bodies = new Map<SnapshotKey, string>();

  for (const key of touched) {
    const file = path.join(dir, SNAPSHOT_FILES[key]);
    const after = snapshotJson(lib.bible, key);
    bodies.set(key, after);
    writes.push(await writeOf(file, after));
    files.push(rel(work, file));
  }
  for (const chapter of ledgerChapters) {
    const file = ledgerFilePath(work, chapter);
    const entry = lib.ledgers.get(chapter);
    if (entry) {
      writes.push(await writeOf(file, JSON.stringify(LedgerEntrySchema(entry), null, 2)));
      files.push(rel(work, file));
    } else {
      removedLedgers.push(file);
      files.push(rel(work, file));
    }
  }

  const previousIndex = await readIndex(work);
  const rev = indexRev(previousIndex) + 1;
  const outlineRaw = (await readTextIfExists(path.join(work, "outline", "book.json"))) ?? "";
  const latest = [...lib.ledgers.values()].sort((a, b) => b.position - a.position)[0];
  const hashOf = async (key: SnapshotKey): Promise<string> => {
    const body = bodies.get(key);
    if (body !== undefined) return sha256(body);
    const raw = await readTextIfExists(path.join(dir, SNAPSHOT_FILES[key]));
    return sha256(raw ?? snapshotJson(lib.bible, key));
  };
  const index: BibleIndex = {
    format: FORMAT_VERSION,
    files: {
      entities: { rev, hash: await hashOf("entities") },
      timeline: { rev, hash: await hashOf("timeline") },
      states: { rev, hash: await hashOf("states") },
      threads: { rev, hash: await hashOf("threads") },
      knowledge: { rev, hash: await hashOf("knowledge") },
      style: { rev, hash: await hashOf("style") },
      outline: { rev, hash: sha256(outlineRaw) },
    },
    ...(latest ? { lastLedgerChapter: latest.chapter } : {}),
  };
  const indexFile = path.join(dir, "index.json");
  writes.push(await writeOf(indexFile, JSON.stringify(index, null, 2)));
  files.push(rel(work, indexFile));

  if (input.pendingFile && input.pendingAfter !== undefined) {
    writes.push(await writeOf(input.pendingFile, input.pendingAfter));
    files.push(rel(work, input.pendingFile));
  }

  const changesFile = changeSetPath(work, change.at);
  files.push(rel(work, changesFile));
  change.files = [...files];
  const before = (await readTextIfExists(changesFile)) ?? "";
  const line = `${JSON.stringify(ChangeSetSchema(change))}\n`;
  const after = before.length === 0 || before.endsWith("\n") ? before + line : `${before}\n${line}`;
  writes.push(await writeOf(changesFile, after));

  return { writes, files, index, removedLedgers };
}

export async function applyRemovedLedgers(files: string[]): Promise<void> {
  for (const file of files) await fs.rm(file, { force: true });
}
