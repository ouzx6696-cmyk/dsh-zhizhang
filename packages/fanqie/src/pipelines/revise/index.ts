import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import {
  atomicWrite,
  resolveResourcePath,
  readJson,
  readTextIfExists,
  sha256,
} from "@zhizhang/core/fs";
import type { ContextPacket, DeliveryReceipt, PipelineDefinition } from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { arr, lit, obj, opt, str, type Infer } from "@zhizhang/core/schema";
import { parseChapterMarkdown } from "../../domain/chapter.js";
import { MAX_EDITOR_REJECTIONS } from "../../domain/status.js";
import { WorkMetaSchema } from "../../storage/work.js";
import {
  gateDraft,
  makeReviewStage,
  makeReviseStage,
  type DraftOutput,
  type GateReport,
  type ReviewIssue,
  type ReviewResult,
} from "../chapter/index.js";

const IssueInputSchema = obj({
  kind: lit("continuity", "reader"),
  quote: str(),
  issue: str({ min: 1 }),
  fix: str({ min: 1 }),
});

export const RevisePipelineReq = obj({
  chapterId: str({ min: 1 }),
  issues: opt(arr(IssueInputSchema, { max: 50 })),
  note: opt(str()),
});

export type ReviseReq = Infer<typeof RevisePipelineReq>;

export interface StandaloneReviseResult {
  chapterId: string;
  title: string;
  body: string;
  gate: GateReport;
  review: ReviewResult;
  editorPass: boolean;
  editorRejections: number;
}

export const revisePipeline: PipelineDefinition<
  ReviseReq,
  StandaloneReviseResult,
  Record<string, unknown> & {
    currentDraft?: { title: string; body: string };
    pendingIssues?: ReviewIssue[];
  }
> = {
  kind: "fanqie.revise",
  request: RevisePipelineReq,
  async context(target, req, env) {
    const clock = env?.clock ?? systemClock;
    return {
      runId: `revise-${clock.now()}`,
      target,
      request: req,
      state: {},
      clock,
      lock: env?.lock,
      budget: env?.budget,
    };
  },
  async run(runner, ctx) {
    const req = ctx.request;
    const prepared = await runner.local("prepare", async () => {
      const workMeta = await readJson(
        path.join(ctx.target.path, "work.json"),
        WorkMetaSchema,
      ).catch(() => undefined);
      const chapterPath = resolveResourcePath(ctx.target.path, "chapters", `${req.chapterId}.md`);
      const raw = await readTextIfExists(chapterPath);
      if (!raw) {
        throw new AppError("input.not_found", `未找到章节文件：${req.chapterId}`, {
          chapterId: req.chapterId,
        });
      }
      const doc = parseChapterMarkdown(raw);
      return {
        draft: { title: doc.meta.title || req.chapterId, body: doc.body },
        targetWords: workMeta?.settings.targetWords ?? 3000,
      };
    });

    let current: DraftOutput = prepared.draft;
    let currentGate = gateDraft(current, { targetWords: prepared.targetWords });
    let pendingIssues: ReviewIssue[] = req.issues ?? [];
    let latestReview: ReviewResult = {
      verdict: "revise",
      issues: pendingIssues,
      summary: "待修稿复审",
    };
    let editorPass = false;
    let editorRejections = 0;

    ctx.state.currentDraft = current;

    const packet: ContextPacket = {
      prefix: [
        {
          id: "revise-source",
          layer: 0,
          text: `# ${current.title}\n\n${current.body}`,
          required: true,
          tokens: Math.ceil(current.body.length / 2),
          reason: "待修改章节原文",
          source: { kind: "chapter", ref: req.chapterId },
        },
      ],
      suffix: req.note
        ? [
            {
              id: "revise-note",
              layer: 0,
              text: `【修改说明】\n${req.note}`,
              required: true,
              tokens: Math.ceil(req.note.length / 2),
              reason: "作者修改说明",
              source: { kind: "author", ref: "note" },
            },
          ]
        : [],
      omitted: [],
      estimate: Math.ceil(current.body.length / 2),
    };

    for (let round = 1; round <= MAX_EDITOR_REJECTIONS; round++) {
      ctx.state.pendingIssues = pendingIssues;
      const revised = await runner.stage(makeReviseStage(round), packet);
      const revisedGate = await runner.local(`gate-revise-${round}`, async () =>
        gateDraft(revised, { targetWords: prepared.targetWords }),
      );
      if (!revisedGate.passed) {
        throw new AppError(
          "model.output_invalid",
          `修稿第 ${round} 轮未通过门禁：${revisedGate.reasons.join("；")}`,
          { reasons: revisedGate.reasons },
        );
      }
      current = revised;
      currentGate = revisedGate;
      ctx.state.currentDraft = current;

      latestReview = await runner.stage(makeReviewStage(round), packet);
      if (latestReview.verdict === "pass" && latestReview.issues.length === 0) {
        editorPass = true;
        break;
      }
      editorRejections = round;
      pendingIssues = latestReview.issues;
    }

    return {
      chapterId: req.chapterId,
      title: current.title,
      body: current.body,
      gate: currentGate,
      review: latestReview,
      editorPass,
      editorRejections,
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const outDir = resolveResourcePath(ctx.target.path, "candidates", res.chapterId);
    const marker = path.join(outDir, `${ctx.runId}.marker.json`);
    if (await isAlreadyDelivered(marker, ctx.runId)) {
      return {
        runId: ctx.runId,
        deliveredPaths: [],
        contentHash: sha256(res.body),
        summary: "已幂等交付修稿候选",
      };
    }
    const candFile = path.join(outDir, `${ctx.runId}.md`);
    await atomicWrite(candFile, `# ${res.title}\n\n${res.body}`);
    await atomicWrite(
      path.join(outDir, `${ctx.runId}.meta.json`),
      JSON.stringify(
        {
          bodyHash: sha256(res.body),
          editorPass: res.editorPass,
          editorRejections: res.editorRejections,
          review: res.review,
        },
        null,
        2,
      ),
    );
    await atomicWrite(marker, buildDeliveryMarker(ctx.runId, res.body));
    return {
      runId: ctx.runId,
      deliveredPaths: [candFile],
      contentHash: sha256(res.body),
      summary: `修稿完成「${res.title}」（${res.gate.wordCount} 字，${res.editorPass ? "复审通过" : `打回 ${res.editorRejections} 轮待作者裁决`}）`,
    };
  },
  async recover(record, ctx) {
    const req = ctx.request;
    const marker = resolveResourcePath(
      ctx.target.path,
      "candidates",
      req.chapterId,
      `${record.id}.marker.json`,
    );
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
};
