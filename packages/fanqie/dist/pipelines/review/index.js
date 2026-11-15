import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { obj, opt, str } from "@zhizhang/core/schema";
import { parseChapterMarkdown } from "../../domain/chapter.js";
import { continuityStage, makeReviewStage, } from "../chapter/index.js";
export const ReviewPipelineReq = obj({
    chapterId: str({ min: 1 }),
    note: opt(str()),
});
export const reviewPipeline = {
    kind: "fanqie.review",
    request: ReviewPipelineReq,
    async context(target, req) {
        return {
            runId: `review-${Date.now()}`,
            target,
            request: req,
            state: {},
        };
    },
    async run(runner, ctx) {
        const req = ctx.request;
        const prepared = await runner.local("prepare", async () => {
            const chapterPath = path.join(ctx.target.path, "chapters", `${req.chapterId}.md`);
            const raw = await readTextIfExists(chapterPath);
            if (!raw) {
                throw new AppError("input.not_found", `未找到章节文件：${req.chapterId}`, {
                    chapterId: req.chapterId,
                });
            }
            const doc = parseChapterMarkdown(raw);
            return {
                title: doc.meta.title || req.chapterId,
                body: doc.body,
            };
        });
        ctx.state.currentDraft = prepared;
        const packet = {
            prefix: [
                {
                    id: "review-target",
                    layer: 0,
                    text: `# ${prepared.title}\n\n${prepared.body}`,
                    required: true,
                    tokens: Math.ceil(prepared.body.length / 2),
                    reason: "待审读章节正文",
                    source: { kind: "chapter", ref: req.chapterId },
                },
            ],
            suffix: req.note
                ? [
                    {
                        id: "author-note",
                        layer: 0,
                        text: `【审读侧重点】\n${req.note}`,
                        required: true,
                        tokens: Math.ceil(req.note.length / 2),
                        reason: "作者附言",
                        source: { kind: "author", ref: "note" },
                    },
                ]
                : [],
            omitted: [],
            estimate: Math.ceil(prepared.body.length / 2),
        };
        const continuity = await runner.stage(continuityStage, packet);
        const review = await runner.stage(makeReviewStage(1), packet);
        return {
            chapterId: req.chapterId,
            title: prepared.title,
            continuityIssues: continuity.issues,
            review,
        };
    },
    async deliver(res, ctx) {
        const outDir = path.join(ctx.target.path, "candidates", res.chapterId);
        const marker = path.join(outDir, `${ctx.runId}.marker.json`);
        const payload = JSON.stringify(res, null, 2);
        if (await isAlreadyDelivered(marker, ctx.runId)) {
            return {
                runId: ctx.runId,
                deliveredPaths: [],
                contentHash: sha256(payload),
                summary: "已幂等交付审读报告",
            };
        }
        const reportPath = path.join(outDir, `${ctx.runId}.review.json`);
        await atomicWrite(reportPath, payload);
        await atomicWrite(marker, buildDeliveryMarker(ctx.runId, payload));
        return {
            runId: ctx.runId,
            deliveredPaths: [reportPath],
            contentHash: sha256(payload),
            summary: `审读完成（${res.review.verdict}），发现连续性问题 ${res.continuityIssues.length} 项、正文问题 ${res.review.issues.length} 项`,
        };
    },
    async recover(record, ctx) {
        const req = ctx.request;
        const marker = path.join(ctx.target.path, "candidates", req.chapterId, `${record.id}.marker.json`);
        return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
    },
};
