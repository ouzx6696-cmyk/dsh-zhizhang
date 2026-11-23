import fs from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import type { LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import type { Parser } from "@zhizhang/core/schema";
import { auditBibleData, detectOpConflict, extractOpEvidence } from "./audit.js";
import {
  ChaptersFileSchema,
  EntitiesFileSchema,
  KnowledgeFileSchema,
  PendingFileSchema,
  StatesFileSchema,
  StyleContractSchema,
  ThreadsFileSchema,
} from "./schemas.js";
import type {
  Bible,
  BibleOp,
  BibleView,
  EntityHit,
  Evidence,
  PendingItem,
  Provenance,
} from "./types.js";

const EMPTY_BIBLE: Bible = {
  entities: [],
  states: [],
  threads: [],
  knowledge: [],
  chapters: [],
  style: { contract: "", rules: [], voiceSamples: [] },
  pending: [],
};

export interface ProposeOpMeta {
  evidence?: Evidence;
  located?: boolean;
}

interface CachedBible {
  signature: string;
  bible: Bible;
}

const BIBLE_FILES = [
  "entities.json",
  "states.json",
  "threads.json",
  "knowledge.json",
  "chapters.json",
  "style.json",
  "pending.json",
] as const;

async function readBibleFile<T>(file: string, parser: Parser<T>, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    const parsed: unknown = JSON.parse(raw);
    return parser(parsed, file);
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return fallback;
    throw new AppError("storage.format_unsupported", `Invalid bible file: ${file}`, { file });
  }
}

async function bibleDirSignature(dir: string): Promise<string> {
  const stats = await Promise.all(
    BIBLE_FILES.map(async (name) => {
      const st = await fs.stat(path.join(dir, name)).catch(() => undefined);
      return st ? `${st.mtimeMs}:${st.size}` : "0:0";
    }),
  );
  return stats.join("|");
}

function cloneBible(bible: Bible): Bible {
  return structuredClone(bible);
}

function buildIndexJson(bible: Bible): string {
  const hashes = {
    entities: sha256(JSON.stringify(bible.entities)),
    states: sha256(JSON.stringify(bible.states)),
    threads: sha256(JSON.stringify(bible.threads)),
    knowledge: sha256(JSON.stringify(bible.knowledge)),
    chapters: sha256(JSON.stringify(bible.chapters)),
    style: sha256(JSON.stringify(bible.style)),
    pending: sha256(JSON.stringify(bible.pending)),
  };
  return JSON.stringify({ format: FORMAT_VERSION, hashes }, null, 2);
}

async function makeIntentWrite(file: string, after: string): Promise<IntentWrite> {
  const prev = await readTextIfExists(file);
  return {
    path: file,
    beforeHash: prev === undefined ? null : sha256(prev),
    after,
  };
}

