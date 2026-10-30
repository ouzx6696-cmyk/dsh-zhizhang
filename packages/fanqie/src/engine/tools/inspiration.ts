/** Inspiration pillar — session / forge / stage / accept (optional apply to work). */
import { InspirationPort } from "../ports/index.js";
import { inspectPendingInspiration, resumePendingInspiration } from "../storage/inspiration-journal.js";
import { ensureStorage, readWorkMeta, resolveWorkDir } from "../store.js";
import { formatPlanningStatus } from "../domain/planning.js";
import { asString, asStringArray, boolArg, config, fail, rememberWork } from "./context.js";
import { B, E, S, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
import type { ExecContext } from "./types.js";
async function openInsp(exec: ExecContext, args: any) {
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    return paths;
}
export function inspirationTools() {
    return [
        defineTool({
            name: "fanqie_inspire_start",
            description: "【闭环·灵感】开启会话：根据作者目标规划，可选已采纳参考卡。无卡时直接规划；参考按本次问题选用，不要求凑齐 mind。不写根基。",
            properties: {
                work: S("可选绑定现有作品；作品依据变化后应用须重新核对"),
                goal: S("灵感目标（新作方向）"),
                genre: S("可选题材"),
                pace: E(["快爽", "稳推", "慢燃"], "可选：本书节奏档位；未指定时结合作者目标选择"),
                card_ids: {
                    type: "array",
                    description: "可选已采纳参考卡；按当前问题选用，不要求凑齐 mind；无卡可直接规划",
                    items: { type: "string" },
                },
                reference_ids: { type: "array", items: { type: "string" }, description: "可选显式选用的工作区 ref-* 分析成果" },
                craft_only: B("仅技法试写：可选声明偏技法用途，不构成数量门禁"),
                working_dir: WORKING_DIR,
            },
            required: ["goal"],
            async execute(args: any, exec: ExecContext) {
                const goal = asString(args, "goal", { required: true });
                const cardIds = asStringArray(args, "card_ids") ?? [];
                const craftOnly = boolArg(args, "craft_only") ?? false;
                const paths = await openInsp(exec, args);
                const { sessionId, mindCount, craftCount } = await InspirationPort.startSession(paths, {
                    goal,
                    workKey: asString(args, "work"),
                    genre: asString(args, "genre"),
                    pace: asString(args, "pace"),
                    cardIds,
                    referenceIds: asStringArray(args, "reference_ids") ?? [],
                    craftOnly,
                });
                return [
                    `灵感会话已开：${sessionId}`,
                    `- goal：${goal}`,
                    `- cards：${cardIds.length ? [...new Set(cardIds)].join("、") : "无参考卡；规划以作者目标为依据"}`,
                    `- 节奏：${asString(args, "pace") || "未指定"}`,
                    `- 分轴：mind ${mindCount} · craft ${craftCount}` + (craftOnly ? " · craft_only" : ""),
                    "",
                    "下一步（闭环）：fanqie_inspire_forge_brief → inspire_stage → inspire_accept(apply=true) → chapter_brief",
                ].join("\n");
            },
        }),
        defineTool({
            name: "fanqie_inspire_forge_brief",
            description: "【闭环·灵感】推演简报：mind 主粮 + craft 辅 + develop/plan。不代写。下一步：inspire_stage → inspire_accept。",
            properties: {
                session: S("sessionId"),
                working_dir: WORKING_DIR,
            },
            required: ["session"],
            async execute(args: any, exec: ExecContext) {
                const sessionId = asString(args, "session", { required: true });
                const paths = await openInsp(exec, args);
                return InspirationPort.forgeBrief(paths, sessionId);
            },
        }),
        defineTool({
            name: "fanqie_inspire_stage",
            description: "【闭环·灵感】暂存根基、章纲、全书、卷或幕规划候选；显式采纳后才写作品。",
            properties: {
                session: S("sessionId"),
                kind: E(["foundation", "outline", "book_plan", "volume_plan", "act_plan"], "候选类型：根基 / 章纲 / 全书 / 卷 / 幕规划"),
                payload: {
                    type: "object",
                    description: "foundation：locks/characters/planned/style/…；outline：chapter/title/ending/…；book_plan：content；volume_plan：id/title/content/chapters；act_plan 同卷规划并可填 volumeId。chapters 是章节 id 数组。",
                    additionalProperties: true,
                },
                working_dir: WORKING_DIR,
            },
            required: ["session", "kind", "payload"],
            async execute(args: any, exec: ExecContext) {
                const sessionId = asString(args, "session", { required: true });
                const kind = asString(args, "kind", { required: true });
                if (!["foundation", "outline", "book_plan", "volume_plan", "act_plan"].includes(kind)) {
                    fail("kind 须为 foundation、outline、book_plan、volume_plan 或 act_plan");
                }
                if (!args.payload || typeof args.payload !== "object" || Array.isArray(args.payload)) {
                    fail("payload 必须是对象");
                }
                const paths = await openInsp(exec, args);
                const { candId, styleReminder } = await InspirationPort.stageEmit(paths, sessionId, {
                    kind: kind,
                    payload: args.payload,
                });
                return [
                    `灵感候选已暂存：${candId}`,
                    `- kind：${kind}`,
                    `- 人味提醒：${styleReminder}`,
                    `- 尚未写入作品`,
                    "",
                    "下一步（闭环）：fanqie_inspire_accept（apply=true 落盘）→ fanqie_chapter_brief",
                ].join("\n");
            },
        }),
        defineTool({
            name: "fanqie_inspire_accept",
            description: "【闭环·灵感】显式采纳；apply=true 写入作品根基、章纲、全书、卷或幕规划。",
            properties: {
                candidate: S("灵感候选 id（icand-…）"),
                work: S("目标作品 key 或标题"),
                apply: B("是否写入作品（默认 false）"),
                title: S("若需新建作品：标题（默认用 work）"),
                genre: S("若需新建作品：题材"),
                premise: S("若需新建作品：前提"),
                working_dir: WORKING_DIR,
            },
            required: ["candidate", "work"],
            async execute(args: any, exec: ExecContext) {
                const candId = asString(args, "candidate", { required: true });
                const workKey = asString(args, "work", { required: true });
                const apply = boolArg(args, "apply") ?? false;
                const paths = await openInsp(exec, args);
                const result = await InspirationPort.acceptEmit(paths, candId, {
                    workKey,
                    apply,
                    title: asString(args, "title"),
                    genre: asString(args, "genre"),
                    premise: asString(args, "premise"),
                });
                if (result.applied)
                    rememberWork(exec, result.workKey);
                return [
                    `灵感候选 ${result.candId} 已采纳`,
                    `- apply：${result.applied}`,
                    `- work：${result.workKey}`,
                    `- ${result.detail}`,
                    ...(result.bindingWarning ? [`- 提醒：${result.bindingWarning}`] : []),
                    "",
                    result.applied
                        ? "下一步（闭环）：fanqie_chapter_brief(lean) → candidate_stage → candidate_accept（内置扫描）"
                        : "提示：尚未写入作品；需要落盘时再 inspire_accept(apply=true)",
                ].join("\n");
            },
        }),
        defineTool({
            name: "fanqie_inspire_status",
            description: "【闭环·灵感】列会话或看详情。迷路时对照 fanqie_product_map。",
            properties: {
                session: S("可选 sessionId；省略则列全部"),
                work: S("可选作品 key 或标题；查看完整全书和卷规划"),
                history: B("与 work 一起使用，查看已应用的候选历史"),
                candidate: S("可选灵感候选 id；查看该候选的完整内容和状态"),
                recovery: E(["inspect", "resume"], "灵感应用中断时检查或恢复原操作"),
                working_dir: WORKING_DIR,
            },
            required: [],
            async execute(args: any, exec: ExecContext) {
                const paths = await openInsp(exec, args);
                const recovery = asString(args, "recovery");
                if (recovery === "inspect") {
                    const r = await inspectPendingInspiration(paths);
                    return [`灵感应用恢复记录：${r.id}`, `- 作品 ${r.workKey} · 候选 ${r.candidateId} · ${r.createdAt}`,
                        ...r.writes.map(w => `- ${w.target}/${w.file}：${w.state}`),
                        r.conflict ? "发现冲突；请保留文件并人工核对。" : "无文件冲突；确认原进程停止或原操作结束后可用 recovery=resume。"].join("\n");
                }
                if (recovery === "resume") {
                    const r = await resumePendingInspiration(paths);
                    return `已恢复灵感应用：候选 ${r.candidateId} → 作品 ${r.workKey}；请勿重复应用。`;
                }
                if (recovery) fail("recovery 只支持 inspect 或 resume");
                const candidateId = asString(args, "candidate");
                if (candidateId) {
                    const candidate = await InspirationPort.getCandidate(paths, candidateId);
                    return [
                        `# 灵感候选 ${candidate.id}`,
                        `- 类型：${candidate.kind} · 状态：${candidate.status} · 应用作品：${candidate.appliedWorkKey || "未应用"}`,
                        `- 作者目标：${candidate.sourceGoal || "未记录"} · 选择的参考卡：${Array.isArray(candidate.cardIds) && candidate.cardIds.length ? candidate.cardIds.join("、") : "无或未记录"}`,
                        "- 来源记录不证明实际阅读或具体影响。", "", "## 候选内容", JSON.stringify(candidate.payload, null, 2),
                    ].join("\n");
                }
                const work = asString(args, "work");
                if (work) {
                    const meta = await readWorkMeta(await resolveWorkDir(paths, work));
                    if (boolArg(args, "history") === true) {
                        const history = await InspirationPort.listWorkHistory(paths, meta.key);
                        return [`# 已应用的灵感候选 · ${meta.title}`, `共 ${history.total} 条；最多显示最近 50 条。`,
                            ...history.rows.map((row: any) => `- ${row.at} · ${row.kind} · ${row.title || "未命名"} · ${row.id}`),
                            "用 fanqie_inspire_status(candidate=…) 查看候选内容；修改或恢复旧方案时需重新暂存并显式采纳。"].join("\n");
                    }
                    return formatPlanningStatus(meta);
                }
                const sessionId = asString(args, "session");
                if (sessionId) {
                    const s = await InspirationPort.getSession(paths, sessionId);
                    return [
                        `# 灵感会话 ${s.id}`,
                        `- goal：${s.goal}`,
                        `- genre：${s.genre || "（空）"}`,
                        `- cards：${s.cardIds.join("、")}`,
                        `- forgeAt：${s.forgeAt || "（尚未 forge）"}`,
                        `- updatedAt：${s.updatedAt}`,
                    ].join("\n");
                }
                const rows = await InspirationPort.listSessions(paths);
                if (rows.length === 0)
                    return "尚无灵感会话。用 fanqie_inspire_start 开启。";
                return [
                    "灵感会话（最近更新在前）：",
                    ...rows.map((r: any, i: number) => `${i + 1}. ${r.id} · ${r.goal.slice(0, 40)}${r.goal.length > 40 ? "…" : ""} · cards=${r.cardIds.length} · forge=${r.forgeAt ? "是" : "否"}`),
                ].join("\n");
            },
        }),
    ];
}
