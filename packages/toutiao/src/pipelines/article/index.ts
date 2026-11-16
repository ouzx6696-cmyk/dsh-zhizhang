import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import type { PipelineDefinition, StageSpec } from "@zhizhang/core/pipeline";
import { extractClaimCandidates } from "../../domain/claims.js";
import { parseMotifsFromS3, type MotifSpec } from "../../domain/motifs.js";
import { createRulesBridge, type QaCheckResult } from "../../rules/bridge.js";
import { registerSource } from "../../storage/articles.js";
import { deliverArticle, recoverArticle } from "./deliver.js";
import {
  evaluateAntiGaming,
  extractJsonBlock,
  filterChangedParagraphClaims,
  makePacket,
  mergeFactResults,
  pickRotatedStyles,
  refBlock,
  resolveProfileDir,
  resolveScriptsDir,
  validateTitleMatrix,
} from "./helpers.js";
import { resolveQaOutcome, runQaRevisionLoop } from "./qa.js";
import {
  ArticlePipelineReq,
  type ArticlePipelineResult,
  type ArticleReq,
  type BlueprintOutput,
  type FactCheckOutput,
  type ReviewOutput,
  type TitleCandidate,
  type TitleMatrixOutput,
} from "./types.js";

export * from "./types.js";
export {
  evaluateAntiGaming,
  filterChangedParagraphClaims,
  pickRotatedStyles,
  validateTitleMatrix,
} from "./helpers.js";
export { resolveQaOutcome } from "./qa.js";