export function createBibleStore(lock: LockService, clock: Clock = systemClock) {
  const dirOf = (workPath: string) => path.join(workPath, "bible");
  const cache = new Map<string, CachedBible>();

  async function read(workPath: string): Promise<Bible> {
    const dir = dirOf(workPath);
    const sig = await bibleDirSignature(dir);
    const cached = cache.get(dir);
    if (cached && cached.signature === sig) {
      return cloneBible(cached.bible);
    }
    const [entities, states, threads, knowledge, chapters, style, pending] = await Promise.all([
      readBibleFile(path.join(dir, "entities.json"), EntitiesFileSchema, EMPTY_BIBLE.entities),
      readBibleFile(path.join(dir, "states.json"), StatesFileSchema, EMPTY_BIBLE.states),
      readBibleFile(path.join(dir, "threads.json"), ThreadsFileSchema, EMPTY_BIBLE.threads),
      readBibleFile(path.join(dir, "knowledge.json"), KnowledgeFileSchema, EMPTY_BIBLE.knowledge),
      readBibleFile(path.join(dir, "chapters.json"), ChaptersFileSchema, EMPTY_BIBLE.chapters),
      readBibleFile(path.join(dir, "style.json"), StyleContractSchema, EMPTY_BIBLE.style),
      readBibleFile(path.join(dir, "pending.json"), PendingFileSchema, EMPTY_BIBLE.pending),
    ]);
    const loaded: Bible = { entities, states, threads, knowledge, chapters, style, pending };
    cache.set(dir, { signature: sig, bible: cloneBible(loaded) });
    return loaded;
  }

  function asOf(bible: Bible, position: number): BibleView {
    return {
      position,
      entities: bible.entities,
      states: bible.states.filter(
        (s) => s.since <= position && (s.until === undefined || position < s.until),
      ),
      threads: bible.threads.filter((t) => t.opened <= position && t.status === "open"),
      knowledge: bible.knowledge.filter((k) => k.since <= position),
    };
  }

  function match(view: BibleView, texts: string[]): EntityHit[] {
    const corpus = texts.join("\n");
    const corpusLower = corpus.toLowerCase();
    const hits: EntityHit[] = [];
    for (const entity of view.entities) {
      const terms = [entity.name, ...entity.aliases]
        .filter((t) => t.trim().length > 0)
        .sort((a, b) => b.length - a.length);
      let count = 0;
      let firstIndex = Number.MAX_SAFE_INTEGER;
      let matchedTerm = "";
      const hay = entity.matchCase ? corpus : corpusLower;

      for (const term of terms) {
        const needle = entity.matchCase ? term : term.toLowerCase();
        let pos = hay.indexOf(needle);
        while (pos !== -1) {
          count += 1;
          if (pos < firstIndex) {
            firstIndex = pos;
            matchedTerm = term;
          }
          pos = hay.indexOf(needle, pos + needle.length);
        }
      }
      if (count > 0 || entity.global) {
        hits.push({
          entity,
          count,
          firstIndex: count > 0 ? firstIndex : Number.MAX_SAFE_INTEGER,
          matchedTerm: matchedTerm || entity.name,
        });
      }
    }
    return hits.sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex);
  }

  async function propose(
    workPath: string,
    ops: BibleOp[],
    from: Provenance,
    metaList?: ProposeOpMeta[],
  ): Promise<PendingItem[]> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const bible = await read(workPath);
      const baseTs = clock.now();
      const added: PendingItem[] = ops.map((op, i) => {
        const meta = metaList?.[i];
        const evidence = meta?.evidence ?? extractOpEvidence(op);
        const located = meta?.located ?? evidence?.located ?? true;
        const conflictsWith = detectOpConflict(bible, op);
        const item: PendingItem = {
          id: `pend-${baseTs}-${i}`,
          op,
          run: from.run,
          located,
        };
        if (evidence) item.evidence = evidence;
        if (conflictsWith) item.conflictsWith = conflictsWith;
        return item;
      });
      bible.pending = [...bible.pending, ...added];
      const dir = dirOf(workPath);
      const writes = await Promise.all([
        makeIntentWrite(path.join(dir, "pending.json"), JSON.stringify(bible.pending, null, 2)),
        makeIntentWrite(path.join(dir, "index.json"), buildIndexJson(bible)),
      ]);
      await commitIntent(
        path.join(workPath, ".journal"),
        {
          format: FORMAT_VERSION,
          id: `bible-propose-${baseTs}`,
          writes,
          meta: { operation: "bible.propose", count: String(added.length) },
        },
        lock,
        { kind: "work", path: workPath },
      );
      cache.delete(dir);
      return added;
    });
  }

  async function decide(
    workPath: string,
    id: string,
    decision: "accept" | "reject" | { edit: BibleOp },
  ): Promise<void> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const bible = await read(workPath);
      const item = bible.pending.find((p) => p.id === id);
      if (!item) throw new AppError("input.not_found", `Pending item not found: ${id}`, { id });

      const dir = dirOf(workPath);
      const writes: IntentWrite[] = [];

      if (decision !== "reject") {
        const op = typeof decision === "object" ? decision.edit : item.op;
        if (op.type === "entity.upsert") {
          const idx = bible.entities.findIndex((e) => e.id === op.entity.id);
          if (idx === -1) bible.entities.push(op.entity);
          else bible.entities[idx] = op.entity;
          writes.push(
            await makeIntentWrite(
              path.join(dir, "entities.json"),
              JSON.stringify(bible.entities, null, 2),
            ),
          );
        } else if (op.type === "state.add") {
          bible.states.push(op.entry);
          writes.push(
            await makeIntentWrite(
              path.join(dir, "states.json"),
              JSON.stringify(bible.states, null, 2),
            ),
          );
        } else if (op.type === "thread.upsert") {
          const idx = bible.threads.findIndex((t) => t.id === op.thread.id);
          if (idx === -1) bible.threads.push(op.thread);
          else bible.threads[idx] = op.thread;
          writes.push(
            await makeIntentWrite(
              path.join(dir, "threads.json"),
              JSON.stringify(bible.threads, null, 2),
            ),
          );
        } else if (op.type === "knowledge.set") {
          const idx = bible.knowledge.findIndex((k) => k.id === op.row.id);
          if (idx === -1) bible.knowledge.push(op.row);
          else bible.knowledge[idx] = op.row;
          writes.push(
            await makeIntentWrite(
              path.join(dir, "knowledge.json"),
              JSON.stringify(bible.knowledge, null, 2),
            ),
          );
        } else if (op.type === "chapter.record") {
          const idx = bible.chapters.findIndex((c) => c.chapter === op.record.chapter);
          if (idx === -1) bible.chapters.push(op.record);
          else bible.chapters[idx] = op.record;
          writes.push(
            await makeIntentWrite(
              path.join(dir, "chapters.json"),
              JSON.stringify(bible.chapters, null, 2),
            ),
          );
        }
      }

      bible.pending = bible.pending.filter((p) => p.id !== id);
      writes.push(
        await makeIntentWrite(
          path.join(dir, "pending.json"),
          JSON.stringify(bible.pending, null, 2),
        ),
        await makeIntentWrite(path.join(dir, "index.json"), buildIndexJson(bible)),
      );

      await commitIntent(
        path.join(workPath, ".journal"),
        {
          format: FORMAT_VERSION,
          id: `bible-decide-${id}-${clock.now()}`,
          writes,
          meta: {
            operation: "bible.decide",
            pendingId: id,
            decision: typeof decision === "string" ? decision : "edit",
          },
        },
        lock,
        { kind: "work", path: workPath },
      );
      cache.delete(dir);
    });
  }

  return { read, asOf, match, propose, decide, audit: auditBibleData };
}
