import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readJson, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { arr, int, lit, obj, opt, str } from "@zhizhang/core/schema";
import { extractClaimCandidates } from "../../domain/claims.js";
import { parseMotifsFromS3 } from "../../domain/motifs.js";
import { createRulesBridge } from "../../rules/bridge.js";
import { ArticleMetaSchema, registerSource, transitionArticleStatus, } from "../../storage/articles.js";
export const ArticlePipelineReq = obj({
    articleId: str({ min: 1 }),
    genre: str({ min: 1 }),
    driver: str({ min: 1 }),
    line: opt(str()),
    note: opt(str()),
    sourceText: opt(str()),
    sourceKind: opt(lit("paste", "file", "classic")),
    draftCount: opt(int({ min: 1, max: 5 })),
    scriptsDir: opt(str()),
    profileDir: opt(str()),
    ledgerPath: opt(str()),
    recentOpenings: opt(arr(str())),
    recentEndings: opt(arr(str())),
});
const ORAL_MARKER_WORDS = [
    "说白了",
    "讲真",
    "这事儿",
    "怎么说呢",
    "你别不信",
    "我琢磨",
    "反正",
    "话说回来",
    "得承认",
    "说实话",
    "其实",
    "大概",
    "可能",
    "我也没",
    "不敢瞎说",
    "——",
    "……",
];
const SENTENCE_PARTICLE_RE = /[吧呢啊呗嘛哦呀哈嘿嗯](?=[，。！？…””’\s,.!?]|$)/g;
const DEFAULT_SCRIPTS_DIR = path.resolve(import.meta.dirname, "../../../skill/scripts");
const DEFAULT_PROFILE_DIR = path.resolve(import.meta.dirname, "../../../profiles/default");
function resolveScriptsDir(req) {
    return req.scriptsDir || process.env.ZHIZHANG_TOUTIAO_SCRIPTS_DIR || DEFAULT_SCRIPTS_DIR;
}
function resolveProfileDir(req) {
    return req.profileDir || process.env.WRITER_TOUTIAO_DEFAULT_DIR || DEFAULT_PROFILE_DIR;
}
function extractJsonBlock(raw) {
    const trimmed = raw.trim();
    const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
    const candidate = fenced ? fenced[1].trim() : trimmed;
    try {
        return JSON.parse(candidate);
    }
    catch (err) {
        throw new AppError("model.output_invalid", "模型输出不是合法 JSON", {
            cause: err instanceof Error ? err.message : String(err),
        });
    }
}
function makePacket(blocks, userBlocks = []) {
    return {
        prefix: blocks,
        suffix: userBlocks,
        omitted: [],
        estimate: blocks.reduce((acc, b) => acc + b.tokens, 0),
    };
}
function refBlock(id, ref, text) {
    return {
        id,
        layer: 2,
        text,
        required: true,
        tokens: Math.ceil(text.length / 2),
        reason: `stage reference: ${ref}`,
        source: { kind: "reference", ref },
    };
}
export function validateTitleMatrix(candidates, titleMax) {
    const valid = [];
    const dropped = [];
    for (const item of candidates) {
        if (item.text.length <= titleMax) {
            valid.push(item);
        }
        else {
            dropped.push(`${item.text}（超出 ${titleMax} 字）`);
        }
    }
    const motifs = new Set(valid.map((v) => v.motif));
    if (valid.length < 5 || motifs.size < 3) {
        throw new AppError("model.output_invalid", "标题矩阵需 ≥5 个合规标题且覆盖 ≥3 个母体", {
            validCount: valid.length,
            motifCount: motifs.size,
        });
    }
    return { valid, dropped };
}
export function filterChangedParagraphClaims(nextDraft, prevClaims) {
    const fresh = extractClaimCandidates(nextDraft);
    const prevByPara = new Map();
    for (const c of prevClaims) {
        const list = prevByPara.get(c.paragraphHash) ?? [];
        list.push(c);
        prevByPara.set(c.paragraphHash, list);
    }
    const reused = [];
    const toVerify = [];
    for (const c of fresh) {
        const matched = prevByPara
            .get(c.paragraphHash)
            ?.find((p) => p.text === c.text && p.status === "supported");
        if (matched)
            reused.push(matched);
        else
            toVerify.push(c);
    }
    return { reused, toVerify };
}
export function countOralMarkersAndHeadings(text) {
    let oralMarkers = 0;
    for (const marker of ORAL_MARKER_WORDS) {
        let idx = 0;
        while ((idx = text.indexOf(marker, idx)) !== -1) {
            oralMarkers++;
            idx += marker.length;
        }
    }
    const particles = text.match(SENTENCE_PARTICLE_RE);
    if (particles)
        oralMarkers += particles.length;
    const headings = text
        .split(/\r?\n/)
        .filter((line) => /^##\s+/.test(line.trim())).length;
    return { oralMarkers, headings };
}
export function evaluateAntiGaming(beforeText, afterText) {
    const before = countOralMarkersAndHeadings(beforeText);
    const after = countOralMarkersAndHeadings(afterText);
    const oralDelta = after.oralMarkers - before.oralMarkers;
    const headingDelta = after.headings - before.headings;
    const warnings = [];
    if (oralDelta > 0) {
        warnings.push(`口语标记在质检改稿后增加 ${oralDelta} 处，请核对是否靠堆口语词凑分`);
    }
    if (headingDelta > 0) {
        warnings.push(`小标题数量在质检改稿后增加 ${headingDelta} 处，请核对是否靠拆小标题凑结构分`);
    }
    return { before, after, oralDelta, headingDelta, warnings };
}
export function pickRotatedStyles(recentOpenings = [], recentEndings = [], availableOpenings = [], availableEndings = []) {
    const lastOpening = recentOpenings.at(-1);
    const lastEnding = recentEndings.at(-1);
    const openingStyle = availableOpenings.find((s) => s !== lastOpening) ?? availableOpenings[0] ?? "";
    const endingStyle = availableEndings.find((s) => s !== lastEnding) ?? availableEndings[0] ?? "";
    return { openingStyle, endingStyle };
}
function mergeFactResults(candidates, factOut) {
    const byId = new Map(factOut.claims.map((c) => [c.id, c]));
    let unlocatedCount = 0;
    let unsupportedCount = 0;
    const merged = candidates.map((cand) => {
        const hit = byId.get(cand.id);
        if (!hit) {
            unlocatedCount++;
            return { ...cand, status: "unlocated" };
        }
        if (hit.status === "unlocated")
            unlocatedCount++;
        if (hit.status === "unsupported")
            unsupportedCount++;
        return {
            ...cand,
            status: hit.status,
            sourceId: hit.sourceId,
            evidence: hit.evidence,
        };
    });
    const notes = [];
    if (unlocatedCount > 0) {
        notes.push(`存在 ${unlocatedCount} 条 unlocated 事实待人工核对（不阻断流水线）`);
    }
    if (unsupportedCount > 0) {
        notes.push(`存在 ${unsupportedCount} 条 unsupported 事实需在改稿阶段核实或删改`);
    }
    return { merged, notes };
}
export const articlePipeline = {
    kind: "toutiao.article",
    request: ArticlePipelineReq,
    async context(target, req) {
        return { runId: `tt-${Date.now()}`, target, request: req, state: {} };
    },
    async run(runner, ctx) {
        const req = ctx.request;
        const articleDir = ctx.target.path;
        const scriptsDir = resolveScriptsDir(req);
        const profileDir = resolveProfileDir(req);
        const bridge = createRulesBridge(scriptsDir);
        const lock = createLockService();
        // 1. source: 登记/读取素材来源
        const sourceData = await runner.local("source", async () => {
            const sourcesDir = path.join(articleDir, "sources");
            await fs.mkdir(sourcesDir, { recursive: true });
            if (req.sourceText?.trim()) {
                await registerSource(articleDir, "source-1", req.sourceKind ?? "paste", req.sourceText, systemClock.iso(), lock);
            }
            const entries = await fs.readdir(sourcesDir).catch(() => []);
            const txtFiles = entries.filter((name) => name.endsWith(".txt")).sort();
            const contents = await Promise.all(txtFiles.map(async (file) => ({
                id: file.replace(/\.txt$/, ""),
                text: (await readTextIfExists(path.join(sourcesDir, file))) ?? "",
            })));
            return {
                sources: contents,
                combinedText: contents.map((c) => `[${c.id}]\n${c.text}`).join("\n\n"),
            };
        });
        const limits = await runner.local("rules-limits", () => bridge.limits());
        // 2. card: 立项卡生成 + rules/bridge 预检
        const s2Text = (await readTextIfExists(path.join(profileDir, "s2-selection.md"))) ?? "";
        const cardPath = path.join(articleDir, "card.json");
        const cardStage = {
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
            shape: "输出合法 JSON 立项卡对象，须包含 主问题、核心事实、读者、体裁、内容线、主驱动；若体裁为长图文须包含 延伸（含 起始小标题、接的问题、接法）。",
            format: "json",
            parse: (raw) => extractJsonBlock(raw),
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
                    throw new AppError("model.output_invalid", `立项卡预检未通过：${check.errors.join("；")}`, {
                        errors: check.errors,
                    });
                }
                return enriched;
            },
            retries: 1,
        };
        const card = await runner.stage(cardStage, makePacket(s2Text ? [refBlock("s2-selection", "s2-selection.md", s2Text)] : []));
        // 3. title: parseMotifsFromS3 + validateTitleMatrix
        const s3Text = (await readTextIfExists(path.join(profileDir, "s3-headline.md"))) ?? "";
        const s3Motifs = parseMotifsFromS3(s3Text);
        const titleStage = {
            id: "title",
            title: "标题矩阵与母体校验",
            role: "writer",
            method: { stage: "toutiao.article.title" },
            input: () => ({ card, titleMax: limits.title_max, motifs: s3Motifs }),
            shape: `输出 JSON：{ "main": { "text": "...", "motif": "..." }, "alternatives": [{ "text": "...", "motif": "..." }] }，至少 5 个标题且覆盖 ≥3 个母体，单标题 ≤${limits.title_max} 字。`,
            format: "json",
            parse: (raw) => extractJsonBlock(raw),
            accept(out) {
                const all = [out.main, ...(out.alternatives ?? [])];
                const validated = validateTitleMatrix(all, limits.title_max);
                if (s3Motifs.length > 0) {
                    const validMotifNames = new Set(s3Motifs.map((m) => m.name));
                    const unknown = validated.valid.filter((item) => !validMotifNames.has(item.motif));
                    if (unknown.length > 0) {
                        return {
                            value: { main: validated.valid[0], alternatives: validated.valid.slice(1) },
                            notes: [`存在未在 s3-headline 列表中的母体名：${unknown.map((u) => u.motif).join("、")}`],
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
        const titleMatrix = await runner.stage(titleStage, makePacket(s3Text ? [refBlock("s3-headline", "s3-headline.md", s3Text)] : []));
        // 4. blueprint: 开头/结尾轮换（从 rules/bridge 读取清单）
        const s4CommonText = (await readTextIfExists(path.join(profileDir, "s4-common.md"))) ?? "";
        const stylesCatalog = await runner.local("rules-styles", () => bridge.styles());
        const activeLine = req.line ?? (req.driver === "故事型" ? "故事线" : "资讯线");
        const lineStyles = stylesCatalog.byLine[activeLine];
        const openingPool = lineStyles?.openings.length ? lineStyles.openings : stylesCatalog.allOpenings;
        const endingPool = lineStyles?.endings.length ? lineStyles.endings : stylesCatalog.allEndings;
        const rotated = pickRotatedStyles(req.recentOpenings, req.recentEndings, openingPool, endingPool);
        const blueprintStage = {
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
            shape: '输出 JSON：{ "openingStyle": "...", "endingStyle": "...", "sections": [{ "heading": "...", "question": "...", "action": "..." }], "extensionStart": "..." }。须避开最近用过的开头/结尾式实现轮换。',
            format: "json",
            parse: (raw) => extractJsonBlock(raw),
            retries: 1,
        };
        const blueprint = await runner.stage(blueprintStage, makePacket(s4CommonText ? [refBlock("s4-common", "s4-common.md", s4CommonText)] : []));
        // 5. draft×N
        const draftStage = {
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
                if (!text) {
                    throw new AppError("model.output_invalid", "起稿输出为空");
                }
                return text;
            },
            fanOut: {
                count: (c) => c.request.draftCount ?? 2,
            },
        };
        const draftCandidates = await runner.fanOut(draftStage, makePacket(s4CommonText ? [refBlock("s4-common", "s4-common.md", s4CommonText)] : []));
        const initialDraft = draftCandidates[0];
        // 6. claims: extractClaimCandidates
        const claimCandidates = await runner.local("claims", async () => extractClaimCandidates(initialDraft));
        // 7. facts: 逐条证据核验，unlocated 不整步失败
        const runFactsStage = async (stepId, claimsToVerify) => {
            if (claimsToVerify.length === 0)
                return [];
            const stageSpec = {
                id: stepId,
                title: "逐条事实证据核验",
                role: "extractor",
                input: () => ({
                    claims: claimsToVerify,
                    source: sourceData.combinedText,
                }),
                shape: '输出 JSON：{ "claims": [{ "id": "...", "status": "supported"|"unsupported"|"unlocated", "sourceId": "...", "evidence": "..." }] }。找不到出处标为 unlocated，不要编造出处。',
                format: "json",
                parse: (raw) => extractJsonBlock(raw),
            };
            const out = await runner.stage(stageSpec, makePacket([]));
            const { merged } = mergeFactResults(claimsToVerify, out);
            return merged;
        };
        let verifiedClaims = await runFactsStage("facts", claimCandidates);
        // 8. review: 编辑审读
        const s5Text = (await readTextIfExists(path.join(profileDir, "s5-editing.md"))) ?? "";
        const reviewStage = {
            id: "review",
            title: "编辑审读",
            role: "editor",
            method: { stage: "toutiao.article.review" },
            input: () => ({
                draft: initialDraft,
                card,
                claims: verifiedClaims,
            }),
            shape: '输出 JSON：{ "issues": [{ "kind": "skeleton"|"ai-taste"|"fact"|"pacing", "quote": "...", "issue": "...", "fix": "..." }], "summary": "..." }。',
            format: "json",
            parse: (raw) => extractJsonBlock(raw),
        };
        const review = await runner.stage(reviewStage, makePacket(s5Text ? [refBlock("s5-editing", "s5-editing.md", s5Text)] : []));
        // 9. revise: 明确使用 s5-editing
        const reviseStage = {
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
                if (!text) {
                    throw new AppError("model.output_invalid", "s5-editing 修订输出为空");
                }
                return text;
            },
        };
        const revisedDraft = await runner.stage(reviseStage, makePacket(s5Text ? [refBlock("s5-editing", "s5-editing.md", s5Text)] : []));
        // 10. qa: Python qa_check ≥ pass_score (84)
        const runQaOnText = async (stepId, text) => {
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
        let currentDraft = revisedDraft;
        let qaResult = await runQaOnText("qa", currentDraft);
        const passScore = limits.pass_score;
        // 11. qa-revise×≤2: filterChangedParagraphClaims 增量复核
        const s6Text = (await readTextIfExists(path.join(profileDir, "s6-qa.md"))) ?? "";
        for (let round = 1; round <= 2; round++) {
            const passed = qaResult.overall >= passScore && qaResult.passed;
            if (passed)
                break;
            const qaReviseStage = {
                id: `qa-revise-${round}`,
                title: `质检回改第 ${round} 轮`,
                role: "editor",
                method: { stage: "toutiao.article.qa" },
                input: () => ({
                    draft: currentDraft,
                    qa: qaResult,
                    round,
                }),
                shape: "仅针对 fails 与 hard_gates 指出的位置修改，不靠堆砌口语词或拆小标题凑分，输出完整 Markdown 正文。",
                format: "text",
                parse: (raw) => {
                    const text = raw.trim();
                    if (!text) {
                        throw new AppError("model.output_invalid", `qa-revise 第 ${round} 轮输出为空`);
                    }
                    return text;
                },
            };
            currentDraft = await runner.stage(qaReviseStage, makePacket(s6Text ? [refBlock("s6-qa", "s6-qa.md", s6Text)] : []));
            const incremental = await runner.local(`qa-revise-claims-${round}`, async () => filterChangedParagraphClaims(currentDraft, verifiedClaims));
            if (incremental.toVerify.length > 0) {
                const newlyVerified = await runFactsStage(`facts-inc-${round}`, incremental.toVerify);
                verifiedClaims = [...incremental.reused, ...newlyVerified];
            }
            else {
                verifiedClaims = incremental.reused;
            }
            qaResult = await runQaOnText(`qa-recheck-${round}`, currentDraft);
        }
        // 12. antigaming: 统计口语标记/小标题增量提示
        const antigaming = await runner.local("antigaming", async () => evaluateAntiGaming(revisedDraft, currentDraft));
        ctx.state.finalStatus = "待验收";
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
    async deliver(res, ctx) {
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
            await transitionArticleStatus(ctx.target.path, "待验收", systemClock.iso(), createLockService());
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
};