export const articlePipeline: PipelineDefinition<ArticleReq, ArticlePipelineResult> = {
  kind: "toutiao.article",
  request: ArticlePipelineReq,
  async context(target, req) {
    return { runId: `tt-${Date.now()}`, target, request: req, state: {} };
  },
  async run(runner, ctx): Promise<ArticlePipelineResult> {
    const req = ctx.request as ArticleReq;
    const articleDir = ctx.target.path;
    const scriptsDir = resolveScriptsDir(req);
    const profileDir = resolveProfileDir(req);
    const bridge = createRulesBridge(scriptsDir);
    const lock = createLockService(systemClock);

    const sourceData = await runner.local("source", async () => {
      const sourcesDir = path.join(articleDir, "sources");
      await fs.mkdir(sourcesDir, { recursive: true });
      if (req.sourceText?.trim()) {
        await registerSource(
          articleDir,
          "source-1",
          req.sourceKind ?? "paste",
          req.sourceText,
          systemClock.iso(),
          lock,
        );
      }
      const entries = await fs.readdir(sourcesDir).catch(() => []);
      const txtFiles = entries.filter((name) => name.endsWith(".txt")).sort();
      const contents = await Promise.all(
        txtFiles.map(async (file) => ({
          id: file.replace(/\.txt$/, ""),
          text: (await readTextIfExists(path.join(sourcesDir, file))) ?? "",
        })),
      );
      return {
        sources: contents,
        combinedText: contents.map((c) => `[${c.id}]\n${c.text}`).join("\n\n"),
      };
    });

    const limits = await runner.local("rules-limits", () => bridge.limits());
    const s2Text = (await readTextIfExists(path.join(profileDir, "s2-selection.md"))) ?? "";
    const cardPath = path.join(articleDir, "card.json");
    const cardStage: StageSpec<
      {
        articleId: string;
        genre: string;
        driver: string;
        line?: string;
        note?: string;
        source: string;
      },
      Record<string, unknown>
    > = {
      id: "card",
      title: "立项卡生成与预检",
      role: "planner",
      method: { stage: "toutiao.article.card" },
      input: () => ({
        articleId: req.articleId,
        genre: req.genre,
        driver: req.driver,
        line: req.line,
        note: req.note,
        source: sourceData.combinedText,
      }),
      shape:
        "输出合法 JSON 立项卡对象，须包含 主问题、核心事实、读者、体裁、内容线、主驱动；若体裁为长图文须包含 延伸（含 起始小标题、接的问题、接法）。",
      format: "json",
      parse: (raw) => extractJsonBlock<Record<string, unknown>>(raw),
      async accept(card) {
        const enriched = {
          体裁: req.genre,
          主驱动: req.driver,
          ...(req.line ? { 内容线: req.line } : {}),
          ...card,
        };
        await atomicWrite(cardPath, JSON.stringify(enriched, null, 2));
        const check = await bridge.checkCard(cardPath);
        if (!check.ok) {
          throw new AppError(
            "model.output_invalid",
            `立项卡预检未通过：${check.errors.join("；")}`,
            { errors: check.errors },
          );
        }
        return enriched;
      },
      retries: 1,
    };
    const card = await runner.stage(
      cardStage,
      makePacket(s2Text ? [refBlock("s2-selection", "s2-selection.md", s2Text)] : []),
    );

    const s3Text = (await readTextIfExists(path.join(profileDir, "s3-headline.md"))) ?? "";
    const s3Motifs: MotifSpec[] = parseMotifsFromS3(s3Text);
    const titleStage: StageSpec<
      { card: Record<string, unknown>; titleMax: number; motifs: MotifSpec[] },
      TitleMatrixOutput
    > = {
      id: "title",
      title: "标题矩阵与母体校验",
      role: "writer",
      method: { stage: "toutiao.article.title" },
      input: () => ({ card, titleMax: limits.title_max, motifs: s3Motifs }),
      shape: `输出 JSON：{ "main": { "text": "...", "motif": "..." }, "alternatives": [{ "text": "...", "motif": "..." }] }，至少 5 个标题且覆盖 ≥3 个母体，单标题 ≤${limits.title_max} 字。`,
      format: "json",
      parse: (raw) => extractJsonBlock<TitleMatrixOutput>(raw),
      accept(out) {
        const all = [out.main, ...(out.alternatives ?? [])];
        const validated = validateTitleMatrix(all, limits.title_max);
        if (s3Motifs.length > 0) {
          const validMotifNames = new Set(s3Motifs.map((m) => m.name));
          const unknown = validated.valid.filter((item) => !validMotifNames.has(item.motif));
          if (unknown.length > 0) {
            return {
              value: { main: validated.valid[0], alternatives: validated.valid.slice(1) },
              notes: [
                `存在未在 s3-headline 列表中的母体名：${unknown.map((u) => u.motif).join("、")}`,
              ],
            };
          }
        }
        return {
          value: { main: validated.valid[0], alternatives: validated.valid.slice(1) },
          notes: validated.dropped,
        };
      },
      retries: 1,
    };
    const titleMatrix = await runner.stage(
      titleStage,
      makePacket(s3Text ? [refBlock("s3-headline", "s3-headline.md", s3Text)] : []),
    );

    const s4CommonText = (await readTextIfExists(path.join(profileDir, "s4-common.md"))) ?? "";
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
    const blueprintStage: StageSpec<
      {
        card: Record<string, unknown>;
        title: TitleCandidate;
        recommendedOpening: string;
        recommendedEnding: string;
        recentOpenings: string[];
        recentEndings: string[];
      },
      BlueprintOutput
    > = {
      id: "blueprint",
      title: "结构蓝图（开头/结尾轮换）",
      role: "planner",
      method: { stage: "toutiao.article.blueprint" },
      input: () => ({
        card,
        title: titleMatrix.main,
        recommendedOpening: rotated.openingStyle,
        recommendedEnding: rotated.endingStyle,
        recentOpenings: req.recentOpenings ?? [],
        recentEndings: req.recentEndings ?? [],
      }),
      shape:
        '输出 JSON：{ "openingStyle": "...", "endingStyle": "...", "sections": [{ "heading": "...", "question": "...", "action": "..." }], "extensionStart": "..." }。须避开最近用过的开头/结尾式实现轮换。',
      format: "json",
      parse: (raw) => extractJsonBlock<BlueprintOutput>(raw),
      retries: 1,
    };
    const blueprint = await runner.stage(
      blueprintStage,
      makePacket(s4CommonText ? [refBlock("s4-common", "s4-common.md", s4CommonText)] : []),
    );

    const draftStage: StageSpec<
      {
        card: Record<string, unknown>;
        title: TitleCandidate;
        blueprint: BlueprintOutput;
        source: string;
      },
      string
    > = {
      id: "draft",
      title: "多路起稿",
      role: "writer",
      method: { stage: "toutiao.article.draft" },
      input: () => ({
        card,
        title: titleMatrix.main,
        blueprint,
        source: sourceData.combinedText,
      }),
      shape: `输出完整 Markdown 正文，首行以 "# ${titleMatrix.main.text}" 开头，小标题使用 "## "。`,
      format: "text",
      parse: (raw) => {
        const text = raw.trim();
        if (!text) throw new AppError("model.output_invalid", "起稿输出为空");
        return text;
      },
      fanOut: { count: (c) => (c.request as ArticleReq).draftCount ?? 2 },
    };
    const draftCandidates = await runner.fanOut(
      draftStage,
      makePacket(s4CommonText ? [refBlock("s4-common", "s4-common.md", s4CommonText)] : []),
    );
    const initialDraft = draftCandidates[0];
    const initialClaims = await runner.local("claims", async () =>
      extractClaimCandidates(initialDraft),
    );

    const runFactsStage = async (
      stepId: string,
      claimsToVerify: typeof initialClaims,
    ): Promise<typeof initialClaims> => {
      if (claimsToVerify.length === 0) return [];
      const stageSpec: StageSpec<
        { claims: typeof initialClaims; source: string },
        FactCheckOutput
      > = {
        id: stepId,
        title: "逐条事实证据核验",
        role: "extractor",
        input: () => ({ claims: claimsToVerify, source: sourceData.combinedText }),
        shape:
          '输出 JSON：{ "claims": [{ "id": "...", "status": "supported"|"unsupported"|"unlocated", "sourceId": "...", "evidence": "..." }] }。找不到出处标为 unlocated，不要编造出处。',
        format: "json",
        parse: (raw) => extractJsonBlock<FactCheckOutput>(raw),
      };
      const out = await runner.stage(stageSpec, makePacket([]));
      return mergeFactResults(claimsToVerify, out).merged;
    };

    let verifiedClaims = await runFactsStage("facts", initialClaims);
    const s5Text = (await readTextIfExists(path.join(profileDir, "s5-editing.md"))) ?? "";
    const reviewStage: StageSpec<
      { draft: string; card: Record<string, unknown>; claims: typeof initialClaims },
      ReviewOutput
    > = {
      id: "review",
      title: "编辑审读",
      role: "editor",
      method: { stage: "toutiao.article.review" },
      input: () => ({ draft: initialDraft, card, claims: verifiedClaims }),
      shape:
        '输出 JSON：{ "issues": [{ "kind": "skeleton"|"ai-taste"|"fact"|"pacing", "quote": "...", "issue": "...", "fix": "..." }], "summary": "..." }。',
      format: "json",
      parse: (raw) => extractJsonBlock<ReviewOutput>(raw),
    };
    const review = await runner.stage(
      reviewStage,
      makePacket(s5Text ? [refBlock("s5-editing", "s5-editing.md", s5Text)] : []),
    );

    const reviseStage: StageSpec<
      { draft: string; review: ReviewOutput; claims: typeof initialClaims; guide: string },
      string
    > = {
      id: "revise",
      title: "按 s5-editing 红笔修订",
      role: "editor",
      method: { stage: "toutiao.article.revise" },
      input: () => ({
        draft: initialDraft,
        review,
        claims: verifiedClaims,
        guide: "严格按 s5-editing.md 骨架、病型库与人味标准修订",
      }),
      shape: "输出修订后的完整 Markdown 正文。",
      format: "text",
      parse: (raw) => {
        const text = raw.trim();
        if (!text) throw new AppError("model.output_invalid", "s5-editing 修订输出为空");
        return text;
      },
    };
    const revisedDraft = await runner.stage(
      reviseStage,
      makePacket(s5Text ? [refBlock("s5-editing", "s5-editing.md", s5Text)] : []),
    );

    const runQaOnText = async (stepId: string, text: string): Promise<QaCheckResult> => {
      return runner.local(stepId, async () => {
        const qaFile = path.join(articleDir, "drafts", `${ctx.runId}.${stepId}.md`);
        await atomicWrite(qaFile, text);
        return bridge.qa({
          file: qaFile,
          card: cardPath,
          ledger: req.ledgerPath,
          mode: limits.genres.includes(req.genre) ? undefined : "long",
          articleId: req.articleId,
        });
      });
    };
    const verifyRevision = async (text: string, stepId: string) => {
      const incremental = await runner.local(`${stepId}-claims`, async () =>
        filterChangedParagraphClaims(text, verifiedClaims),
      );
      const checked = await runFactsStage(`${stepId}-facts`, incremental.toVerify);
      verifiedClaims = [...incremental.reused, ...checked];
    };
    await verifyRevision(revisedDraft, "revise");

    const passScore = limits.pass_score;
    const s6Text = (await readTextIfExists(path.join(profileDir, "s6-qa.md"))) ?? "";
    const qaRevision = await runQaRevisionLoop({
      runner,
      draft: revisedDraft,
      qa: await runQaOnText("qa", revisedDraft),
      passScore,
      s6Text,
      runQa: runQaOnText,
      verifyRevision,
    });
    const antigaming = await runner.local("antigaming", async () =>
      evaluateAntiGaming(revisedDraft, qaRevision.draft),
    );
    const { status, qaGate } = resolveQaOutcome(qaRevision.qa, passScore);
    ctx.state.finalStatus = status;
    return {
      articleId: req.articleId,
      title: titleMatrix.main.text,
      draft: qaRevision.draft,
      qa: qaRevision.qa,
      claims: verifiedClaims,
      antigaming,
      status,
      qaGate,
    };
  },
  deliver: deliverArticle,
  recover: recoverArticle,
};
