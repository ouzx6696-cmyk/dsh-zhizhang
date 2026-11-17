import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import type { LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { dropUndefined } from "@zhizhang/core/schema";
import type {
  AnyOp,
  AuditFinding,
  BibleIndex,
  BibleOp,
  BibleSnapshot,
  BibleView,
  EntityHit,
  Evidence,
  KnowledgeRow,
  LedgerEntry,
  PendingBatch,
  PendingItem,
  PendingSource,
  StateEntry,
} from "./types.js";

const EMPTY_BIBLE: BibleSnapshot = {
  entities: [],
  timeline: [],
  states: [],
  threads: [],
  knowledge: [],
  style: { contract: "", rules: [], voiceSamples: [] },
};

export interface ProposeOpMeta {
  evidence?: Evidence;
  located?: boolean;
}

const SOURCE_PREFIX: Record<PendingSource, string> = {
  import: "imp",
  ledger: "led",
  plan: "pln",
  assistant: "asst",
};

function pendingSource(source: string): PendingSource {
  return source === "import" || source === "ledger" || source === "plan" ? source : "assistant";
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

async function readJsonDir<T>(dir: string): Promise<T[]> {
  const names = (await fs.readdir(dir).catch(() => [] as string[]))
    .filter((name) => name.endsWith(".json"))
    .sort();
  const out: T[] = [];
  for (const name of names) {
    const value = await readBibleFile<T | undefined>(path.join(dir, name), undefined);
    if (value !== undefined) out.push(value);
  }
  return out;
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

function detectOpConflict(bible: BibleSnapshot, op: BibleOp): string | undefined {
  if (op.type === "state.add") {
    const conflict = bible.states.find(
      (s) =>
        s.entity === op.entry.entity &&
        s.field === op.entry.field &&
        s.value !== op.entry.value &&
        (s.mode === "replace" || op.entry.mode === "replace") &&
        statesOverlap(s, op.entry),
    );
    return conflict?.id;
  }

  if (op.type === "knowledge.set") {
    const conflict = bible.knowledge.find((k) => {
      if (k.holder !== op.row.holder || k.fact !== op.row.fact) return false;
      if (k.since === op.row.since && k.level !== op.row.level) return true;
      if (
        k.since < op.row.since &&
        (k.level === "知情" || k.level === "公开") &&
        op.row.level === "不知"
      ) {
        return true;
      }
      if (
        op.row.since < k.since &&
        (op.row.level === "知情" || op.row.level === "公开") &&
        k.level === "不知"
      ) {
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
          !nextText.includes(lockedTerm),
      );
      if (broken) return existing.id;
    }
    return undefined;
  }

  if (op.type === "thread.upsert") {
    const existing = bible.threads.find(
      (t) => t.id === op.thread.id && t.status === "paid" && op.thread.status === "open",
    );
    return existing?.id;
  }

  return undefined;
}

const BIBLE_OP_TAGS = new Set([
  "entity.upsert",
  "entity.merge",
  "entity.delete",
  "timeline.upsert",
  "state.add",
  "state.update",
  "state.delete",
  "thread.upsert",
  "thread.beat",
  "knowledge.set",
  "ledger.write",
  "style.update",
]);

function isBibleOp(op: AnyOp): op is BibleOp {
  return BIBLE_OP_TAGS.has(op.type);
}

const SNAPSHOT_FILES = {
  entities: "entities.json",
  timeline: "timeline.json",
  states: "states.json",
  threads: "threads.json",
  knowledge: "knowledge.json",
  style: "style.json",
} as const;

type SnapshotKey = keyof typeof SNAPSHOT_FILES;

function applyOpToSnapshot(
  bible: BibleSnapshot,
  op: BibleOp,
): { touched: SnapshotKey[]; ledger?: LedgerEntry } {
  if (op.type === "entity.upsert") {
    const idx = bible.entities.findIndex((e) => e.id === op.entity.id);
    if (idx === -1) bible.entities.push(op.entity);
    else bible.entities[idx] = op.entity;
    return { touched: ["entities"] };
  }
  if (op.type === "entity.delete") {
    bible.entities = bible.entities.filter((e) => e.id !== op.id);
    return { touched: ["entities"] };
  }
  if (op.type === "timeline.upsert") {
    const idx = bible.timeline.findIndex((e) => e.id === op.event.id);
    if (idx === -1) bible.timeline.push(op.event);
    else bible.timeline[idx] = op.event;
    return { touched: ["timeline"] };
  }
  if (op.type === "state.add") {
    bible.states.push(op.entry);
    return { touched: ["states"] };
  }
  if (op.type === "state.update") {
    const entry = bible.states.find((s) => s.id === op.id);
    if (!entry) throw new AppError("input.not_found", `State not found: ${op.id}`, { id: op.id });
    Object.assign(entry, op.patch);
    return { touched: ["states"] };
  }
  if (op.type === "state.delete") {
    bible.states = bible.states.filter((s) => s.id !== op.id);
    return { touched: ["states"] };
  }
  if (op.type === "thread.upsert") {
    const idx = bible.threads.findIndex((t) => t.id === op.thread.id);
    if (idx === -1) bible.threads.push(op.thread);
    else bible.threads[idx] = op.thread;
    return { touched: ["threads"] };
  }
  if (op.type === "thread.beat") {
    const thread = bible.threads.find((t) => t.id === op.thread);
    if (!thread)
      throw new AppError("input.not_found", `Thread not found: ${op.thread}`, {
        id: op.thread,
      });
    thread.beats.push(op.beat);
    if (op.close) thread.status = op.close;
    return { touched: ["threads"] };
  }
  if (op.type === "knowledge.set") {
    const idx = bible.knowledge.findIndex((k) => k.id === op.row.id);
    if (idx === -1) bible.knowledge.push(op.row);
    else bible.knowledge[idx] = op.row;
    return { touched: ["knowledge"] };
  }
  if (op.type === "style.update") {
    bible.style = { ...bible.style, ...op.patch };
    return { touched: ["style"] };
  }
  if (op.type === "ledger.write") {
    return { touched: [], ledger: op.entry };
  }
  throw new AppError("internal", `未实现：D-02（${op.type}）`);
}

export function createBibleStore(lock: LockService) {
  const dirOf = (workPath: string) => path.join(workPath, "bible");

  async function read(workPath: string): Promise<BibleSnapshot> {
    const dir = dirOf(workPath);
    const [entities, timeline, states, threads, knowledge, style] = await Promise.all([
      readBibleFile(path.join(dir, "entities.json"), EMPTY_BIBLE.entities),
      readBibleFile(path.join(dir, "timeline.json"), EMPTY_BIBLE.timeline),
      readBibleFile(path.join(dir, "states.json"), EMPTY_BIBLE.states),
      readBibleFile(path.join(dir, "threads.json"), EMPTY_BIBLE.threads),
      readBibleFile(path.join(dir, "knowledge.json"), EMPTY_BIBLE.knowledge),
      readBibleFile(path.join(dir, "style.json"), EMPTY_BIBLE.style),
    ]);
    return { entities, timeline, states, threads, knowledge, style };
  }

  async function ledgers(workPath: string): Promise<LedgerEntry[]> {
    const list = await readJsonDir<LedgerEntry>(path.join(dirOf(workPath), "ledger"));
    return list.sort((a, b) => a.position - b.position);
  }

  async function lastLedger(workPath: string): Promise<LedgerEntry | undefined> {
    return (await ledgers(workPath)).at(-1);
  }

  async function readPendingBatches(workPath: string): Promise<PendingBatch[]> {
    return readJsonDir<PendingBatch>(path.join(dirOf(workPath), "pending"));
  }

  async function pendingCount(workPath: string): Promise<number> {
    const batches = await readPendingBatches(workPath);
    return batches.reduce(
      (sum, batch) => sum + batch.items.filter((item) => item.decision === "undecided").length,
      0,
    );
  }

  function asOf(bible: BibleSnapshot, position: number, ledgerList: LedgerEntry[] = []): BibleView {
    const recentFacts = ledgerList
      .filter((entry) => entry.position <= position)
      .flatMap((entry) => entry.facts.map((fact) => ({ ...fact, position: entry.position })))
      .slice(-5);
    return {
      position,
      entities: bible.entities,
      states: bible.states.filter(
        (s) => s.since <= position && (s.until === undefined || position < s.until),
      ),
      threads: bible.threads.filter((t) => t.opened <= position && t.status === "open"),
      knowledge: bible.knowledge.filter((k) => k.since <= position),
      recentFacts,
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

  async function writeIndex(
    workPath: string,
    bible: BibleSnapshot,
    ledgerList: LedgerEntry[],
  ): Promise<void> {
    const outline = (await readTextIfExists(path.join(workPath, "outline", "book.json"))) ?? "";
    const files: BibleIndex["files"] = {
      entities: { rev: 0, hash: sha256(JSON.stringify(bible.entities)) },
      timeline: { rev: 0, hash: sha256(JSON.stringify(bible.timeline)) },
      states: { rev: 0, hash: sha256(JSON.stringify(bible.states)) },
      threads: { rev: 0, hash: sha256(JSON.stringify(bible.threads)) },
      knowledge: { rev: 0, hash: sha256(JSON.stringify(bible.knowledge)) },
      style: { rev: 0, hash: sha256(JSON.stringify(bible.style)) },
      outline: { rev: 0, hash: sha256(outline) },
    };
    const latest = ledgerList.at(-1);
    const index: BibleIndex = {
      format: FORMAT_VERSION,
      files,
      ...(latest ? { lastLedgerChapter: latest.chapter } : {}),
    };
    await atomicWrite(path.join(dirOf(workPath), "index.json"), JSON.stringify(index, null, 2));
  }

  async function propose(
    workPath: string,
    ops: BibleOp[],
    from: { source: string; run?: string; chapter?: number; at: string },
    metaList?: ProposeOpMeta[],
  ): Promise<PendingItem[]> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const bible = await read(workPath);
      const baseTs = Date.now();
      const source = pendingSource(from.source);
      const batchId = `${SOURCE_PREFIX[source]}-${baseTs.toString(36)}`;
      const items: PendingItem[] = ops.map((op, i) => {
        const meta = metaList?.[i];
        const evidence = meta?.evidence ?? extractOpEvidence(op);
        const conflictsWith = detectOpConflict(bible, op);
        const item: PendingItem = {
          id: `p-${baseTs}-${i}`,
          op,
          change: conflictsWith ? "conflict" : "new",
          group: "default",
          dependsOn: [],
          notes: conflictsWith ? ["bible.conflict_with", conflictsWith] : [],
          decision: "undecided",
        };
        if (evidence) item.evidence = evidence;
        return item;
      });
      const batch: PendingBatch = {
        format: FORMAT_VERSION,
        id: batchId,
        source,
        ...(from.run ? { run: from.run } : {}),
        ...(from.chapter ? { chapter: from.chapter } : {}),
        created: from.at,
        status: "open",
        items,
        commits: [],
      };
      const pendingDir = path.join(dirOf(workPath), "pending");
      await fs.mkdir(pendingDir, { recursive: true });
      await atomicWrite(
        path.join(pendingDir, `${batchId}.json`),
        JSON.stringify(dropUndefined(batch), null, 2),
      );
      await writeIndex(workPath, bible, await ledgers(workPath));
      return items;
    });
  }

  async function decide(
    workPath: string,
    id: string,
    decision: "accept" | "reject" | { edit: BibleOp },
  ): Promise<void> {
    return lock.write({ kind: "work", path: workPath }, async () => {
      const batches = await readPendingBatches(workPath);
      const batch = batches.find((b) => b.items.some((p) => p.id === id));
      const item = batch?.items.find((p) => p.id === id);
      if (!batch || !item) {
        throw new AppError("input.not_found", `Pending item not found: ${id}`, { id });
      }

      const bible = await read(workPath);
      const touched = new Set<SnapshotKey>();
      let ledger: LedgerEntry | undefined;
      if (decision !== "reject") {
        const op = typeof decision === "object" ? decision.edit : item.op;
        if (!isBibleOp(op)) {
          throw new AppError("internal", `未实现：D-02（${op.type}）`);
        }
        const applied = applyOpToSnapshot(bible, op);
        for (const key of applied.touched) touched.add(key);
        ledger = applied.ledger;
        item.decision = typeof decision === "object" ? "edit" : "accept";
        if (typeof decision === "object") item.edited = decision.edit;
      } else {
        item.decision = "reject";
      }

      const dir = dirOf(workPath);
      for (const key of touched) {
        await atomicWrite(path.join(dir, SNAPSHOT_FILES[key]), JSON.stringify(bible[key], null, 2));
      }
      if (ledger) {
        const ledgerDir = path.join(dir, "ledger");
        await fs.mkdir(ledgerDir, { recursive: true });
        await atomicWrite(
          path.join(ledgerDir, `${ledger.chapter}.json`),
          JSON.stringify(dropUndefined(ledger), null, 2),
        );
      }
      batch.status = batch.items.every((p) => p.decision !== "undecided") ? "closed" : "partial";
      await atomicWrite(
        path.join(dir, "pending", `${batch.id}.json`),
        JSON.stringify(dropUndefined(batch), null, 2),
      );
      await writeIndex(workPath, bible, await ledgers(workPath));
    });
  }

  function audit(
    bible: BibleSnapshot,
    upTo: number,
    ledgerList: LedgerEntry[] = [],
  ): AuditFinding[] {
    const findings: AuditFinding[] = [];
    const entityNames = new Map(bible.entities.map((e) => [e.id, e.name]));

    for (const thread of bible.threads) {
      if (thread.status !== "open") continue;
      if (thread.plannedPayoff !== undefined && upTo >= thread.plannedPayoff) {
        findings.push({
          kind: "thread_overdue",
          severity: "warn",
          title: `线索到期未兑现：${thread.title}`,
          detail: `计划于第 ${thread.plannedPayoff} 章兑现，当前已到第 ${upTo} 章`,
          refId: thread.id,
          jump: { view: "thread", id: thread.id },
        });
      } else if (upTo - thread.opened >= 10 && thread.beats.length <= 1) {
        findings.push({
          kind: "thread_forgotten",
          severity: "warn",
          title: `遗忘线索：${thread.title}`,
          detail: `第 ${thread.opened} 章埋设后超过 10 章未推进`,
          refId: thread.id,
          jump: { view: "thread", id: thread.id },
        });
      }
    }

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
            jump: { view: "entity", id: a.entity },
          });
        }
      }
    }

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
          const regressed = (a.level === "知情" || a.level === "公开") && b.level === "不知";
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
            jump: { view: "entity", id: b.holder },
          });
        }
      }
    }

    for (const ch of ledgerList) {
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
          (e) =>
            e.id === latest.holder || e.name === latest.holder || e.aliases.includes(latest.holder),
        );
        const holderNames = entity
          ? [latest.holder, entity.name, ...entity.aliases]
          : [latest.holder];
        const mentionsHolder = holderNames.some(
          (n) => n.trim().length > 0 && chapterText.includes(n),
        );
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
            position: ch.position,
            jump: { view: "chapter", id: ch.chapter },
          });
        }
      }
    }

    return findings;
  }

  return {
    read,
    ledgers,
    lastLedger,
    readPendingBatches,
    pendingCount,
    asOf,
    match,
    propose,
    decide,
    audit,
  };
}

export type BibleStore = ReturnType<typeof createBibleStore>;
