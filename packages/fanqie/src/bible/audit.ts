/** 设定集巡检：只报告，不阻止写入。 */
import { stateKey, statesOverlap } from "./interval.js";
import type {
  AuditFinding,
  BibleSnapshot,
  KnowledgeRow,
  LedgerEntry,
  StateEntry,
} from "./types.js";

export function auditBible(
  bible: BibleSnapshot,
  upTo: number,
  ledgerList: LedgerEntry[] = [],
): AuditFinding[] {
  const findings: AuditFinding[] = [];
  const entityNames = new Map(bible.entities.map((entity) => [entity.id, entity.name]));

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
  for (const entry of bible.states) {
    if (entry.since > upTo) continue;
    const key = stateKey(entry);
    const list = stateGroups.get(key);
    if (list) list.push(entry);
    else stateGroups.set(key, [entry]);
  }
  for (const group of stateGroups.values()) {
    const sorted = [...group].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
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
  for (const row of bible.knowledge) {
    if (row.since > upTo) continue;
    const key = `${row.holder}\u0000${row.fact}`;
    const list = knowledgeGroups.get(key);
    if (list) list.push(row);
    else knowledgeGroups.set(key, [row]);
  }
  const reportedLeaks = new Set<string>();
  for (const group of knowledgeGroups.values()) {
    const sorted = [...group].sort((a, b) => a.since - b.since || a.id.localeCompare(b.id));
    for (let i = 0; i < sorted.length; i += 1) {
      for (let j = i + 1; j < sorted.length; j += 1) {
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

  for (const chapter of ledgerList) {
    if (chapter.position > upTo) continue;
    const chapterText = `${chapter.summary}\n${chapter.handoff.ending}`;
    for (const group of knowledgeGroups.values()) {
      const latest = group
        .filter((row) => row.since <= chapter.position)
        .sort((a, b) => b.since - a.since)[0];
      if (!latest) continue;
      if (latest.level !== "不知" && latest.level !== "误认") continue;
      if (latest.fact.trim().length < 2) continue;

      const entity = bible.entities.find(
        (candidate) =>
          candidate.id === latest.holder ||
          candidate.name === latest.holder ||
          candidate.aliases.includes(latest.holder),
      );
      const holderNames = entity
        ? [latest.holder, entity.name, ...entity.aliases]
        : [latest.holder];
      const mentionsHolder = holderNames.some(
        (name) => name.trim().length > 0 && chapterText.includes(name),
      );
      if (mentionsHolder && chapterText.includes(latest.fact)) {
        const dedupKey = `${latest.id}:${chapter.position}`;
        if (reportedLeaks.has(dedupKey)) continue;
        reportedLeaks.add(dedupKey);
        findings.push({
          kind: "knowledge_leak",
          severity: "bad",
          title: `知情越界：${latest.holder} 在第 ${chapter.position} 章涉及「${latest.fact}」`,
          detail: `第 ${chapter.position} 章摘要或交接提及「${latest.fact}」，但 ${latest.holder} 当前知情级别为「${latest.level}」`,
          refId: latest.id,
          position: chapter.position,
          jump: { view: "chapter", id: chapter.chapter },
        });
      }
    }
  }

  return findings;
}
