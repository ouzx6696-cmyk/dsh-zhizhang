/** 截至第 N 章的设定集视图。 */
import type { BibleSnapshot, BibleView, LedgerEntry, Thread } from "./types.js";

function threadAt(thread: Thread, position: number): Thread | undefined {
  if (thread.opened > position) return undefined;
  if (thread.status === "paid") {
    const paidAt = thread.beats
      .filter((beat) => beat.kind === "pay" && beat.chapter <= position)
      .reduce((max, beat) => Math.max(max, beat.chapter), 0);
    if (paidAt === 0) return { ...thread, status: "open" };
  }
  return thread;
}

export function asOf(
  bible: BibleSnapshot,
  position: number,
  ledgerList: LedgerEntry[] = [],
  recentFactsWindow = 5,
): BibleView {
  const from = Math.max(0, position - Math.max(0, recentFactsWindow));
  const recentFacts = ledgerList
    .filter((entry) => entry.position > from && entry.position < position)
    .flatMap((entry) => entry.facts.map((fact) => ({ ...fact, position: entry.position })));
  return {
    position,
    entities: bible.entities,
    states: bible.states.filter(
      (entry) => entry.since <= position && (entry.until === undefined || position < entry.until),
    ),
    threads: bible.threads
      .map((thread) => threadAt(thread, position))
      .filter((thread): thread is Thread => thread !== undefined),
    knowledge: bible.knowledge.filter((row) => row.since <= position),
    recentFacts,
  };
}
