import type { Sessions } from "./manager";
import type { Target } from "../context";
import type { AgentSession } from "./pi-adapter";

const snapshots = new WeakMap<
  AgentSession,
  { leaf: string | null; value: ReturnType<typeof snapshot> }
>();
function snapshot(session: AgentSession) {
  const stats = session.getSessionStats();
  const last = session.messages.findLast((message) => message.role === "assistant");
  const entry = session.sessionManager.getBranch().findLast((entry) => entry.type === "compaction");
  return {
    context: stats.contextUsage,
    stats,
    recent:
      last?.role === "assistant"
        ? {
            input: last.usage.input,
            output: last.usage.output,
            cacheRead: last.usage.cacheRead,
            cacheWrite: last.usage.cacheWrite,
          }
        : null,
    compaction:
      entry?.type === "compaction"
        ? {
            summary: entry.summary,
            tokensBefore: entry.tokensBefore,
            at: entry.timestamp,
            input: entry.usage
              ? entry.usage.input + entry.usage.cacheRead + entry.usage.cacheWrite
              : null,
            output: entry.usage?.output ?? null,
          }
        : null,
  };
}
export async function sessionUsage(host: Sessions, target: Target) {
  let entry = host.sessions.get(host.key(target));
  const model = host.settings().writer;
  if (!entry && (model.apiKey || model.keyless)) {
    const history = await host.view(target);
    if (history.total > 0) {
      await host.open(target);
      entry = host.sessions.get(host.key(target));
    }
  }
  if (!entry)
    return {
      context: { tokens: null, contextWindow: model.contextWindow, percent: null },
      stats: null,
      compacting: false,
      compaction: null,
      recent: null,
      methods: [],
      handoff: null,
    };
  const session = entry.session,
    leaf = session.sessionManager.getLeafId();
  let cached = snapshots.get(session);
  if (!cached || cached.leaf !== leaf) {
    cached = { leaf, value: snapshot(session) };
    snapshots.set(session, cached);
  }
  return {
    ...cached.value,
    compacting: session.isCompacting,
    methods: [...entry.methods.values()],
    handoff: entry.handoff ?? null,
  };
}
