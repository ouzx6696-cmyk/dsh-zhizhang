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

export type ReviseMode = "revise" | "deai" | "polish";

export const RevisePipelineReq = obj({
  chapterId: str({ min: 1 }),
  mode: opt(lit("revise", "deai", "polish")),
  issues: opt(arr(IssueInputSchema, { max: 50 })),
  note: opt(str()),
});

export type ReviseReq = Infer<typeof RevisePipelineReq>;

export interface StandaloneReviseResult {
  chapterId: string;
  mode: ReviseMode;
  title: string;
  body: string;
  gate: GateReport;
  review: ReviewResult;
  editorPass: boolean;
  editorRejections: number;
}

const MODE_DIRECTIVES: Record<
  Exclude<ReviseMode, "revise">,
  { text: string; issue: ReviewIssue }
> = {
  deai: {
    text: "【专项模式：去 AI 腔精修】\n聚焦消除一阶与二阶 AI 腔（翻译腔、书面腔、情绪复述、工整排比、安全结句），不改动任何已锁定的事实、人名、地名、时间线、设定数值与剧情主干。",
    issue: {
      kind: "reader",
      quote: "",
      issue: "存在一阶或二阶 AI 腔痕迹",
      fix: "按去 AI 腔清单逐句改写为自然口语与动作细节，严格保持剧情推进与设定事实不变",
    },
  },
  polish: {
    text: "【专项模式：轻润色精修】\n仅做句式流畅度、对话口语化与移动端段落呼吸感微调，严格保持原有情节推进、设定事实、人物口吻与章末钩子不变。",
    issue: {
      kind: "reader",
      quote: "",
      issue: "需做句子流畅度与移动端段落呼吸感轻润色",
      fix: "压缩冗长修饰语、拆分超长段、增强对白自然感，不改任何情节与设定事实",
    },
  },
};

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
    const mode: ReviseMode = req.mode ?? "revise";
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
    const specialist = mode === "revise" ? undefined : MODE_DIRECTIVES[mode];
    let pendingIssues: ReviewIssue[] =
      req.issues && req.issues.length > 0 ? req.issues : specialist ? [specialist.issue] : [];
    let latestReview: ReviewResult = {
      verdict: "revise",
      issues: pendingIssues,
      summary: "待修稿复审",
    };
    let editorPass = false;
    let editorRejections = 0;

    ctx.state.currentDraft = current;

    const suffix: ContextPacket["suffix"] = [];
    if (specialist) {
      suffix.push({
        id: `revise-mode-${mode}`,
        layer: 0,
        text: specialist.text,
        required: true,
        tokens: Math.ceil(specialist.text.length / 2),
        reason: mode === "deai" ? "去 AI 腔专项指令" : "轻润色专项指令",
        source: { kind: "author", ref: `mode:${mode}` },
      });
    }
    if (req.note) {
      suffix.push({
        id: "revise-note",
        layer: 0,
        text: `【修改说明】\n${req.note}`,
        required: true,
        tokens: Math.ceil(req.note.length / 2),
        reason: "作者修改说明",
        source: { kind: "author", ref: "note" },
      });
    }

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
      suffix,
      omitted: [],
      estimate: Math.ceil(current.body.length / 2),
    };

    const maxRounds = specialist ? 1 : MAX_EDITOR_REJECTIONS;
    for (let round = 1; round <= maxRounds; round++) {
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

      if (specialist) {
        editorPass = false;
        latestReview = {
          verdict: "revise",
          issues: [],
          summary:
            mode === "deai"
              ? "去 AI 腔专项精修完成（已通过基础门禁，未经过编辑审读，待作者对照裁决）"
              : "轻润色专项精修完成（已通过基础门禁，未经过编辑审读，待作者对照裁决）",
        };
        break;
      }

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
      mode,
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
    const reviewPerformed = res.mode === "revise";
    await atomicWrite(
      path.join(outDir, `${ctx.runId}.meta.json`),
      JSON.stringify(
        {
          mode: res.mode,
          reviewPerformed,
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
    const modeLabel =
      res.mode === "deai" ? "去 AI 腔精修" : res.mode === "polish" ? "轻润色精修" : "修稿";
    const statusLabel = !reviewPerformed
      ? "专项精修完成（未经编辑审读，待作者裁决）"
      : res.editorPass
        ? "复审通过"
        : `打回 ${res.editorRejections} 轮待作者裁决`;
    return {
      runId: ctx.runId,
      deliveredPaths: [candFile],
      contentHash: sha256(res.body),
      summary: `${modeLabel}完成「${res.title}」（${res.gate.wordCount} 字，${statusLabel}）`,
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
