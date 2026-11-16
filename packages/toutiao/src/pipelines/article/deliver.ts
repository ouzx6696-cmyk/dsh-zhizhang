import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { atomicWrite, readJson, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import type { PipelineDefinition } from "@zhizhang/core/pipeline";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { ArticleMetaSchema, transitionArticleStatus } from "../../storage/articles.js";
import { summarizeArticleDelivery } from "./qa.js";
import type { ArticlePipelineResult, ArticleReq } from "./types.js";

type ArticlePipeline = PipelineDefinition<ArticleReq, ArticlePipelineResult>;

export const deliverArticle: ArticlePipeline["deliver"] = async (res, ctx) => {
  const draftPath = path.join(ctx.target.path, "drafts", `rev-${ctx.runId}.md`);
  const marker = path.join(ctx.target.path, "drafts", `${ctx.runId}.marker.json`);
  if (await isAlreadyDelivered(marker, ctx.runId)) {
    return {
      runId: ctx.runId,
      deliveredPaths: [],
      contentHash: sha256(res.draft),
      summary: "已幂等交付",
    };
  }
  const content = res.draft.startsWith("# ") ? res.draft : `# ${res.title}\n\n${res.draft}`;
  await atomicWrite(draftPath, content);
  await atomicWrite(marker, buildDeliveryMarker(ctx.runId, res.draft));

  const meta = await readJson(path.join(ctx.target.path, "meta.json"), ArticleMetaSchema);
  if (
    res.status === "待验收" &&
    meta &&
    (meta.status === "初稿待改" || meta.status === "验收退回")
  ) {
    await transitionArticleStatus(
      ctx.target.path,
      "待验收",
      systemClock.iso(),
      createLockService(systemClock),
    );
  }

  return {
    runId: ctx.runId,
    deliveredPaths: [draftPath],
    contentHash: sha256(res.draft),
    summary: summarizeArticleDelivery(res),
  };
};

export const recoverArticle: ArticlePipeline["recover"] = async (record, ctx) => {
  const marker = path.join(ctx.target.path, "drafts", `${record.id}.marker.json`);
  return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
};
