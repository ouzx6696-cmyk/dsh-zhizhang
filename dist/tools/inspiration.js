/** Inspiration pillar — session / forge / stage / accept (optional apply to work). */
import { InspirationPort } from "../lib/ports/index.js";
import { ensureStorage } from "../lib/store.js";
import { asString, asStringArray, boolArg, config, fail, rememberWork } from "./context.js";
import { B, S, WORKING_DIR } from "./schema.js";
import { defineTool } from "./types.js";
async function openInsp(exec, args) {
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    return paths;
}
export function inspirationTools() {
    return [
        defineTool({
            name: "zhizhang_inspire_start",
            description: "【闭环·灵感】开启会话：goal + card_ids（建议先 combo_suggest）。须 mind 或 craft_only。不写根基。下一步：inspire_forge_brief。",
            properties: {
                goal: S("灵感目标（新作方向）"),
                genre: S("可选题材"),
                card_ids: {
                    type: "array",
                    description: "已采纳卡 id（须含 mind，除非 craft_only；建议先 library_combo_suggest）",
                    items: { type: "string" },
                },
                craft_only: B("仅技法试写：无 mind 时须 true，会话打标"),
                working_dir: WORKING_DIR,
            },
            required: ["goal", "card_ids"],
            async execute(args, exec) {
                const goal = asString(args, "goal", { required: true });
                const cardIds = asStringArray(args, "card_ids", { required: true });
                if (!cardIds || cardIds.length === 0)
                    fail("card_ids 至少一张");
                const craftOnly = boolArg(args, "craft_only") ?? false;
                const paths = await openInsp(exec, args);
                const { sessionId, mindCount, craftCount } = await InspirationPort.startSession(paths, {
                    goal,
                    genre: asString(args, "genre"),
                    cardIds,
                    craftOnly,
                });
                return [
                    `灵感会话已开：${sessionId}`,
                    `- goal：${goal}`,
                    `- cards：${(cardIds ?? []).join("、")}`,
                    `- 分轴：mind ${mindCount} · craft ${craftCount}` + (craftOnly ? " · craft_only" : ""),
                    "",
                    "下一步（闭环）：zhizhang_inspire_forge_brief → inspire_stage → inspire_accept(apply=true) → chapter_brief",
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_inspire_forge_brief",
            description: "【闭环·灵感】推演简报：mind 主粮 + craft 辅 + develop/plan。不代写。下一步：inspire_stage → inspire_accept。",
            properties: {
                session: S("sessionId"),
                working_dir: WORKING_DIR,
            },
            required: ["session"],
            async execute(args, exec) {
                const sessionId = asString(args, "session", { required: true });
                const paths = await openInsp(exec, args);
                return InspirationPort.forgeBrief(paths, sessionId);
            },
        }),
        defineTool({
            name: "zhizhang_inspire_stage",
            description: "【闭环·灵感】暂存 foundation/outline 候选。不写作品。下一步：inspire_accept(apply=true 落盘)。",
            properties: {
                session: S("sessionId"),
                kind: S("foundation | outline"),
                payload: {
                    type: "object",
                    description: "foundation：locks/characters/planned/style/…；outline：chapter/title/ending/situationLens/livedScene/stateLens/…",
                    additionalProperties: true,
                },
                working_dir: WORKING_DIR,
            },
            required: ["session", "kind", "payload"],
            async execute(args, exec) {
                const sessionId = asString(args, "session", { required: true });
                const kind = asString(args, "kind", { required: true });
                if (kind !== "foundation" && kind !== "outline") {
                    fail("kind 须为 foundation 或 outline");
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
                    "下一步（闭环）：zhizhang_inspire_accept（apply=true 落盘）→ zhizhang_chapter_brief",
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_inspire_accept",
            description: "【闭环·灵感】显式采纳。apply=true 写入作品根基/章纲。下一步：chapter_brief(lean) 开写。",
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
            async execute(args, exec) {
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
                    "",
                    result.applied
                        ? "下一步（闭环）：zhizhang_chapter_brief(lean) → candidate_stage → style_lint → candidate_accept"
                        : "提示：尚未写入作品；需要落盘时再 inspire_accept(apply=true)",
                ].join("\n");
            },
        }),
        defineTool({
            name: "zhizhang_inspire_status",
            description: "【闭环·灵感】列会话或看详情。迷路时对照 zhizhang_product_map。",
            properties: {
                session: S("可选 sessionId；省略则列全部"),
                working_dir: WORKING_DIR,
            },
            required: [],
            async execute(args, exec) {
                const paths = await openInsp(exec, args);
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
                    return "尚无灵感会话。用 zhizhang_inspire_start 开启。";
                return [
                    "灵感会话（最近更新在前）：",
                    ...rows.map((r, i) => `${i + 1}. ${r.id} · ${r.goal.slice(0, 40)}${r.goal.length > 40 ? "…" : ""} · cards=${r.cardIds.length} · forge=${r.forgeAt ? "是" : "否"}`),
                ].join("\n");
            },
        }),
    ];
}
