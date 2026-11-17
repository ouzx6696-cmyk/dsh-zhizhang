import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { atomicWrite, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import type {
  ContextPacket,
  DeliveryReceipt,
  PipelineDefinition,
  StageSpec,
} from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { arr, int, lit, obj, parseJson, str, type Infer } from "@zhizhang/core/schema";
import { createBibleStore } from "../../bible/store.js";
import type { AuditFinding } from "../../bible/types.js";

export const HealthReq = obj({ upToChapter: int({ min: 1 }) });

export type HealthInput = Infer<typeof HealthReq>;

export interface HealthEditorReview {
  findings: AuditFinding[];
  summary: string;
  recommendations: string[];
}

interface RawFinding {
  kind: "thread_forgotten" | "thread_overdue" | "knowledge_leak" | "state_conflict";
  severity: "warn" | "bad";
  title: string;
  detail: string;
  refId: string;
}

interface RawEditorReview {
  findings: RawFinding[];
  summary: string;
  recommendations: string[];
}

const EditorHealthSchema = obj({
  findings: arr(
    obj({
      kind: lit("thread_forgotten", "thread_overdue", "knowledge_leak", "state_conflict"),
      severity: lit("warn", "bad"),
      title: str({ min: 1 }),
      detail: str({ min: 1 }),
      refId: str({ min: 1 }),
    }),
    { max: 100 },
  ),
  summary: str({ min: 1 }),
  recommendations: arr(str({ min: 1 }), { max: 20 }),
});

function toAuditFinding(finding: RawFinding): AuditFinding {
  return {
    ...finding,
    jump: finding.kind.startsWith("thread")
      ? { view: "thread", id: finding.refId }
      : { view: "entity", id: finding.refId },
  };
}

export const healthEditorStage: StageSpec<
  { upToChapter: number; localFindings: AuditFinding[]; chapterSummaries: string[] },
  RawEditorReview
> = {
  id: "editor-review",
  title: "编辑十章体检复核",
  role: "editor",
  method: { stage: "fanqie.chapter.review" },
  input: (ctx) => ({
    upToChapter: (ctx.request as HealthInput).upToChapter,
    localFindings: (ctx.state.localFindings as AuditFinding[] | undefined) ?? [],
    chapterSummaries: (ctx.state.chapterSummaries as string[] | undefined) ?? [],
  }),
  shape:
    'JSON 格式：{"findings":[{"kind":"thread_forgotten|thread_overdue|knowledge_leak|state_conflict","severity":"warn|bad","title":"标题","detail":"详情","refId":"关联ID"}],"summary":"体检总结","recommendations":["建议"]}',
  format: "json",
  parse: (raw) => parseJson(raw, EditorHealthSchema, "health.editor"),
};

export interface HealthResult {
  upToChapter: number;
  localFindings: AuditFinding[];
  editorReview: HealthEditorReview;
  findings: AuditFinding[];
}

export const healthPipeline: PipelineDefinition<HealthInput, HealthResult> = {
  kind: "fanqie.health",
  request: HealthReq,
  async context(target, req) {
    return { runId: `health-${Date.now()}`, target, request: req, state: {} };
  },
  async run(runner, ctx) {
    const req = ctx.request as HealthInput;
    const lock = createLockService(systemClock);
    const bibleStore = createBibleStore(lock);

    // 1. bible.audit
    const audited = await runner.local("bible-audit", async () => {
      const bible = await bibleStore.read(ctx.target.path);
      const ledgers = await bibleStore.ledgers(ctx.target.path);
      const localFindings = bibleStore.audit(bible, req.upToChapter, ledgers);
      const chapterSummaries = ledgers
        .filter((c) => c.position <= req.upToChapter)
        .sort((a, b) => a.position - b.position)
        .map((c) => `第${c.position}章：${c.summary}`);
      return { localFindings, chapterSummaries };
    });

    ctx.state.localFindings = audited.localFindings;
    ctx.state.chapterSummaries = audited.chapterSummaries;

    const packet: ContextPacket = {
      prefix: [
        {
          id: "health-audit-input",
          layer: 0,
          text: [
            `体检范围：第 1 至第 ${req.upToChapter} 章`,
            `本地账本审计命中（${audited.localFindings.length} 项）：`,
            ...audited.localFindings.map((f) => `- [${f.severity}] ${f.title}：${f.detail}`),
          ].join("\n"),
          required: true,
          tokens: 400,
          reason: "账本审计基线",
          source: { kind: "bible", ref: "audit" },
        },
      ],
      suffix: [],
      omitted: [],
      estimate: 400,
    };

    // 2. editor 复核
    const rawReview = await runner.stage(healthEditorStage, packet);
    const editorReview: HealthEditorReview = {
      ...rawReview,
      findings: rawReview.findings.map(toAuditFinding),
    };

    const seen = new Set<string>();
    const merged: AuditFinding[] = [];
    for (const f of [...audited.localFindings, ...editorReview.findings]) {
      const key = `${f.kind}:${f.refId}:${f.title}`;
      if (!seen.has(key)) {
        seen.add(key);
        merged.push(f);
      }
    }

    return {
      upToChapter: req.upToChapter,
      localFindings: audited.localFindings,
      editorReview,
      findings: merged,
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const healthDir = path.join(ctx.target.path, "plan", "health");
    const marker = path.join(healthDir, `${ctx.runId}.marker.json`);
    const text = JSON.stringify(res, null, 2);

    if (await isAlreadyDelivered(marker, ctx.runId)) {
      return {
        runId: ctx.runId,
        deliveredPaths: [],
        contentHash: sha256(text),
        summary: "已幂等交付十章体检报告",
      };
    }

    const report = path.join(healthDir, `up-to-${res.upToChapter}.json`);
    await atomicWrite(report, text);
    await atomicWrite(marker, buildDeliveryMarker(ctx.runId, text));
    return {
      runId: ctx.runId,
      deliveredPaths: [report],
      contentHash: sha256(text),
      summary: `十章体检完成，发现 ${res.findings.length} 项提示（${res.editorReview.summary}）`,
    };
  },
  async recover(record, ctx) {
    const marker = path.join(ctx.target.path, "plan", "health", `${record.id}.marker.json`);
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
};
