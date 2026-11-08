import path from "node:path";
import { atomicWrite, readJson, sha256, nowIso } from "../../../../packages/core/src/fsx";
import { withResourceLock } from "../../../../packages/fanqie/src/engine/storage/process-lock";
import { readChapter } from "../../../../packages/fanqie/src/engine/storage/chapters";
import { emptyUsage } from "../../../../packages/core/src/workflow";
import { resolveFanqieWork } from "../main/storage";
import { jsonOutput, record, list, text, locate } from "./schema";
import type { WorkflowRun } from "./run";
import type { Target } from "../context";

const FACT_KINDS = ["character", "object", "knowledge", "thread", "timeline"] as const;
type FactKind = (typeof FACT_KINDS)[number];
export interface Fact {
  kind: FactKind;
  subject: string;
  value: string;
  quote: string;
  chapter: string;
  bodyHash: string;
}
export interface PendingFact extends Fact {
  id: string;
  reason: string;
}
export interface ContinuityState {
  schema: 1;
  facts: Fact[];
  pending: PendingFact[];
  chapters: { id: string; hash: string; summary: string; hook: string; emotion: number }[];
}
function parseFact(value: unknown): Fact {
  const r = record(value);
  if (!FACT_KINDS.includes(r.kind as FactKind)) throw new Error("连续性事实类别无效");
  return {
    kind: r.kind as FactKind,
    subject: text(r.subject, "事实主体", 200),
    value: text(r.value, "事实状态", 2000),
    quote: text(r.quote, "事实证据", 2000),
    chapter: text(r.chapter, "章节", 64),
    bodyHash: text(r.bodyHash, "正文指纹", 64),
  };
}
export function parseContinuity(value: unknown): ContinuityState {
  const r = record(value);
  if (r.schema !== 1) throw new Error("连续性状态版本无效，未覆盖原文件");
  const facts = list(r.facts, "连续性事实", 10000).map(parseFact),
    pending = list(r.pending, "待确认事实", 10000).map((value) => {
      const row = record(value);
      return {
        ...parseFact(row),
        id: text(row.id, "冲突编号", 64),
        reason: text(row.reason, "确认原因"),
      };
    });
  const chapters = list(r.chapters, "章节状态", 10000).map((value) => {
    const row = record(value);
    if (typeof row.emotion !== "number" || row.emotion < 0 || row.emotion > 5)
      throw new Error("章节情绪强度无效");
    return {
      id: text(row.id, "章节", 64),
      hash: text(row.hash, "正文指纹", 64),
      summary: text(row.summary, "章节摘要", 2000),
      hook: text(row.hook, "钩子类型", 100),
      emotion: row.emotion,
    };
  });
  if (
    new Set(facts.map((f) => f.kind + ":" + f.subject)).size !== facts.length ||
    new Set(pending.map((f) => f.id)).size !== pending.length ||
    new Set(chapters.map((c) => c.id)).size !== chapters.length
  )
    throw new Error("连续性状态存在重复记录");
  return { schema: 1, facts, pending, chapters };
}
export async function readContinuity(dir: string): Promise<ContinuityState> {
  const value = await readJson<unknown>(path.join(dir, "writer-continuity.json"));
  return value === undefined
    ? { schema: 1, facts: [], pending: [], chapters: [] }
    : parseContinuity(value);
}
/** The ten-chapter audit reads a window of the ledger so it stays inside one stage budget. */
const AUDIT_FACTS = 150;
const AUDIT_CHAPTERS = 30;
export async function ledgerPipeline(run: WorkflowRun, target: Target) {
  const dir = await resolveFanqieWork(run.host.options, target),
    chapter = await readChapter(dir, run.journal.record.request.chapter);
  if (chapter.status !== "final") throw new Error("只有作者已定稿的正文才进入自动记账");
  const hash = sha256(chapter.body),
    before = await readContinuity(dir);
  const changes = await run.model(
    "extract",
    "抽取定稿变化",
    "planner",
    "只记录正文明确发生的变化，不把推断当事实；每条必须给正文原文证据。",
    {
      body: chapter.body,
      // Only prior states of subjects this chapter actually names; the ledger itself grows per chapter.
      previous: before.facts.filter((fact) => chapter.body.includes(fact.subject)),
    },
    '返回 {"facts":[{"kind":"character/object/knowledge/thread/timeline","subject":"主体","value":"当前状态","quote":"正文原文"}],"summary":"本章实际后果","hook":"悬念/反转/危机/期待/收束","emotion":3}，emotion为0至5。',
    (value) => {
      const r = jsonOutput(value),
        facts = list(r.facts, "定稿变化", 30).map((value) => {
          const raw = record(value),
            quote = typeof raw.quote === "string" ? locate(chapter.body, raw.quote) : undefined;
          if (quote === undefined) throw new Error("记账证据不在定稿正文中");
          return parseFact({ ...raw, quote, chapter: chapter.id, bodyHash: hash });
        });
      if (typeof r.emotion !== "number" || r.emotion < 0 || r.emotion > 5)
        throw new Error("情绪强度应为0至5");
      return {
        facts,
        summary: text(r.summary, "本章后果", 2000),
        hook: text(r.hook, "钩子类型", 100),
        emotion: r.emotion,
      };
    },
    { material: [] },
  );
  if (run.context.chapterPosition % 10 === 0)
    await run.model(
      "long-audit",
      "长线状态体检",
      "editor",
      "只依据已落盘的结构化状态与摘要检查矛盾、未回收事项和重复钩子，不编造正文事实。",
      {
        state: {
          facts: before.facts.slice(-AUDIT_FACTS),
          pending: before.pending,
          chapters: before.chapters.slice(-AUDIT_CHAPTERS),
        },
        changes,
      },
      '返回 {"risks":["定位到主体或章节的风险"],"forgotten":["到期未回收事项"],"rhythm":["连续重复或缺少推进的章节"]}。',
      (value) => {
        const r = jsonOutput(value);
        return {
          risks: list(r.risks, "风险").map((v) => text(v, "风险")),
          forgotten: list(r.forgotten, "未回收").map((v) => text(v, "未回收")),
          rhythm: list(r.rhythm, "节奏").map((v) => text(v, "节奏")),
        };
      },
      {
        material: [
          { name: "范围", text: "本阶段仅使用已给定的状态与摘要，不读取章节全文", required: true },
        ],
      },
    );
  const result = await run.journal.step(
    "delivery",
    "登记定稿事实与冲突",
    record,
    async () =>
      withResourceLock(dir, async () => {
        await run.context.assertCurrent();
        if (sha256((await readChapter(dir, chapter.id)).body) !== hash)
          throw new Error("定稿正文已变化，未提交旧版事实");
        const current = await readContinuity(dir);
        if (current.chapters.some((row) => row.id === chapter.id && row.hash === hash))
          return { value: { chapter: chapter.id, duplicate: true }, usage: emptyUsage() };
        for (const fact of changes.facts) {
          const old = current.facts.find(
            (row) => row.kind === fact.kind && row.subject === fact.subject,
          );
          if (old && old.value !== fact.value) {
            const id = sha256(JSON.stringify(fact)).slice(0, 24);
            if (!current.pending.some((row) => row.id === id))
              current.pending.push({ ...fact, id, reason: `原状态：${old.value}` });
          } else if (!old) current.facts.push(fact);
        }
        current.chapters = current.chapters.filter((row) => row.id !== chapter.id);
        current.chapters.push({
          id: chapter.id,
          hash,
          summary: changes.summary,
          hook: changes.hook,
          emotion: changes.emotion,
        });
        await atomicWrite(
          path.join(dir, "writer-continuity.json"),
          JSON.stringify(current, null, 2),
        );
        return {
          value: {
            chapter: chapter.id,
            recorded: changes.facts.length,
            pending: current.pending.length,
            at: nowIso(),
          },
          usage: emptyUsage(),
        };
      }),
    run.signal,
    0,
  );
  return result;
}
export async function decideFact(dir: string, id: string, accept: boolean) {
  return withResourceLock(dir, async () => {
    const state = await readContinuity(dir),
      fact = state.pending.find((row) => row.id === id);
    if (!fact) throw new Error("待确认事实不存在或已处理");
    if (
      fact.chapter !== "legacy" &&
      sha256((await readChapter(dir, fact.chapter)).body) !== fact.bodyHash
    )
      throw new Error("事实对应的正文已变化，请重新记账");
    if (accept) {
      state.facts = state.facts.filter(
        (row) => row.kind !== fact.kind || row.subject !== fact.subject,
      );
      const { id: _id, reason: _reason, ...value } = fact;
      state.facts.push(value);
    }
    state.pending = state.pending.filter((row) => row.id !== id);
    await atomicWrite(path.join(dir, "writer-continuity.json"), JSON.stringify(state, null, 2));
    return state;
  });
}
