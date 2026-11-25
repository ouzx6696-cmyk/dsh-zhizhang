import fs from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "@zhizhang/core/clock";
import { atomicWrite, readJson, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { commitIntent, type IntentWrite } from "@zhizhang/core/journal";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import type { RunCtx } from "@zhizhang/core/pipeline";
import { arr } from "@zhizhang/core/schema";
import { createBibleStore } from "../../bible/store.js";
import type { Entity, StateEntry } from "../../bible/types.js";
import {
  BookCardFileSchema,
  BookFoundationSchema,
  BookVolumeSchema,
  ChapterOutlineSchema,
  type BookPipelineState,
  type BookPlanResult,
  type BookReq,
} from "./schemas.js";

export function isRecord(val: unknown): val is Record<string, unknown> {
  return typeof val === "object" && val !== null;
}

function isBookPlanResult(val: unknown): val is BookPlanResult {
  if (!isRecord(val)) return false;
  return (
    isRecord(val.card) &&
    isRecord(val.foundation) &&
    isRecord(val.structure) &&
    isRecord(val.outline)
  );
}

export function proposalDirOf(workPath: string, runId: string): string {
  return path.join(workPath, "plan", "proposals", runId);
}

async function readBookProposal(
  workPath: string,
  runId: string,
): Promise<BookPlanResult | undefined> {
  const dir = proposalDirOf(workPath, runId);
  const [card, foundation, volumes, chapters] = await Promise.all([
    readJson(path.join(dir, "card.json"), BookCardFileSchema).catch(() => undefined),
    readJson(path.join(dir, "foundation.json"), BookFoundationSchema).catch(() => undefined),
    readJson(path.join(dir, "structure.json"), arr(BookVolumeSchema)).catch(() => undefined),
    readJson(path.join(dir, "outline.json"), arr(ChapterOutlineSchema)).catch(() => undefined),
  ]);
  if (!card || !foundation || !volumes || !chapters) return undefined;
  return {
    card: {
      title: card.title,
      genre: card.genre,
      hook: card.hook,
      sellingPoints: card.sellingPoints,
      targetAudience: card.targetAudience,
    },
    foundation,
    structure: { volumes },
    outline: { chapters },
    outlineCount: chapters.length,
  };
}

export async function resolveBookPlanChoice(
  choice: unknown,
  ctx: RunCtx<BookReq, BookPipelineState>,
  runId: string,
): Promise<BookPlanResult | undefined> {
  if (isBookPlanResult(choice)) return choice;
  if (isRecord(choice) && isBookPlanResult(choice.plan)) return choice.plan;
  if (ctx.state.result) return ctx.state.result;
  if (ctx.state.card && ctx.state.foundation && ctx.state.structure && ctx.state.outline) {
    return {
      card: ctx.state.card,
      foundation: ctx.state.foundation,
      structure: ctx.state.structure,
      outline: ctx.state.outline,
      outlineCount: ctx.state.outline.chapters.length,
    };
  }
  return readBookProposal(ctx.target.path, runId);
}

function upsertById<T extends { id: string }>(list: T[], item: T): T[] {
  const idx = list.findIndex((x) => x.id === item.id);
  if (idx === -1) return [...list, item];
  const next = [...list];
  next[idx] = item;
  return next;
}

async function intentWrite(file: string, after: string): Promise<IntentWrite> {
  const prev = await readTextIfExists(file);
  return {
    path: file,
    beforeHash: prev === undefined ? null : sha256(prev),
    after,
  };
}

export async function applyBookPlan(
  workPath: string,
  runId: string,
  plan: BookPlanResult,
  lock: LockService = createLockService(systemClock),
  clock: Clock = systemClock,
): Promise<{ backupDir: string; backedUpFiles: string[]; writtenPlanFiles: string[] }> {
  const bibleStore = createBibleStore(lock, clock);
  return lock.write({ kind: "work", path: workPath }, async () => {
    const planDir = path.join(workPath, "plan");
    const backupDir = path.join(workPath, ".zhizhang", "trash", `plan-${runId}`);
    const planFiles = ["card.json", "foundation.json", "structure.json", "outline.json"];
    const backedUpFiles: string[] = [];

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

    const nowIso = clock.iso();
    const provenance = { source: "plan" as const, run: runId, at: nowIso };
    const bible = await bibleStore.read(workPath);

    const protagonistEntity: Entity = {
      id: "ent-protagonist",
      kind: "character",
      name: plan.foundation.protagonist.name,
      aliases: [],
      summary: `目标：${plan.foundation.protagonist.goal}；弱点：${plan.foundation.protagonist.flaw}；金手指：${plan.foundation.protagonist.goldenFinger}`,
      locked: [],
      provenance,
    };
    const worldviewEntity: Entity = {
      id: "ent-worldview",
      kind: "rule",
      name: "世界观与主线冲突",
      aliases: [],
      summary: `${plan.foundation.worldview}；主线冲突：${plan.foundation.coreConflict}`,
      locked: [],
      global: true,
      provenance,
    };
    const powerEntity: Entity = {
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

    const plannedStates: StateEntry[] = [
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
    const hashes = {
      entities: sha256(JSON.stringify(nextEntities)),
      states: sha256(JSON.stringify(nextStates)),
      threads: sha256(JSON.stringify(bible.threads)),
      knowledge: sha256(JSON.stringify(bible.knowledge)),
      chapters: sha256(JSON.stringify(bible.chapters)),
      style: sha256(JSON.stringify(bible.style)),
      pending: sha256(JSON.stringify(bible.pending)),
    };

    const writes = await Promise.all([
      intentWrite(cardFile, JSON.stringify({ format: FORMAT_VERSION, ...plan.card }, null, 2)),
      intentWrite(foundationFile, JSON.stringify(plan.foundation, null, 2)),
      intentWrite(structureFile, JSON.stringify(plan.structure.volumes, null, 2)),
      intentWrite(outlineFile, JSON.stringify(plan.outline.chapters, null, 2)),
      intentWrite(path.join(bibleDir, "entities.json"), JSON.stringify(nextEntities, null, 2)),
      intentWrite(path.join(bibleDir, "states.json"), JSON.stringify(nextStates, null, 2)),
      intentWrite(
        path.join(bibleDir, "index.json"),
        JSON.stringify({ format: FORMAT_VERSION, hashes }, null, 2),
      ),
    ]);

    await commitIntent(
      path.join(workPath, ".journal"),
      {
        format: FORMAT_VERSION,
        id: `book-apply-${runId}`,
        writes,
        meta: { operation: "book.apply", runId },
      },
      lock,
      { kind: "work", path: workPath },
    );

    return {
      backupDir,
      backedUpFiles,
      writtenPlanFiles: [cardFile, foundationFile, structureFile, outlineFile],
    };
  });
}
