import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { buildDeliveryMarker, isAlreadyDelivered } from "@zhizhang/core/pipeline";
import { arr, int, lit, obj, opt, parseJson, str } from "@zhizhang/core/schema";
import { createBibleStore } from "../../bible/store.js";
export const BookPipelineReq = obj({
    title: str({ min: 1 }),
    premise: str({ min: 1 }),
    genre: opt(str()),
    grade: opt(lit("economy", "standard", "premium")),
    outlineCount: opt(int({ min: 1, max: 100 })),
});
const BookCardSchema = obj({
    title: str({ min: 1 }),
    genre: str({ min: 1 }),
    hook: str({ min: 1 }),
    sellingPoints: arr(str({ min: 1 }), { max: 10 }),
    targetAudience: str({ min: 1 }),
});
const BookFoundationSchema = obj({
    protagonist: obj({
        name: str({ min: 1 }),
        goal: str({ min: 1 }),
        flaw: str({ min: 1 }),
        goldenFinger: str({ min: 1 }),
    }),
    worldview: str({ min: 1 }),
    powerSystem: str({ min: 1 }),
    coreConflict: str({ min: 1 }),
});
const BookStructureSchema = obj({
    volumes: arr(obj({
        volume: int({ min: 1 }),
        title: str({ min: 1 }),
        summary: str({ min: 1 }),
        startChapter: int({ min: 1 }),
        endChapter: int({ min: 1 }),
    }), { max: 30 }),
});
const BookOutlineSchema = obj({
    chapters: arr(obj({
        position: int({ min: 1 }),
        title: str({ min: 1 }),
        synopsis: str({ min: 1 }),
        conflict: str({ min: 1 }),
        hook: str({ min: 1 }),
    }), { max: 100 }),
});
export const cardStage = {
    id: "card",
    title: "书卡定位",
    role: "planner",
    method: { stage: "fanqie.book.card" },
    input: (ctx) => ctx.request,
    shape: 'JSON 格式：{"title":"书名","genre":"题材","hook":"核心看点","sellingPoints":["卖点"],"targetAudience":"目标读者"}',
    format: "json",
    parse: (raw) => parseJson(raw, BookCardSchema, "book.card"),
};
export const foundationStage = {
    id: "foundation",
    title: "世界与人物基石",
    role: "planner",
    method: { stage: "fanqie.book.foundation" },
    input: (ctx) => ({
        req: ctx.request,
        card: ctx.state.card,
    }),
    shape: 'JSON 格式：{"protagonist":{"name":"主角名","goal":"目标","flaw":"弱点","goldenFinger":"金手指"},"worldview":"世界观","powerSystem":"升级体系","coreConflict":"主线冲突"}',
    format: "json",
    parse: (raw) => parseJson(raw, BookFoundationSchema, "book.foundation"),
};
export const structureStage = {
    id: "structure",
    title: "分卷结构",
    role: "planner",
    method: { stage: "fanqie.book.structure" },
    input: (ctx) => ({
        req: ctx.request,
        card: ctx.state.card,
        foundation: ctx.state.foundation,
    }),
    shape: 'JSON 格式：{"volumes":[{"volume":1,"title":"卷名","summary":"卷梗概","startChapter":1,"endChapter":50}]}',
    format: "json",
    parse: (raw) => parseJson(raw, BookStructureSchema, "book.structure"),
};
export const outlineStage = {
    id: "outline",
    title: "前序章纲",
    role: "planner",
    method: { stage: "fanqie.book.outline" },
    input: (ctx) => {
        const req = ctx.request;
        return {
            req,
            card: ctx.state.card,
            foundation: ctx.state.foundation,
            structure: ctx.state.structure,
            outlineCount: req.outlineCount ?? 10,
        };
    },
    shape: 'JSON 格式：{"chapters":[{"position":1,"title":"章名","synopsis":"梗概","conflict":"冲突","hook":"章末钩子"}]}',
    format: "json",
    parse: (raw) => parseJson(raw, BookOutlineSchema, "book.outline"),
};
function isRecord(val) {
    return typeof val === "object" && val !== null;
}
function isBookPlanResult(val) {
    if (!isRecord(val))
        return false;
    return isRecord(val.card) && isRecord(val.foundation) && isRecord(val.structure) && isRecord(val.outline);
}
function resolveBookPlanChoice(choice, ctx) {
    if (isBookPlanResult(choice))
        return choice;
    if (isRecord(choice) && isBookPlanResult(choice.plan)) {
        return choice.plan;
    }
    if (isBookPlanResult(ctx.state.result))
        return ctx.state.result;
    if (isBookPlanResult(ctx.state)) {
        return {
            card: ctx.state.card,
            foundation: ctx.state.foundation,
            structure: ctx.state.structure,
            outline: ctx.state.outline,
            outlineCount: ctx.state.outline.chapters.length,
        };
    }
    return undefined;
}
function upsertById(list, item) {
    const idx = list.findIndex((x) => x.id === item.id);
    if (idx === -1)
        return [...list, item];
    const next = [...list];
    next[idx] = item;
    return next;
}
export async function applyBookPlan(workPath, runId, plan, lock = createLockService(systemClock)) {
    const bibleStore = createBibleStore(lock);
    return lock.write({ kind: "work", path: workPath }, async () => {
        const planDir = path.join(workPath, "plan");
        const backupDir = path.join(workPath, ".zhizhang", "trash", `plan-${runId}`);
        const planFiles = ["card.json", "foundation.json", "structure.json", "outline.json"];
        const backedUpFiles = [];
        await fs.mkdir(backupDir, { recursive: true });
        for (const file of planFiles) {
            const src = path.join(planDir, file);
            const existing = await readTextIfExists(src);
            if (existing !== undefined) {
                const dst = path.join(backupDir, file);
                await atomicWrite(dst, existing);
                backedUpFiles.push(dst);
            }
        }
        const cardFile = path.join(planDir, "card.json");
        const foundationFile = path.join(planDir, "foundation.json");
        const structureFile = path.join(planDir, "structure.json");
        const outlineFile = path.join(planDir, "outline.json");
        await atomicWrite(cardFile, JSON.stringify({ format: FORMAT_VERSION, ...plan.card }, null, 2));
        await atomicWrite(foundationFile, JSON.stringify(plan.foundation, null, 2));
        await atomicWrite(structureFile, JSON.stringify(plan.structure.volumes, null, 2));
        await atomicWrite(outlineFile, JSON.stringify(plan.outline.chapters, null, 2));
        const nowIso = systemClock.iso();
        const provenance = { source: "plan", run: runId, at: nowIso };
        const bible = await bibleStore.read(workPath);
        const protagonistEntity = {
            id: "ent-protagonist",
            kind: "character",
            name: plan.foundation.protagonist.name,
            aliases: [],
            summary: `目标：${plan.foundation.protagonist.goal}；弱点：${plan.foundation.protagonist.flaw}；金手指：${plan.foundation.protagonist.goldenFinger}`,
            locked: [],
            provenance,
        };
        const worldviewEntity = {
            id: "ent-worldview",
            kind: "rule",
            name: "世界观与主线冲突",
            aliases: [],
            summary: `${plan.foundation.worldview}；主线冲突：${plan.foundation.coreConflict}`,
            locked: [],
            global: true,
            provenance,
        };
        const powerEntity = {
            id: "ent-power-system",
            kind: "rule",
            name: "升级体系",
            aliases: [],
            summary: plan.foundation.powerSystem,
            locked: [],
            global: true,
            provenance,
        };
        let nextEntities = upsertById(bible.entities, protagonistEntity);
        nextEntities = upsertById(nextEntities, worldviewEntity);
        nextEntities = upsertById(nextEntities, powerEntity);
        const plannedStates = [
            {
                id: "st-plan-protagonist-goal",
                entity: "ent-protagonist",
                field: "目标",
                value: plan.foundation.protagonist.goal,
                since: 1,
                mode: "replace",
                status: "planned",
                provenance,
            },
            {
                id: "st-plan-protagonist-goldenfinger",
                entity: "ent-protagonist",
                field: "金手指",
                value: plan.foundation.protagonist.goldenFinger,
                since: 1,
                mode: "replace",
                status: "planned",
                provenance,
            },
            {
                id: "st-plan-core-conflict",
                entity: "ent-worldview",
                field: "主线冲突",
                value: plan.foundation.coreConflict,
                since: 1,
                mode: "replace",
                status: "planned",
                provenance,
            },
        ];
        let nextStates = bible.states;
        for (const entry of plannedStates) {
            nextStates = upsertById(nextStates, entry);
        }
        const bibleDir = path.join(workPath, "bible");
        await atomicWrite(path.join(bibleDir, "entities.json"), JSON.stringify(nextEntities, null, 2));
        await atomicWrite(path.join(bibleDir, "states.json"), JSON.stringify(nextStates, null, 2));
        const hashes = {
            entities: sha256(JSON.stringify(nextEntities)),
            states: sha256(JSON.stringify(nextStates)),
            threads: sha256(JSON.stringify(bible.threads)),
            knowledge: sha256(JSON.stringify(bible.knowledge)),
            chapters: sha256(JSON.stringify(bible.chapters)),
            style: sha256(JSON.stringify(bible.style)),
            pending: sha256(JSON.stringify(bible.pending)),
        };
        await atomicWrite(path.join(bibleDir, "index.json"), JSON.stringify({ format: "zhizhang/1.3", hashes }, null, 2));
        return {
            backupDir,
            backedUpFiles,
            writtenPlanFiles: [cardFile, foundationFile, structureFile, outlineFile],
        };
    });
}
export const bookPipeline = {
    kind: "fanqie.book",
    request: BookPipelineReq,
    async context(target, req) {
        return { runId: `book-${Date.now()}`, target, request: req, state: {} };
    },
    async run(runner, ctx) {
        const req = ctx.request;
        const packet = {
            prefix: [
                {
                    id: "book-premise",
                    layer: 0,
                    text: `书名：${req.title}\n题材：${req.genre ?? "未指定"}\n核心设定：${req.premise}`,
                    required: true,
                    tokens: Math.ceil((req.title.length + req.premise.length) / 2),
                    reason: "全书立项输入",
                    source: { kind: "author", ref: "premise" },
                },
            ],
            suffix: [],
            omitted: [],
            estimate: Math.ceil((req.title.length + req.premise.length) / 2),
        };
        const card = await runner.stage(cardStage, packet);
        ctx.state.card = card;
        const foundation = await runner.stage(foundationStage, packet);
        ctx.state.foundation = foundation;
        const structure = await runner.stage(structureStage, packet);
        ctx.state.structure = structure;
        const outline = await runner.stage(outlineStage, packet);
        ctx.state.outline = outline;
        const result = {
            card,
            foundation,
            structure,
            outline,
            outlineCount: outline.chapters.length,
        };
        ctx.state.result = result;
        return result;
    },
    async deliver(res, ctx) {
        const planDir = path.join(ctx.target.path, "plan");
        const marker = path.join(planDir, `${ctx.runId}.marker.json`);
        const cardPayload = JSON.stringify({ format: FORMAT_VERSION, ...res.card }, null, 2);
        if (await isAlreadyDelivered(marker, ctx.runId)) {
            return {
                runId: ctx.runId,
                deliveredPaths: [],
                contentHash: sha256(cardPayload),
                summary: "已幂等交付全书规划",
            };
        }
        const cardFile = path.join(planDir, "card.json");
        const foundationFile = path.join(planDir, "foundation.json");
        const structureFile = path.join(planDir, "structure.json");
        const outlineFile = path.join(planDir, "outline.json");
        await atomicWrite(cardFile, cardPayload);
        await atomicWrite(foundationFile, JSON.stringify(res.foundation, null, 2));
        await atomicWrite(structureFile, JSON.stringify(res.structure.volumes, null, 2));
        await atomicWrite(outlineFile, JSON.stringify(res.outline.chapters, null, 2));
        await atomicWrite(marker, buildDeliveryMarker(ctx.runId, cardPayload));
        return {
            runId: ctx.runId,
            deliveredPaths: [cardFile, foundationFile, structureFile, outlineFile],
            contentHash: sha256(cardPayload),
            summary: `已生成全书规划（${res.structure.volumes.length} 卷，前 ${res.outlineCount} 章纲）`,
        };
    },
    async recover(record, ctx) {
        const marker = path.join(ctx.target.path, "plan", `${record.id}.marker.json`);
        return (await isAlreadyDelivered(marker, record.id)) ? "delivered" : "resume";
    },
    async apply(record, choice, ctx) {
        if (choice === "reject")
            return;
        if (isRecord(choice) && choice.adopt === false) {
            return;
        }
        const plan = resolveBookPlanChoice(choice, ctx);
        if (!plan) {
            throw new AppError("input.invalid", "缺少可应用的全书规划结果", { runId: record.id });
        }
        await applyBookPlan(ctx.target.path, record.id || ctx.runId, plan);
    },
};
