import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, sha256 } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import type {
  AuditFinding,
  Bible,
  BibleOp,
  BibleView,
  EntityHit,
  Evidence,
  KnowledgeRow,
  PendingItem,
  Provenance,
  StateEntry,
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

async function readBibleFile<T>(file: string, fallback: T): Promise<T> {
  try {
    const raw = await fs.readFile(file, "utf8");
    return JSON.parse(raw) as T;
  } catch (err) {
    if ((err as { code?: string }).code === "ENOENT") return fallback;
    throw new AppError("storage.format_unsupported", `Invalid bible file: ${file}`, { file });
  }
}

function statesOverlap(a: StateEntry, b: StateEntry): boolean {
  const aUntil = a.until ?? Number.POSITIVE_INFINITY;
  const bUntil = b.until ?? Number.POSITIVE_INFINITY;
  return a.since < bUntil && b.since < aUntil;
}

function extractOpEvidence(op: BibleOp): Evidence | undefined {
  if (op.type === "state.add") return op.entry.evidence;
  if (op.type === "knowledge.set") return op.row.evidence;
  if (op.type === "thread.upsert") return op.thread.beats[0]?.evidence;
  return undefined;
}

function detectOpConflict(bible: Bible, op: BibleOp): string | undefined {
  if (op.type === "state.add") {
    const conflict = bible.states.find(
      (s) =>
        s.entity === op.entry.entity &&
        s.field === op.entry.field &&
        s.value !== op.entry.value &&
        (s.mode === "replace" || op.entry.mode === "replace") &&
        statesOverlap(s, op.entry)
    );
    return conflict?.id;
  }

  if (op.type === "knowledge.set") {
    const conflict = bible.knowledge.find((k) => {
      if (k.holder !== op.row.holder || k.fact !== op.row.fact) return false;
      if (k.since === op.row.since && k.level !== op.row.level) return true;
      if (k.since < op.row.since && (k.level === "知情" || k.level === "公开") && op.row.level === "不知") {
        return true;
      }
      if (op.row.since < k.since && (op.row.level === "知情" || op.row.level === "公开") && k.level === "不知") {
        return true;
      }
      return false;
    });
    return conflict?.id;
  }

  if (op.type === "entity.upsert") {
    const existing = bible.entities.find((e) => e.id === op.entity.id);
    if (existing && existing.locked.length > 0) {
      const nextText = `${op.entity.name}\n${op.entity.summary}`;
      const prevText = `${existing.name}\n${existing.summary}`;
      const broken = existing.locked.some(
        (lockedTerm) =>
          lockedTerm.trim().length > 0 &&
          prevText.includes(lockedTerm) &&
          !nextText.includes(lockedTerm)
      );
      if (broken) return existing.id;
    }
    return undefined;
  }

  if (op.type === "thread.upsert") {
    const existing = bible.threads.find(
      (t) => t.id === op.thread.id && t.status === "paid" && op.thread.status === "open"
    );
    return existing?.id;
  }

  return undefined;
}

export function createBibleStore(lock: LockService) {
  const dirOf = (workPath: string) => path.join(workPath, "bible");

  async function read(workPath: string): Promise<Bible> {
    const dir = dirOf(workPath);
    const [entities, states, threads, knowledge, chapters, style, pending] = await Promise.all([
      readBibleFile(path.join(dir, "entities.json"), EMPTY_BIBLE.entities),
      readBibleFile(path.join(dir, "states.json"), EMPTY_BIBLE.states),
      readBibleFile(path.join(dir, "threads.json"), EMPTY_BIBLE.threads),
      readBibleFile(path.join(dir, "knowledge.json"), EMPTY_BIBLE.knowledge),
      readBibleFile(path.join(dir, "chapters.json"), EMPTY_BIBLE.chapters),
      readBibleFile(path.join(dir, "style.json"), EMPTY_BIBLE.style),
      readBibleFile(path.join(dir, "pending.json"), EMPTY_BIBLE.pending),
    ]);
    return { entities, states, threads, knowledge, chapters, style, pending };
  }

  function asOf(bible: Bible, position: number): BibleView {
    return {
      position,
      entities: bible.entities,
      states: bible.states.filter((s) => s.since <= position && (s.until === undefined || position < s.until)),
      threads: bible.threads.filter((t) => t.opened <= position && t.status === "open"),
      knowledge: bible.knowledge.filter((k) => k.since <= position),
    };
  }

  function match(view: BibleView, texts: string[]): EntityHit[] {
    const corpus = texts.join("\n");
    const hits: EntityHit[] = [];
    for (const entity of view.entities) {
      const terms = [entity.name, ...entity.aliases]
        .filter((t) => t.trim().length > 0)
        .sort((a, b) => b.length - a.length);
      let count = 0;
      let firstIndex = Number.MAX_SAFE_INTEGER;
      let matchedTerm = "";
      const hay = entity.matchCase ? corpus : corpus.toLowerCase();

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

  async function writeIndex(dir: string, bible: Bible): Promise<void> {
    const hashes = {
      entities: sha256(JSON.stringify(bible.entities)),
      states: sha256(JSON.stringify(bible.states)),
      threads: sha256(JSON.stringify(bible.threads)),
      knowledge: sha256(JSON.stringify(bible.knowledge)),
      chapters: sha256(JSON.stringify(bible.chapters)),
      style: sha256(JSON.stringify(bible.style)),
      pending: sha256(JSON.stringify(bible.pending)),
    };
    await atomicWrite(path.join(dir, "index.json"), JSON.stringify({ format: "zhizhang/1.3", hashes }, null, 2));
  }

  async function propose(
    workPath: string,
    ops: BibleOp[],
    from: Provenance,
    metaList?: ProposeOpMeta[]
  ): Promise<PendingItem[]> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const bible = await read(workPath);
      const baseTs = Date.now();
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
      await atomicWrite(path.join(dir, "pending.json"), JSON.stringify(bible.pending, null, 2));
      await writeIndex(dir, bible);
      return added;
    });
  }

  async function decide(
    workPath: string,
    id: string,
    decision: "accept" | "reject" | { edit: BibleOp }
  ): Promise<void> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const bible = await read(workPath);
      const item = bible.pending.find((p) => p.id === id);
      if (!item) throw new AppError("input.not_found", `Pending item not found: ${id}`, { id });

      const dir = dirOf(workPath);
      if (decision !== "reject") {
        const op = typeof decision === "object" ? decision.edit : item.op;
        if (op.type === "entity.upsert") {
          const idx = bible.entities.findIndex((e) => e.id === op.entity.id);
          if (idx === -1) bible.entities.push(op.entity);
          else bible.entities[idx] = op.entity;
          await atomicWrite(path.join(dir, "entities.json"), JSON.stringify(bible.entities, null, 2));
        } else if (op.type === "state.add") {
          bible.states.push(op.entry);
          await atomicWrite(path.join(dir, "states.json"), JSON.stringify(bible.states, null, 2));
        } else if (op.type === "thread.upsert") {
          const idx = bible.threads.findIndex((t) => t.id === op.thread.id);
          if (idx === -1) bible.threads.push(op.thread);
          else bible.threads[idx] = op.thread;
          await atomicWrite(path.join(dir, "threads.json"), JSON.stringify(bible.threads, null, 2));
        } else if (op.type === "knowledge.set") {
          const idx = bible.knowledge.findIndex((k) => k.id === op.row.id);
          if (idx === -1) bible.knowledge.push(op.row);
          else bible.knowledge[idx] = op.row;
          await atomicWrite(path.join(dir, "knowledge.json"), JSON.stringify(bible.knowledge, null, 2));
        } else if (op.type === "chapter.record") {
          const idx = bible.chapters.findIndex((c) => c.chapter === op.record.chapter);
          if (idx === -1) bible.chapters.push(op.record);
          else bible.chapters[idx] = op.record;
          await atomicWrite(path.join(dir, "chapters.json"), JSON.stringify(bible.chapters, null, 2));
        }
      }
      bible.pending = bible.pending.filter((p) => p.id !== id);
      await atomicWrite(path.join(dir, "pending.json"), JSON.stringify(bible.pending, null, 2));
      await writeIndex(dir, bible);
    });
  }

  function audit(bible: Bible, upTo: number): AuditFinding[] {
    const findings: AuditFinding[] = [];
    const entityNames = new Map(bible.entities.map((e) => [e.id, e.name]));

    for (const thread of bible.threads) {
      if (thread.status !== "open") continue;
      if (thread.plannedPayoff !== undefined && upTo >= thread.plannedPayoff) {
        findings.push({
          kind: "due_unpaid",
          severity: "warn",
          title: `线索到期未兑现：${thread.title}`,
          detail: `计划于第 ${thread.plannedPayoff} 章兑现，当前已到第 ${upTo} 章`,
          refId: thread.id,
        });
      } else if (upTo - thread.opened >= 10 && thread.beats.length <= 1) {
        findings.push({
          kind: "forgotten_thread",
          severity: "warn",
          title: `遗忘线索：${thread.title}`,
          detail: `第 ${thread.opened} 章埋设后超过 10 章未推进`,
          refId: thread.id,
        });
      }
    }

    // State conflict detection
    const stateGroups = new Map<string, StateEntry[]>();
    for (const s of bible.states) {
      if (s.since > upTo) continue;
      const key = `${s.entity}\0${s.field}`;
      const list = stateGroups.get(key);
      if (list) list.push(s);
      else stateGroups.set(key, [s]);
    }
    for (const group of stateGroups.values()) {
      const sorted = [...group].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          if (a.value === b.value) continue;
          if (a.mode !== "replace" && b.mode !== "replace") continue;
          if (!statesOverlap(a, b)) continue;
          const entityName = entityNames.get(a.entity) ?? a.entity;
          findings.push({
            kind: "state_conflict",
            severity: "bad",
            title: `状态冲突：${entityName} 的「${a.field}」`,
            detail: `第 ${a.since} 章起「${a.value}」与第 ${b.since} 章起「${b.value}」时间窗重叠`,
            refId: b.id,
          });
        }
      }
    }

    // Knowledge leak detection: (1) contradictory/regressing knowledge rows
    const knowledgeGroups = new Map<string, KnowledgeRow[]>();
    for (const k of bible.knowledge) {
      if (k.since > upTo) continue;
      const key = `${k.holder}\0${k.fact}`;
      const list = knowledgeGroups.get(key);
      if (list) list.push(k);
      else knowledgeGroups.set(key, [k]);
    }
    const reportedLeaks = new Set<string>();
    for (const group of knowledgeGroups.values()) {
      const sorted = [...group].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
      for (let i = 0; i < sorted.length; i++) {
        for (let j = i + 1; j < sorted.length; j++) {
          const a = sorted[i];
          const b = sorted[j];
          const sameChapterConflict = a.since === b.since && a.level !== b.level;
          const regressed =
            (a.level === "知情" || a.level === "公开") && b.level === "不知";
          if (!sameChapterConflict && !regressed) continue;
          reportedLeaks.add(b.id);
          findings.push({
            kind: "knowledge_leak",
            severity: "bad",
            title: `知情冲突：${b.holder} 对「${b.fact}」`,
            detail: sameChapterConflict
              ? `第 ${b.since} 章同时记录为「${a.level}」与「${b.level}」`
              : `第 ${a.since} 章已「${a.level}」，第 ${b.since} 章却回退为「${b.level}」`,
            refId: b.id,
          });
        }
      }
    }

    // Knowledge leak detection: (2) chapter records mentioning secret fact while holder is 不知/误认
    for (const ch of bible.chapters) {
      if (ch.position > upTo) continue;
      const chapterText = `${ch.summary}\n${ch.handoff.ending}`;
      for (const group of knowledgeGroups.values()) {
        const eligible = group
          .filter((k) => k.since <= ch.position)
          .sort((a, b) => b.since - a.since);
        const latest = eligible[0];
        if (!latest) continue;
        if (latest.level !== "不知" && latest.level !== "误认") continue;
        if (latest.fact.trim().length < 2) continue;

        const entity = bible.entities.find(
          (e) => e.id === latest.holder || e.name === latest.holder || e.aliases.includes(latest.holder)
        );
        const holderNames = entity ? [latest.holder, entity.name, ...entity.aliases] : [latest.holder];
        const mentionsHolder = holderNames.some((n) => n.trim().length > 0 && chapterText.includes(n));
        if (mentionsHolder && chapterText.includes(latest.fact)) {
          const dedupKey = `${latest.id}:${ch.position}`;
          if (reportedLeaks.has(dedupKey)) continue;
          reportedLeaks.add(dedupKey);
          findings.push({
            kind: "knowledge_leak",
            severity: "bad",
            title: `知情越界：${latest.holder} 在第 ${ch.position} 章涉及「${latest.fact}」`,
            detail: `第 ${ch.position} 章摘要或交接提及「${latest.fact}」，但 ${latest.holder} 当前知情级别为「${latest.level}」`,
            refId: latest.id,
          });
        }
      }
    }

    return findings;
  }

  return { read, asOf, match, propose, decide, audit };
}
