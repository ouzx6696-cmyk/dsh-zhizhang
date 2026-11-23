import type {
  AuditFinding,
  Bible,
  BibleOp,
  Entity,
  Evidence,
  KnowledgeRow,
  StateEntry,
} from "./types.js";

function statesOverlap(a: StateEntry, b: StateEntry): boolean {
  const aUntil = a.until ?? Number.POSITIVE_INFINITY;
  const bUntil = b.until ?? Number.POSITIVE_INFINITY;
  return a.since < bUntil && b.since < aUntil;
}

export function extractOpEvidence(op: BibleOp): Evidence | undefined {
  if (op.type === "state.add") return op.entry.evidence;
  if (op.type === "knowledge.set") return op.row.evidence;
  if (op.type === "thread.upsert") return op.thread.beats[0]?.evidence;
  return undefined;
}

export function detectOpConflict(bible: Bible, op: BibleOp): string | undefined {
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

/** 在已按 since 升序排列的知情记录中二分定位 <= position 的最后一条。 */
function latestKnowledgeAt(
  sorted: readonly KnowledgeRow[],
  position: number,
): KnowledgeRow | undefined {
  let lo = 0;
  let hi = sorted.length - 1;
  let hit = -1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (sorted[mid].since <= position) {
      hit = mid;
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  return hit === -1 ? undefined : sorted[hit];
}

function buildEntityLookup(entities: readonly Entity[]): Map<string, Entity> {
  const map = new Map<string, Entity>();
  for (const entity of entities) {
    map.set(entity.id, entity);
    if (entity.name) map.set(entity.name, entity);
    for (const alias of entity.aliases) {
      if (alias && !map.has(alias)) map.set(alias, entity);
    }
  }
  return map;
}

export function auditBibleData(bible: Bible, upTo: number): AuditFinding[] {
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

  const knowledgeGroups = new Map<string, KnowledgeRow[]>();
  for (const k of bible.knowledge) {
    if (k.since > upTo) continue;
    const key = `${k.holder}\0${k.fact}`;
    const list = knowledgeGroups.get(key);
    if (list) list.push(k);
    else knowledgeGroups.set(key, [k]);
  }

  const reportedLeaks = new Set<string>();
  const sortedGroups: Array<{ sorted: KnowledgeRow[]; holderNames: string[]; fact: string }> = [];
  const entityLookup = buildEntityLookup(bible.entities);

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
        });
      }
    }

    const sample = sorted[0];
    if (sample && sample.fact.trim().length >= 2) {
      const entity = entityLookup.get(sample.holder);
      const holderNames = (
        entity ? [sample.holder, entity.name, ...entity.aliases] : [sample.holder]
      ).filter((n) => n.trim().length > 0);
      sortedGroups.push({ sorted, holderNames, fact: sample.fact });
    }
  }

  for (const ch of bible.chapters) {
    if (ch.position > upTo) continue;
    const chapterText = `${ch.summary}\n${ch.handoff.ending}`;
    for (const { sorted, holderNames, fact } of sortedGroups) {
      if (!chapterText.includes(fact)) continue;
      const latest = latestKnowledgeAt(sorted, ch.position);
      if (!latest || (latest.level !== "不知" && latest.level !== "误认")) continue;
      const mentionsHolder = holderNames.some((n) => chapterText.includes(n));
      if (mentionsHolder) {
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
