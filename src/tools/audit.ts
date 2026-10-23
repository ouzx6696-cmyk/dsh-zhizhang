/** Writing pillar — style lint, review ledger, payoff audit. */
import { appendLedger, readCandidate, readChapter, readLedger, readWorkMeta, storePayoffAudit, } from "../lib/store.js";
import { resolvePrevChapter } from "../lib/services/chapter-context.js";
import { LintGate, PayoffAuditorPort, StyleLinterPort, HumanFeelAuditorPort, NovelSenseAuditorPort, InspirationPort, Scheduler, } from "../lib/ports/index.js";
import { REVIEW_EVIDENCE_KINDS } from "../lib/types.js";
import { asString, fail, openWork } from "./context.js";
import { formatLint } from "./render.js";
import { B, E, S, WORK_OPT, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import type { ExecContext } from "./types.js";
export function auditTools() {
    return [
        defineTool({
            name: "zhizhang_style_lint",
            description: "【默认链·工程闸】语感雷达：传 candidate 时扫正文并签发 lintPassToken（accept 必经；已扫过≠质量过关）。下一步可直接 accept，或可选 edit_brief→edit_stage 后再由用户选 A/B/C。扫 chapter/text 仅诊断。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                candidate: S("可选：候选 id；扫描其正文并签发 lintPassToken（仅证明已扫过）"),
                chapter: S("可选：章节 id，读盘扫描（诊断；不过 accept 闸）"),
                text: S("可选：直接扫描这段文本（诊断；不过 accept 闸，除非同时传 candidate）"),
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const candidateId = asString(args, "candidate");
                if (candidateId) {
                    const { dir } = await openWork(exec, args);
                    const cand = await readCandidate(dir, candidateId);
                    const hits = StyleLinterPort.lint(cand.body);
                    const summary = StyleLinterPort.summarize(hits);
                    const pass = await LintGate.issueToken(dir, candidateId, hits.length);
                    return [
                        formatLint(`候选 ${candidateId} → ${cand.chapterId}`, hits, summary),
                        "",
                        `lintPassToken：${pass.token}`,
                        `lintHitCount：${pass.hitCount}（命中数；token 只证明已扫过，扫过≠过关）`,
                        `（已写入候选；accept 可不传 token，或显式传此值）`,
                        `下一步：${Scheduler.nextHint("style_lint")}`,
                    ].join("\n");
                }
                let text = asString(args, "text", { trim: false });
                let label = "传入文本";
                if (text === undefined) {
                    const chapterId = asString(args, "chapter");
                    if (!chapterId)
                        fail("请提供 candidate、text 或 chapter");
                    const { dir } = await openWork(exec, args);
                    const ch = await readChapter(dir, chapterId);
                    text = ch.body;
                    label = `${ch.title}（${ch.id}）`;
                    const hits = StyleLinterPort.lint(text);
                    const summary = StyleLinterPort.summarize(hits);
                    await appendLedger(dir, {
                        chapterId,
                        kind: "style_lint",
                        summary: `语感雷达章节 ${chapterId}：${hits.length} 处命中（诊断，不签发 accept token）`,
                        styleHitCount: hits.length,
                    });
                    return [
                        formatLint(label, hits, summary),
                        "",
                        "说明：章节扫描不过 accept 闸。要对候选过闸请传 candidate=cand-…",
                    ].join("\n");
                }
                const hits = StyleLinterPort.lint(text);
                return [
                    formatLint(label, hits, StyleLinterPort.summarize(hits)),
                    "",
                    "说明：纯 text 扫描不过 accept 闸。要对候选过闸请传 candidate=cand-…",
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_review_ledger",
            description: "审校留痕：action=get 列出操作记录；action=append 写入作者四维勾选或 AI 诊断笔记（五类证据范畴仅作分类，本工具不生成正文）；action=evidence_kinds 列出五类范畴名。工程文件仍为 ledger.json。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                action: E(["get", "append", "evidence_kinds"], "操作"),
                chapter: S("append 时必填：章节 id"),
                kind: E(["style_lint", "author_checks", "ai_review_notes", "finalize", "note", "chapter_save_direct", "brief_seen", "payoff_audit"], "条目类型"),
                summary: S("摘要"),
                dim_locks_ledger: B("四维：锁定/伏笔"),
                dim_pov_situation: B("四维：视角处境"),
                dim_style_radar: B("四维：语感雷达已阅"),
                dim_continuity_snap: B("四维：衔接快照已阅"),
                issues_json: S("可选：JSON 数组 [{category,finding,evidence,suggestion}]，category 建议用五类证据名"),
            },
            required: ["action"],
            async execute(args: any, exec: ExecContext) {
                const action = asString(args, "action", { required: true });
                if (action === "evidence_kinds") {
                    return [
                        "审校五类证据范畴（供 Agent 诊断分类，非生成许可）：",
                        ...REVIEW_EVIDENCE_KINDS.map((k: any, i: number) => `${i + 1}. ${k}`),
                    ].join("\n");
                }
                const { dir } = await openWork(exec, args);
                if (action === "get") {
                    const ledger = await readLedger(dir);
                    if (ledger.entries.length === 0)
                        return "审校留痕为空。";
                    return ledger.entries
                        .map((e: any, i: number) => `${i + 1}. [${e.at}] ${e.kind} · ${e.chapterId} · ${e.summary}${e.styleHitCount != null ? ` · lint=${e.styleHitCount}` : ""}`)
                        .join("\n");
                }
                if (action !== "append")
                    fail("action 必须是 get / append / evidence_kinds");
                const chapterId = asString(args, "chapter", { required: true });
                const kind = (asString(args, "kind") ?? "note");
                const summary = asString(args, "summary", { required: true });
                const dims: Record<string, boolean> = {};
                if (typeof args.dim_locks_ledger === "boolean")
                    dims.locks_ledger = args.dim_locks_ledger;
                if (typeof args.dim_pov_situation === "boolean")
                    dims.pov_situation = args.dim_pov_situation;
                if (typeof args.dim_style_radar === "boolean")
                    dims.style_radar = args.dim_style_radar;
                if (typeof args.dim_continuity_snap === "boolean")
                    dims.continuity_snap = args.dim_continuity_snap;
                let issues;
                if (typeof args.issues_json === "string" && args.issues_json.trim()) {
                    try {
                        issues = JSON.parse(args.issues_json);
                    }
                    catch {
                        fail("issues_json 不是合法 JSON");
                    }
                }
                const entry = await appendLedger(dir, { chapterId, kind, summary, dims, issues });
                return `已记入审校留痕 ${entry.id}：${entry.summary}`;
            },
        }),
        defineTool({
            name: "zhizhang_payoff_audit",
            description: "【旁路·诊断】兑付审计：对照章纲 ending 等与正文。Accept 已内嵌软传感；本工具仅诊断旁路。出问题或 require_payoff 时再用。不改写正文。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                chapter: S("章节 id（读 outline；未传 candidate/text 时也读正文）"),
                candidate: S("可选：审计该候选正文（仍用章节 outline）"),
                text: S("可选：直接审计这段文本（仍需 chapter 以取 outline）"),
                persist: B("是否写入 payoff-audits.json + ledger（默认 true）"),
            },
            required: ["chapter"],
            async execute(args: any, exec: ExecContext) {
                const chapterId = asString(args, "chapter", { required: true });
                const { dir } = await openWork(exec, args);
                const meta = await readWorkMeta(dir);
                let chapter: any;
                try {
                    chapter = await readChapter(dir, chapterId);
                }
                catch {
                    fail(`章节不存在：${chapterId}`, "not_found");
                }
                if (!chapter)
                    fail(`章节不存在：${chapterId}`, "not_found");
                const candidateId = asString(args, "candidate");
                let body = asString(args, "text", { trim: false });
                let source = "chapter";
                let sourceId = chapterId;
                let label = `${chapter.title}（${chapterId}）`;
                if (candidateId) {
                    const cand = await readCandidate(dir, candidateId);
                    if (cand.chapterId !== chapterId) {
                        fail(`候选 ${candidateId} 目标章为 ${cand.chapterId}，与 chapter=${chapterId} 不一致`);
                    }
                    body = cand.body;
                    source = "candidate";
                    sourceId = candidateId;
                    label = `候选 ${candidateId} → ${chapterId}`;
                }
                else if (body !== undefined) {
                    source = "text";
                    sourceId = undefined;
                    label = `文本 → ${chapterId}`;
                }
                else {
                    body = chapter.body;
                }
                if (!String(body ?? "").trim())
                    fail("正文为空，无法兑付审计");
                const result = PayoffAuditorPort.audit(chapter.outline, body, {
                    premise: meta.premise,
                    title: chapter.title,
                });
                const persist = args.persist === undefined ? true : Boolean(args.persist);
                if (persist) {
                    const codes = result.findings.filter((f: any) => f.severity !== "info").map((f: any) => f.code);
                    await storePayoffAudit(dir, {
                        chapterId,
                        source,
                        sourceId,
                        ok: result.ok,
                        warningCount: result.warningCount,
                        codes,
                        summary: result.ok
                            ? `兑付 ok · ${label}`
                            : `兑付 warnings=${result.warningCount} · ${codes.join(",") || "?"} · ${label}`,
                    });
                }
                return PayoffAuditorPort.format(label, result);
            },
        }),
        defineTool({
            name: "zhizhang_human_feel_audit",
            description: "【旁路·诊断】人味软雷达（含 craftCue→stiffness_tidy，与 Accept 同口径）。Accept 已内嵌；本工具仅诊断旁路。只诊断，不签发 token；strict_human 为旁路硬拒。不作质量法。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                candidate: S("可选：候选 id，扫其正文"),
                chapter: S("可选：章节 id，读盘扫描"),
                text: S("可选：直接扫描这段文本"),
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const candidateId = asString(args, "candidate");
                let text = asString(args, "text", { trim: false });
                let label = "传入文本";
                let craftCue = "";
                if (candidateId) {
                    const { dir, paths, key } = await openWork(exec, args);
                    const cand = await readCandidate(dir, candidateId);
                    text = cand.body;
                    label = `候选 ${candidateId} → ${cand.chapterId}`;
                    craftCue = await InspirationPort.resolveCraftCue(paths, { workKey: key, limit: 5 });
                }
                else if (text === undefined) {
                    const chapterId = asString(args, "chapter");
                    if (!chapterId)
                        fail("请提供 candidate、text 或 chapter");
                    const { dir, paths, key } = await openWork(exec, args);
                    const ch = await readChapter(dir, chapterId);
                    text = ch.body;
                    label = `${ch.title}（${ch.id}）`;
                    craftCue = await InspirationPort.resolveCraftCue(paths, { workKey: key, limit: 5 });
                }
                else {
                    // pure text: try open work for craftCue when work context present
                    try {
                        const { paths, key } = await openWork(exec, args);
                        craftCue = await InspirationPort.resolveCraftCue(paths, { workKey: key, limit: 5 });
                    }
                    catch {
                        craftCue = "";
                    }
                }
                if (!String(text ?? "").trim())
                    fail("正文为空，无法人味审计");
                const result = HumanFeelAuditorPort.audit(text, { craftCue });
                return HumanFeelAuditorPort.format(label, result);
            },
        }),
        defineTool({
            name: "zhizhang_novel_sense_audit",
            description: "【旁路·诊断】书感软雷达。Accept 已内嵌；本工具仅诊断旁路。只诊断，不签发 token；strict_novel 为旁路硬拒。不作质量法。",
            properties: {
                work: WORK_OPT,
                working_dir: WORKING_DIR,
                candidate: S("可选：候选 id，扫其正文"),
                chapter: S("可选：章节 id，读盘扫描"),
                text: S("可选：直接扫描这段文本"),
                prev_chapter: S("可选：前章 id，用于同构检测；省略时若扫 chapter/candidate 则自动取上一章"),
                prev_text: S("可选：前章正文（与 prev_chapter 二选一）"),
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const candidateId = asString(args, "candidate");
                let text = asString(args, "text", { trim: false });
                let label = "传入文本";
                let dir = null;
                let chapterId = null;
                if (candidateId) {
                    const opened = await openWork(exec, args);
                    dir = opened.dir;
                    const cand = await readCandidate(dir, candidateId);
                    text = cand.body;
                    chapterId = cand.chapterId;
                    label = `候选 ${candidateId} → ${cand.chapterId}`;
                }
                else if (text === undefined) {
                    const chId = asString(args, "chapter");
                    if (!chId)
                        fail("请提供 candidate、text 或 chapter");
                    const opened = await openWork(exec, args);
                    dir = opened.dir;
                    const ch = await readChapter(dir, chId);
                    text = ch.body;
                    chapterId = ch.id;
                    label = `${ch.title}（${ch.id}）`;
                }
                if (!String(text ?? "").trim())
                    fail("正文为空，无法书感审计");
                let prevBody = asString(args, "prev_text", { trim: false }) ?? null;
                const prevChapterId = asString(args, "prev_chapter");
                if (!prevBody && prevChapterId) {
                    if (!dir) {
                        const opened = await openWork(exec, args);
                        dir = opened.dir;
                    }
                    const prev = await readChapter(dir, prevChapterId);
                    prevBody = prev.body || null;
                    label = `${label} · 对照前章 ${prevChapterId}`;
                }
                else if (!prevBody && dir && chapterId) {
                    const prev = await resolvePrevChapter(dir, chapterId);
                    if (prev) {
                        prevBody = prev.body || null;
                        label = `${label} · 对照前章 ${prev.meta.id}`;
                    }
                }
                const result = NovelSenseAuditorPort.audit(text, { prevBody });
                return NovelSenseAuditorPort.format(label, result);
            },
        }),
    ];
}
