/**
 * Panel console enrichments — Library / Inspiration / Product summaries for snapshot + HTML.
 * Read-only; no writes.
 */
import { readdir, readFile } from "node:fs/promises";
import path from "node:path";
import { LibraryPort, coerceAxis } from "./ports/library.js";
import { InspirationPort } from "./ports/inspiration.js";
import { ProductMap } from "./ports/product.js";
import { Scheduler } from "./ports/scheduler.js";
import { listLocalBooks, type StoragePaths } from "./store.js";
import type { Foundation } from "./types.js";

export interface PanelLibraryView {
  sourcesCount: number;
  sourceRoot: string;
  pendingCount: number;
  pending: Array<{ name: string; bytes: number }>;
  sources: Array<{ id: string; title: string; author: string }>;
  craftCount: number;
  mindCount: number;
  acceptedCount: number;
  draftedCount: number;
  combo: {
    ok: boolean;
    cardIds: string[];
    mindTitle: string | null;
    craftTitles: string[];
    emptyReason?: string;
  } | null;
  summary: string;
}

export interface PanelInspirationView {
  sessionsCount: number;
  sessions: Array<{
    id: string;
    goal: string;
    genre: string;
    updatedAt: string;
    forgeAt?: string;
    cardCount: number;
  }>;
  pendingEmits: number;
  acceptedEmits: number;
  appliedToWork: boolean;
  appliedCandIds: string[];
  foundationFilled: boolean;
  foundationFilledFields: string[];
  outlineProgress: {
    total: number;
    withSituation: number;
    withLived: number;
    withState: number;
    complete: number;
  };
  summary: string;
}

export interface PanelProductView {
  loopLine: string;
  writeLine: string;
  version: string;
  pillars: Array<{
    id: string;
    title: string;
    loopStage: 1 | 2 | 3;
    summary: string;
    handsOffTo: string;
    status: string;
  }>;
}

function foundationFilledFields(f: Foundation): string[] {
  const keys: Array<keyof Foundation> = [
    "locks",
    "happened",
    "characters",
    "readerKnowledge",
    "planned",
    "threads",
    "style",
  ];
  return keys.filter((k) => String(f[k] ?? "").trim().length > 0);
}

export async function buildLibraryView(paths: StoragePaths): Promise<PanelLibraryView> {
  await LibraryPort.ensureLibrary(paths);
  const sources = await LibraryPort.listSources(paths);
  const accepted = await LibraryPort.listCards(paths, { status: "accepted" });
  const drafted = await LibraryPort.listCards(paths, { status: "drafted" });

  let craftCount = 0;
  let mindCount = 0;
  for (const row of accepted) {
    let axis = row.axis;
    if (axis !== "craft" && axis !== "mind") {
      try {
        axis = coerceAxis(await LibraryPort.getCard(paths, row.id));
      } catch {
        axis = "craft";
      }
    }
    if (axis === "mind") mindCount += 1;
    else craftCount += 1;
  }

  let combo: PanelLibraryView["combo"] = null;
  try {
    const sug = await LibraryPort.suggestCombo(paths, { craftCount: 2 });
    combo = {
      ok: sug.ok,
      cardIds: sug.cardIds ?? [],
      mindTitle: sug.mind?.title ?? null,
      craftTitles: (sug.crafts ?? []).map((c) => c.title),
      emptyReason: sug.emptyReason,
    };
  } catch {
    combo = null;
  }

  const sourceRoot = paths.sourceRoot || "";
  let pending: Array<{ name: string; bytes: number }> = [];
  if (sourceRoot) {
    try {
      const local = await listLocalBooks(sourceRoot, { limit: 40 });
      const titles = new Set(sources.map((s) => s.title));
      pending = local.filter((b) => !titles.has(b.title));
    } catch {
      pending = [];
    }
  }

  return {
    sourcesCount: sources.length,
    sourceRoot,
    pendingCount: pending.length,
    pending: pending.slice(0, 12).map((b) => ({ name: b.name, bytes: b.bytes })),
    sources: sources.slice(0, 12).map((s) => ({
      id: s.id,
      title: s.title,
      author: s.author ?? "",
    })),
    craftCount,
    mindCount,
    acceptedCount: accepted.length,
    draftedCount: drafted.length,
    combo,
    summary: LibraryPort.summary,
  };
}

export async function buildInspirationView(
  paths: StoragePaths,
  opts: {
    workKey: string;
    foundation: Foundation;
    chapters: Array<{ situationLens: string; livedScene: string; stateLens: string }>;
  },
): Promise<PanelInspirationView> {
  const sessionsRaw = await InspirationPort.listSessions(paths);
  const sessions = sessionsRaw.slice(0, 8).map((s) => ({
    id: s.id,
    goal: s.goal,
    genre: s.genre ?? "",
    updatedAt: s.updatedAt ?? "",
    forgeAt: s.forgeAt,
    cardCount: (s.cardIds ?? []).length,
  }));

  let pendingEmits = 0;
  let acceptedEmits = 0;
  const appliedCandIds: string[] = [];
  try {
    const candDir = path.join(paths.inspiration, "candidates");
    const names = await readdir(candDir).catch(() => [] as string[]);
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const raw = JSON.parse(await readFile(path.join(candDir, name), "utf8")) as {
          status?: string;
          appliedWorkKey?: string;
          id?: string;
        };
        if (raw.status === "staged") pendingEmits += 1;
        if (raw.status === "accepted") acceptedEmits += 1;
        if (raw.appliedWorkKey && raw.appliedWorkKey === opts.workKey && raw.id) {
          appliedCandIds.push(raw.id);
        }
      } catch {
        /* skip */
      }
    }
  } catch {
    /* no insp candidates */
  }

  const filled = foundationFilledFields(opts.foundation);
  let withSituation = 0;
  let withLived = 0;
  let withState = 0;
  let complete = 0;
  for (const c of opts.chapters) {
    const sit = Boolean(c.situationLens?.trim());
    const liv = Boolean(c.livedScene?.trim());
    const st = Boolean(c.stateLens?.trim());
    if (sit) withSituation += 1;
    if (liv) withLived += 1;
    if (st) withState += 1;
    if (sit && liv && st) complete += 1;
  }

  return {
    sessionsCount: sessionsRaw.length,
    sessions,
    pendingEmits,
    acceptedEmits,
    appliedToWork: appliedCandIds.length > 0,
    appliedCandIds: appliedCandIds.slice(0, 8),
    foundationFilled: filled.length > 0,
    foundationFilledFields: filled,
    outlineProgress: {
      total: opts.chapters.length,
      withSituation,
      withLived,
      withState,
      complete,
    },
    summary: InspirationPort.summary,
  };
}

export function buildProductView(): PanelProductView {
  return {
    loopLine: ProductMap.loopLine(),
    writeLine: Scheduler.writeLine(),
    version: ProductMap.version,
    pillars: ProductMap.pillars().map((p) => ({
      id: p.id,
      title: p.title,
      loopStage: p.loopStage,
      summary: p.summary,
      handsOffTo: p.handsOffTo,
      status: p.status,
    })),
  };
}
