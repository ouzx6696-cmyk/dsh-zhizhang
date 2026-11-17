import { readBible, readLedgers } from "./read.js";
import { auditBible } from "./audit.js";
import { stateKey } from "./interval.js";
import type { AuditFinding } from "./types.js";
import { readOutline, nodesOf, derivePositions } from "../outline/store.js";
import { listChapters } from "../commands/chapter.js";
import { readWorkMeta } from "../storage/work.js";

export async function auditWork(work: string, upTo: number): Promise<AuditFinding[]> {
  const [bible, ledgers, outline, rows, meta] = await Promise.all([
    readBible(work),
    readLedgers(work),
    readOutline(work),
    listChapters(work),
    readWorkMeta(work),
  ]);
  const findings = auditBible(bible, upTo, ledgers, meta.settings.threadForgetAfter ?? 10);
  const positions = derivePositions(outline, rows),
    entities = new Map(bible.entities.map((entity) => [entity.id, entity])),
    chapters = new Map(rows.map((row) => [row.id, row]));
  const terminal = new Set(meta.settings.terminalStates ?? ["死亡", "陨落", "封印", "失踪"]);
  const add = (
    kind: AuditFinding["kind"],
    id: string,
    title: string,
    detail: string,
    severity: AuditFinding["severity"] = "warn",
    position?: number,
    view: AuditFinding["jump"]["view"] = "outline",
  ) => findings.push({ kind, refId: id, title, detail, severity, position, jump: { view, id } });
  const nodes = nodesOf(outline);
  for (const { node, level } of nodes) {
    if (level !== "chapter" || "acts" in node || "chapters" in node) continue;
    const position = positions.plans.get(node.id) ?? 0;
    if (position > upTo) continue;
    const row = node.chapterId ? chapters.get(node.chapterId) : undefined;
    if (node.chapterId && !row)
      add("dangling_ref", node.id, "正文文件缺失", node.chapterId, "bad", position);
    for (const id of [
      ...(node.cast ?? []),
      ...(node.pov ? [node.pov] : []),
      ...(node.location ? [node.location] : []),
    ]) {
      const entity = entities.get(id);
      if (!entity) {
        add("dangling_ref", node.id, "实体引用缺失", id, "bad", position);
        continue;
      }
      if (
        (entity.retiredAt !== undefined && entity.retiredAt <= position) ||
        bible.states.some(
          (state) =>
            state.entity === id &&
            state.facet === "condition" &&
            state.since <= position &&
            (state.until === undefined || position < state.until) &&
            terminal.has(state.value),
        )
      )
        add("cast_retired", node.id, "终止状态实体仍在出场", entity.name, "bad", position);
    }
    if (node.location && entities.get(node.location)?.kind !== "place")
      add("dangling_ref", node.id, "地点引用类型错误", node.location, "bad", position);
    if (node.location && node.pov) {
      const previous = bible.states
        .filter(
          (state) =>
            state.entity === node.pov &&
            state.facet === "location" &&
            state.since <= position - 1 &&
            (state.until === undefined || state.until > position - 1),
        )
        .sort((a, b) => b.since - a.since)[0];
      if (
        previous &&
        previous.value !== node.location &&
        previous.target !== node.location &&
        !bible.states.some(
          (state) =>
            state.entity === node.pov && state.facet === "location" && state.since === position,
        )
      )
        add(
          "location_jump",
          node.id,
          "地点可能跳变",
          `${previous.value} → ${entities.get(node.location)?.name ?? node.location}`,
          "warn",
          position,
        );
    }
    for (const ref of node.pay ?? []) {
      const thread = bible.threads.find((thread) => thread.id === ref.thread);
      if (ref.thread && !thread)
        add("dangling_ref", node.id, "线索引用缺失", ref.thread, "bad", position);
      if (!thread) continue;
      if (position < (thread.plannedPlant ?? thread.opened))
        add("pay_before_plant", node.id, "计划回收早于埋设", thread.title, "bad", position);
      if (
        row &&
        ledgers.some((entry) => entry.chapter === row.id) &&
        thread.status === "open" &&
        !thread.beats.some((beat) => beat.kind === "pay" && beat.chapter === position)
      )
        add("pay_unseen", node.id, "计划回收尚未在记账中出现", thread.title, "warn", position);
    }
    if (
      row &&
      node.wordTarget &&
      row.wordCount > 0 &&
      Math.abs(row.wordCount - node.wordTarget) / node.wordTarget > 0.5
    )
      add(
        "word_target",
        node.id,
        "章节字数偏离目标",
        `${row.wordCount} / ${node.wordTarget}`,
        "warn",
        position,
      );
  }
  for (const { node, level } of nodes)
    if (level !== "chapter" && node.wordTarget) {
      const descendants =
        level === "volume" && "acts" in node
          ? node.acts.flatMap((act) => act.chapters)
          : "chapters" in node
            ? node.chapters
            : [];
      const sum = descendants.reduce((total, chapter) => total + (chapter.wordTarget ?? 0), 0);
      if (sum > 0 && Math.abs(sum - node.wordTarget) / node.wordTarget > 0.2)
        add("word_target", node.id, "下级累计目标与当前目标不一致", `${sum} / ${node.wordTarget}`);
    }
  for (const state of bible.states) {
    if (!entities.has(state.entity) || (state.target && !entities.has(state.target)))
      add("dangling_ref", state.entity, "状态引用缺失", state.id, "bad", state.since, "entity");
    if (
      state.status === "planned" &&
      bible.states.some(
        (other) =>
          other.status === "confirmed" &&
          stateKey(other) === stateKey(state) &&
          other.since === state.since &&
          other.value !== state.value,
      )
    )
      add(
        "plan_fact_divergence",
        state.entity,
        "计划与事实不一致",
        state.field,
        "warn",
        state.since,
        "entity",
      );
  }
  for (const row of bible.knowledge)
    if (!entities.has(row.holder))
      add("dangling_ref", row.holder, "知情持有人不存在", row.id, "bad", row.since, "entity");
  for (const entry of [...bible.states, ...bible.knowledge])
    if (entry.evidence) {
      const ledger = ledgers.find((ledger) => ledger.position === entry.evidence?.chapter),
        row = ledger ? chapters.get(ledger.chapter) : undefined;
      if (row && row.revision !== entry.evidence.revision)
        add(
          "evidence_stale",
          row.id,
          "证据正文版本已变化",
          entry.id,
          "warn",
          entry.evidence.chapter,
          "chapter",
        );
    }
  return findings;
}
