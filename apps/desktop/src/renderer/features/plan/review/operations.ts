import type { AnyOp } from "@zhizhang/fanqie/bible";
import { P } from "../shared";
export function titleOf(op: AnyOp): string {
  if (op.type === "entity.upsert") return op.entity.name;
  if (op.type === "state.add") return `${op.entry.field}: ${op.entry.value}`;
  if (op.type === "node.create") return op.node.title;
  if (op.type === "thread.upsert") return op.thread.title;
  if (op.type === "timeline.upsert") return op.event.title;
  if (op.type === "knowledge.set") return op.row.fact;
  if (op.type === "ledger.write") return op.entry.summary;
  if (op.type === "node.update") return op.patch.title ?? op.id;
  if (op.type === "book.update") return op.patch.title ?? op.patch.logline ?? P["plan.book"];
  return "id" in op ? op.id : "plan";
}
export function fieldTitle(field: string): string {
  const labels: Record<string, string> = {
    title: P["plan.title"],
    logline: P["plan.logline"],
    coreConflict: P["plan.coreConflict"],
    sellingPoints: P["plan.sellingPoints"],
  };
  return labels[field] ?? field;
}
export function editedOp(op: AnyOp, text: string): AnyOp {
  if (op.type === "entity.upsert") return { ...op, entity: { ...op.entity, summary: text } };
  if (op.type === "state.add") return { ...op, entry: { ...op.entry, value: text } };
  if (op.type === "node.create") return { ...op, node: { ...op.node, summary: text } };
  if (op.type === "node.update") return { ...op, patch: { ...op.patch, summary: text } };
  if (op.type === "book.update") {
    const field =
      "title" in op.patch ? "title" : "logline" in op.patch ? "logline" : "coreConflict";
    return { ...op, patch: { ...op.patch, [field]: text } };
  }
  if (op.type === "thread.upsert") return { ...op, thread: { ...op.thread, title: text } };
  if (op.type === "knowledge.set") return { ...op, row: { ...op.row, fact: text } };
  return op;
}
