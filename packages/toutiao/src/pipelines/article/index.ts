import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { atomicWrite, readJson, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { loadProfile } from "@zhizhang/core/methods";
import { estimateTokensRaw } from "@zhizhang/core/model";
import { isAppError } from "@zhizhang/core/errors";
import {
  buildDeliveryMarker,
  definePipeline,
  isAlreadyDelivered,
  type ContextBlock,
  type ContextPacket,
  type DeliveryReceipt,
  type PipelineDefinition,
} from "@zhizhang/core/pipeline";
import { extractClaimCandidates, type ClaimCandidate } from "../../domain/claims.js";
import { parseMotifsFromS3 } from "../../domain/motifs.js";
import type { ArticleStatus } from "../../domain/status.js";
import { createRulesBridge, type QaCheckResult } from "../../rules/bridge.js";
import {
  ArticleMetaSchema,
  registerSource,
  transitionArticleStatus,
} from "../../storage/articles.js";
import {
  evaluateAntiGaming,
  filterChangedParagraphClaims,
  pickRotatedStyles,
  resolveDraftTrack,
  selectBestDraftCandidate,
} from "./rules.js";
import {
  ArticlePipelineReq,
  type ArticlePipelineResult,
  type ArticlePipelineState,
  type ArticleReq,
} from "./schemas.js";
import {
  buildBlueprintStage,
  buildCardStage,
  buildDraftStage,
  buildFactsStage,
  buildQaReviseStage,
  buildReviewStage,
  buildReviseStage,
  buildTitleStage,
} from "./stages.js";

export * from "./schemas.js";
export * from "./rules.js";

const DEFAULT_PROFILES_ROOT = path.resolve(import.meta.dirname, "../../../profiles");
const DEFAULT_ARTICLE_BUDGET = 12_000;

function makeArticlePacket(
  parts: Array<{ id: string; text: string; reason: string; kind: ContextBlock["source"]["kind"] }>,
  budget: number,
): ContextPacket {
  const prefix: ContextBlock[] = [];
  const omitted: { id: string; why: string }[] = [];
  let remaining = budget;
  for (const part of parts) {
    const trimmed = part.text.trim();
    if (!trimmed) continue;
    let text = trimmed;
    let tokens = estimateTokensRaw(text);
    if (tokens > remaining && remaining > 200) {
      const keepChars = Math.max(200, Math.floor(remaining * 1.4));
      text = `${trimmed.slice(0, keepChars)}\n…（按预算截断）`;
      tokens = estimateTokensRaw(text);
    }
    if (tokens <= remaining || prefix.length === 0) {
      prefix.push({
        id: part.id,
        layer: 0,
        text,
        required: prefix.length === 0,
        tokens,
        reason: part.reason,
        source: { kind: part.kind, ref: part.id },
      });
      remaining = Math.max(0, remaining - tokens);
    } else {
      omitted.push({ id: part.id, why: "超出文章上下文预算" });
    }
  }
  const estimate = prefix.reduce((sum, b) => sum + b.tokens, 0);
  return { prefix, suffix: [], omitted, estimate };
}

function resolveProfileDir(req: ArticleReq): string {
  return (
    req.profileDir ||
    process.env.ZHIZHANG_TOUTIAO_PROFILE_DIR ||
    path.join(DEFAULT_PROFILES_ROOT, "default")
  );
}

export const articlePipeline: PipelineDefinition<
  ArticleReq,
  ArticlePipelineResult,
  ArticlePipelineState
> = definePipeline<ArticleReq, ArticlePipelineResult, ArticlePipelineState>({
  kind: "toutiao.article",
  request: ArticlePipelineReq,
  async context(target, req, env) {
    const clock = env.clock ?? systemClock;
    const lock = env.lock ?? createLockService(clock);
    const profileDir = resolveProfileDir(req);
    const profile =
      env.profile ??
      (await loadProfile(
        "toutiao",
        env.profileId || path.basename(profileDir),
        env.profileRoots ?? { builtinDir: path.dirname(profileDir) },
      ).catch((err: unknown) => {
        if (isAppError(err) && err.code === "input.not_found") return undefined;
        throw err;
      }));
    return {
      runId: `tt-${clock.now()}`,
      target,
      request: req,
      state: { draftTrack: resolveDraftTrack(req) },
      clock,
      lock,
      budget: env.budget,
      profileId: env.profileId,
      profile,
      profileRoots: env.profileRoots ?? { builtinDir: path.dirname(profileDir) },
    };
  },
  async run(runner, ctx): Promise<ArticlePipelineResult> {
    const req = ctx.request;
    const clock = ctx.clock ?? systemClock;
    const lock = ctx.lock ?? createLockService(clock);
    const articleDir = ctx.target.path;
    const bridge = createRulesBridge({ signal: runner.signal });
    const inputBudget = ctx.budget?.inputBudget ?? DEFAULT_ARTICLE_BUDGET;

    // 1. source: 登记/读取素材来源
    const sourceData = await runner.local("source", async () => {
      const sourcesDir = path.join(articleDir, "sources");
      await fs.mkdir(sourcesDir, { recursive: true });
      if (req.sourceText?.trim()) {
        await registerSource(
          articleDir,
          "source-1",
          req.sourceKind ?? "paste",
          req.sourceText,
          clock.iso(),
          lock,
        );
      }
      const entries = await fs.readdir(sourcesDir).catch(() => []);
      const txtFiles = entries.filter((name) => name.endsWith(".txt")).sort();
      const contents = await Promise.all(
        txtFiles.map(async (file) => {
          const text = (await readTextIfExists(path.join(sourcesDir, file))) ?? "";
          return { id: file.replace(/\.txt$/, ""), text, hash: sha256(text) };
        }),
      );
      return {
        sources: contents,
        combinedText: contents.map((c) => `[${c.id}]\n${c.text}`).join("\n\n"),
      };
    });

    const limits = await runner.local("rules-limits", () => bridge.limits());
    const sourcePacket = makeArticlePacket(
      [
        {
          id: "article-meta",
          text: `体裁：${req.genre}；主驱动：${req.driver}${req.line ? `；内容线：${req.line}` : ""}`,
          reason: "文章定位与体裁约束",
          kind: "author",
        },
        {
          id: "article-sources",
          text: sourceData.combinedText,
          reason: "登记素材快照",
          kind: "source",
        },
      ],
      inputBudget,
    );

    // 2. card: 立项卡生成 + rules/bridge 预检（方法由 stage-map 单源注入）
    const cardPath = path.join(articleDir, "card.json");
    const card = await runner.stage(
      buildCardStage({
        req,
        sourceText: sourceData.combinedText,
        cardPath,
        checkCard: (p) => bridge.checkCard(p),
      }),
      sourcePacket,
    );

    const cardPacket = makeArticlePacket(
      [
        {
          id: "article-card",
          text: `【立项卡】\n${JSON.stringify(card)}`,
          reason: "立项卡核心约束",
          kind: "plan",
        },
        {
          id: "article-sources",
          text: sourceData.combinedText,
          reason: "登记素材快照",
          kind: "source",
        },
      ],
      inputBudget,
    );

    // 3. title: parseMotifsFromS3 + validateTitleMatrix
    const s3Text =
      ctx.profile?.files["s3-headline.md"] ??
      (await readTextIfExists(path.join(resolveProfileDir(req), "s3-headline.md"))) ??
      "";
    const s3Motifs = parseMotifsFromS3(s3Text);
    const titleMatrix = await runner.stage(
      buildTitleStage({ card, limits, motifs: s3Motifs }),
      cardPacket,
    );

    // 4. blueprint: 开头/结尾轮换（从 rules/bridge 结构化清单读取）
    const stylesCatalog = await runner.local("rules-styles", () => bridge.styles());
    const activeLine = req.line ?? (req.driver === "故事型" ? "故事线" : "资讯线");
    const lineStyles = stylesCatalog.byLine[activeLine];
    const openingPool = lineStyles?.openings.length
      ? lineStyles.openings
      : stylesCatalog.allOpenings;
    const endingPool = lineStyles?.endings.length ? lineStyles.endings : stylesCatalog.allEndings;
    const rotated = pickRotatedStyles(
      req.recentOpenings,
      req.recentEndings,
      openingPool,
      endingPool,
    );
    const blueprint = await runner.stage(
      buildBlueprintStage({
        card,
        title: titleMatrix.main,
        recommendedOpening: rotated.openingStyle,
        recommendedEnding: rotated.endingStyle,
        recentOpenings: req.recentOpenings ?? [],
        recentEndings: req.recentEndings ?? [],
      }),
      cardPacket,
    );

    // 5. draft×N + 轻量择优（按体裁仅注入对应 s4-* 规范）
    const draftCandidates = await runner.fanOut(
      buildDraftStage({
        card,
        title: titleMatrix.main,
        blueprint,
        sourceText: sourceData.combinedText,
      }),
      cardPacket,
    );
    const selected = await runner.local("draft-select", async () =>
      selectBestDraftCandidate(draftCandidates, titleMatrix.main.text, blueprint),
    );
    ctx.state.selectedDraftIndex = selected.index;
    const initialDraft = selected.draft;

    // 6. claims + 7. facts
    const claimCandidates = await runner.local("claims", async () =>
      extractClaimCandidates(initialDraft),
    );
    const sourceHashMap = new Map(sourceData.sources.map((s) => [s.id, s.hash]));
    const runFacts = async (stepId: string, list: ClaimCandidate[]): Promise<ClaimCandidate[]> => {
      if (list.length === 0) return [];
      return runner.stage(
        buildFactsStage(stepId, list, sourceData.combinedText, sourceData.sources),
        sourcePacket,
      );
    };
    let verifiedClaims = await runFacts("facts", claimCandidates);

    // 8. review + 9. revise（方法均由 stage-map 单源注入 s5-editing）
    const review = await runner.stage(
      buildReviewStage({ draft: initialDraft, card, claims: verifiedClaims }),
      cardPacket,
    );
    const revisedDraft = await runner.stage(
      buildReviseStage({ draft: initialDraft, review, claims: verifiedClaims }),
      cardPacket,
    );

    // 10. qa: 纯 TS 质检 ≥ pass_score (84)；临时文件隔离在 .tmp/ 并在结束后清理，不污染 drafts/
    const runQaOnText = async (stepId: string, text: string): Promise<QaCheckResult> => {
      return runner.local(stepId, async () => {
        const qaDir = path.join(articleDir, ".tmp");
        const qaFile = path.join(qaDir, `${ctx.runId}.${stepId}.md`);
        await atomicWrite(qaFile, text);
        try {
          return await bridge.qa({
            file: qaFile,
            card: cardPath,
            ledger: req.ledgerPath,
            mode: limits.genres.includes(req.genre) ? undefined : "long",
            articleId: req.articleId,
          });
        } finally {
          await fs.rm(qaFile, { force: true }).catch(() => undefined);
        }
      });
    };

    const verifyRevision = async (text: string, stepId: string) => {
      const incremental = await runner.local(`${stepId}-claims`, async () =>
        filterChangedParagraphClaims(text, verifiedClaims, sourceHashMap),
      );
      const checked = await runFacts(`${stepId}-facts`, incremental.toVerify);
      verifiedClaims = [...incremental.reused, ...checked];
    };
    await verifyRevision(revisedDraft, "revise");

    let currentDraft = revisedDraft;
    let qaResult = await runQaOnText("qa", currentDraft);
    const passScore = limits.pass_score;

    // 11. qa-revise×≤2: filterChangedParagraphClaims 增量复核
    for (let round = 1; round <= 2; round++) {
      if (qaResult.overall >= passScore && qaResult.passed) break;
      currentDraft = await runner.stage(
        buildQaReviseStage({ draft: currentDraft, qa: qaResult, round }),
        cardPacket,
      );
      await verifyRevision(currentDraft, `qa-revise-${round}`);
      qaResult = await runQaOnText(`qa-recheck-${round}`, currentDraft);
    }

    // 12. antigaming: 统计口语标记/小标题增量提示
    const antigaming = await runner.local("antigaming", async () =>
      evaluateAntiGaming(revisedDraft, currentDraft),
    );

    ctx.state.finalStatus = "待验收" satisfies ArticleStatus;
    return {
      articleId: req.articleId,
      title: titleMatrix.main.text,
      draft: currentDraft,
      qa: qaResult,
      claims: verifiedClaims,
      antigaming,
      status: "待验收",
    };
  },
  async deliver(res, ctx): Promise<DeliveryReceipt> {
    const clock = ctx.clock ?? systemClock;
    const lock = ctx.lock ?? createLockService(clock);
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
    if (meta && (meta.status === "初稿待改" || meta.status === "验收退回")) {
      await transitionArticleStatus(ctx.target.path, "待验收", clock.iso(), lock);
    }

    return {
      runId: ctx.runId,
      deliveredPaths: [draftPath],
      contentHash: sha256(res.draft),
      summary: `已生成待验收草稿「${res.title}」（QA ${res.qa.overall} 分）`,
    };
  },
  async recover(record, ctx) {
    const marker = path.join(ctx.target.path, "drafts", `${record.id}.marker.json`);
    return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
  },
});
