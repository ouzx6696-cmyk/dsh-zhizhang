/**
 * InspirationPort — 灵感推演支柱（live）。
 * Session + Library cards + MethodRegistry develop/plan → stage foundation/outline → explicit accept (optional apply to work).
 * Does not silently foundation_set.
 */
import { mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import {
  atomicWrite,
  createWork,
  resolveWorkDir,
  saveChapter,
  setFoundation,
  readChapter,
  readWorkMeta,
  type StoragePaths,
  withLock,
} from "../store.js";
import type { Foundation, Outline } from "../types.js";
import {
  LibraryPort,
  coerceAxis,
  formatTechniqueCardBlock,
  formatTechniqueCardBlockLean,
  type TechniqueCard,
} from "./library.js";
import { MethodRegistry } from "./methods.js";
import { QualityPolicy } from "./quality-policy.js";
import type { PillarStatus } from "./library.js";

export interface InspirationCapability {
  id: string;
  title: string;
  ready: boolean;
}

export interface InspirationSession {
  schemaVersion: 1;
  id: string;
  goal: string;
  genre: string;
  cardIds: string[];
  /** 0.7.0：仅技法试写（无 mind 卡时须显式） */
  craftOnly?: boolean;
  createdAt: string;
  updatedAt: string;
  forgeAt?: string;
  lastBriefPreview?: string;
}

export type InspireEmitKind = "foundation" | "outline";

export interface InspirationCandidate {
  schemaVersion: 1;
  id: string;
  sessionId: string;
  kind: InspireEmitKind;
  payload: Record<string, unknown>;
  status: "staged" | "accepted";
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
  appliedWorkKey?: string;
}

function nowIso(): string {
  return new Date().toISOString();
}

let idSeq = 0;
function newId(prefix: string): string {
  idSeq += 1;
  return `${prefix}-${Date.now().toString(36)}${idSeq.toString(36)}`;
}

async function fileExists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

function inspDirs(paths: StoragePaths) {
  return {
    root: paths.inspiration,
    sessions: path.join(paths.inspiration, "sessions"),
    candidates: path.join(paths.inspiration, "candidates"),
  };
}

async function ensureInsp(paths: StoragePaths): Promise<void> {
  const d = inspDirs(paths);
  await mkdir(d.sessions, { recursive: true });
  await mkdir(d.candidates, { recursive: true });
}

export const InspirationPort = {
  id: "port.inspiration" as const,
  status: "live" as PillarStatus,
  title: "灵感推演",
  summary:
    "闭环第2段：combo/card_ids → forge（mind 主粮 + craft 辅）→ stage 根基/章纲 → accept(apply?) → 交给写作 brief。不静默 foundation_set。",

  capabilities(): InspirationCapability[] {
    return [
      { id: "session", title: "灵感会话（须 mind 或 craft_only）", ready: true },
      { id: "forge_with_cards", title: "结合 mind/craft 分喂推演", ready: true },
      { id: "emit_foundation", title: "暂存根基候选", ready: true },
      { id: "emit_outline", title: "暂存章纲候选", ready: true },
      { id: "accept_apply", title: "显式采纳（可选写入作品）", ready: true },
    ];
  },

  async startSession(
    paths: StoragePaths,
    input: { goal: string; genre?: string; cardIds: string[]; craftOnly?: boolean },
  ): Promise<{ sessionId: string; craftOnly: boolean; mindCount: number; craftCount: number }> {
    await ensureInsp(paths);
    await LibraryPort.ensureLibrary(paths);
    const goal = String(input.goal ?? "").trim();
    if (!goal) throw new ZhizhangError("bad_args", "goal 不能为空");
    const cardIds = (input.cardIds ?? []).map((id) => String(id).trim()).filter(Boolean);
    if (cardIds.length === 0) {
      throw new ZhizhangError("bad_args", "cardIds 至少一张已采纳卡");
    }
    const craftOnly = Boolean(input.craftOnly);
    let mindCount = 0;
    let craftCount = 0;
    for (const id of cardIds) {
      const card = await LibraryPort.getCard(paths, id);
      if (card.status !== "accepted") {
        throw new ZhizhangError("card_not_accepted", `卡 ${id} 尚未 accept，不能用于灵感`);
      }
      const axis = coerceAxis(card);
      if (axis === "mind") mindCount += 1;
      else craftCount += 1;
    }
    if (mindCount === 0 && !craftOnly) {
      throw new ZhizhangError(
        "mind_required",
        "灵感规划须至少一张 axis=mind 创作思维卡；若仅技法试写请传 craft_only=true",
      );
    }

    const sessionId = newId("insp");
    const now = nowIso();
    const session: InspirationSession = {
      schemaVersion: 1,
      id: sessionId,
      goal,
      genre: String(input.genre ?? "").trim(),
      cardIds,
      createdAt: now,
      updatedAt: now,
    };
    if (craftOnly) session.craftOnly = true;
    const d = inspDirs(paths);
    await atomicWrite(
      path.join(d.sessions, `${sessionId}.json`),
      JSON.stringify(session, null, 2) + "\n",
    );
    return { sessionId, craftOnly, mindCount, craftCount };
  },

  async getSession(paths: StoragePaths, sessionId: string): Promise<InspirationSession> {
    await ensureInsp(paths);
    const d = inspDirs(paths);
    const p = path.join(d.sessions, `${sessionId}.json`);
    if (!(await fileExists(p))) {
      throw new ZhizhangError("session_not_found", `找不到灵感会话 ${sessionId}`);
    }
    return JSON.parse(await readFile(p, "utf8")) as InspirationSession;
  },

  async listSessions(paths: StoragePaths): Promise<Array<Pick<InspirationSession, "id" | "goal" | "genre" | "cardIds" | "forgeAt" | "updatedAt">>> {
    await ensureInsp(paths);
    const d = inspDirs(paths);
    const { readdir } = await import("node:fs/promises");
    const names = await readdir(d.sessions).catch(() => [] as string[]);
    const rows: Array<Pick<InspirationSession, "id" | "goal" | "genre" | "cardIds" | "forgeAt" | "updatedAt">> = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      try {
        const s = JSON.parse(await readFile(path.join(d.sessions, name), "utf8")) as InspirationSession;
        rows.push({
          id: s.id,
          goal: s.goal,
          genre: s.genre,
          cardIds: s.cardIds,
          forgeAt: s.forgeAt,
          updatedAt: s.updatedAt,
        });
      } catch {
        /* skip */
      }
    }
    rows.sort((a, b) => (b.updatedAt || "").localeCompare(a.updatedAt || ""));
    return rows;
  },

  async forgeBrief(paths: StoragePaths, sessionId: string): Promise<string> {
    const session = await InspirationPort.getSession(paths, sessionId);
    const cards: TechniqueCard[] = [];
    for (const id of session.cardIds) {
      cards.push(await LibraryPort.getCard(paths, id));
    }

    const develop = MethodRegistry.get("develop");
    const plan = MethodRegistry.get("plan");
    const tomato = MethodRegistry.get("tomato_four_q");

    const mindCards = cards.filter((c) => coerceAxis(c) === "mind");
    const craftCards = cards.filter((c) => coerceAxis(c) !== "mind");
    const thinMind = mindCards.filter((c) => !c.mind).length;
    const thinFeel = craftCards.filter((c) => !c.humanFeel).length;
    const craftOnly = Boolean(session.craftOnly);

    const lines = [
      `# 灵感推演简报 · ${sessionId}`,
      `- goal：${session.goal}`,
      `- genre：${session.genre || "（未填）"}`,
      `- 卡：${session.cardIds.join("、")}`,
      `- 分轴：mind ${mindCards.length} · craft ${craftCards.length}` +
        (craftOnly ? " · **仅技法试写（craft_only）**" : ""),
      mindCards.length === 0
        ? `- ⚠️ 无 mind 卡` + (craftOnly ? "（已声明仅技法试写）" : "")
        : thinMind > 0
          ? `- ⚠️ ${thinMind}/${mindCards.length} 张 mind 偏薄（无 mind 块）`
          : `- ✓ mind 卡均含创作思维块`,
      craftCards.length === 0
        ? `- （无 craft 辅卡）`
        : thinFeel > 0
          ? `- ⚠️ ${thinFeel}/${craftCards.length} 张 craft 写法/状态偏薄`
          : `- ✓ craft 辅卡均含 humanFeel`,
      "",
      "【工程说明】本工具**分喂**拆书库双轴卡与方法包（流程纪律），**不代写设定**。mind → foundation/outline；craft 仅辅风格/场面。完成后 zhizhang_inspire_stage → inspire_accept。根基写入须经 inspire_accept(apply)。",
      "",
      "## ① 创作思维（mind · 主粮）——设定 / 章纲 / 卷纲",
      "先吃 sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract；写成可迁移的设定/纲思维。",
      "",
    ];
    if (mindCards.length === 0) {
      lines.push(
        craftOnly
          ? "（本会话为仅技法试写：无 mind 主粮；planned/locks 须自洽并标明偏技法。）"
          : "（无 mind 卡 — 不应到达此处；请补 mind 或 craft_only。）",
      );
      lines.push("");
    } else {
      for (const c of mindCards) {
        lines.push(formatTechniqueCardBlock(c));
        lines.push("");
      }
    }

    lines.push("## ② 写作技法（craft · 辅）——风格与场面");
    lines.push("可参考写法/状态/继续；世界观与章纲主吃 mind。");
    lines.push("");
    if (craftCards.length === 0) {
      lines.push("（无 craft 辅卡）");
      lines.push("");
    } else {
      for (const c of craftCards) {
        lines.push(formatTechniqueCardBlock(c));
        lines.push("");
      }
    }

    lines.push("## 共享方法包（流程纪律；≠ 拆书库双轴卡）");
    lines.push("");
    if (develop) {
      lines.push(MethodRegistry.formatForAgent(develop));
      lines.push("");
    }
    if (plan) {
      lines.push(MethodRegistry.formatForAgent(plan));
      lines.push("");
    }
    if (tomato) {
      lines.push(MethodRegistry.formatForAgent(tomato));
      lines.push("");
    }
    lines.push("## 输出要求");
    lines.push(
      "- foundation：locks / characters / planned / style / threads 等；**planned/locks/threads 须主吃 mind**（卖点进代价、信息分期、压力机、长线债）；style 可辅吃 craft 的写法+状态；人名剧情自行重造。",
    );
    lines.push(
      "- outline：须含 chapter、title、situationLens、livedScene、stateLens、ending；**压力换与书债对齐 mind.debtAndSwap / readerContract**；stateLens 写场面状态/写法取舍（非声纹）。",
    );
    lines.push("- **相邻换压力**：后续章纲换场面/压力/人事，接着前章后果往下推。");
    lines.push("- 成功样子：可迁移的设定/纲思维 + 写法场面；对照 failAsEncyclopedia / failAsTemplate / failAsShortStory 自检边界。");
    lines.push("- **质量面 · 毒点**：" + QualityPolicy.poisonPolicyLine());
    lines.push("- " + QualityPolicy.surfaceLine());
    lines.push("- 完成后：zhizhang_inspire_stage → zhizhang_inspire_accept（apply=true 写入作品）。");

    const brief = lines.join("\n");
    const now = nowIso();
    const d = inspDirs(paths);
    const updated: InspirationSession = {
      ...session,
      forgeAt: now,
      updatedAt: now,
      lastBriefPreview: brief.slice(0, 400),
    };
    await atomicWrite(
      path.join(d.sessions, `${sessionId}.json`),
      JSON.stringify(updated, null, 2) + "\n",
    );
    return brief;
  },

  async stageEmit(
    paths: StoragePaths,
    sessionId: string,
    input: { kind: InspireEmitKind; payload: Record<string, unknown> },
  ): Promise<{ candId: string; kind: InspireEmitKind; styleReminder: string }> {
    const session = await InspirationPort.getSession(paths, sessionId);
    const kind = input.kind;
    if (kind !== "foundation" && kind !== "outline") {
      throw new ZhizhangError("bad_args", "kind 须为 foundation 或 outline");
    }
    const payload = input.payload;
    if (!payload || typeof payload !== "object" || Array.isArray(payload)) {
      throw new ZhizhangError("bad_args", "payload 必须是对象");
    }
    if (kind === "foundation") {
      const has =
        payload.locks ||
        payload.characters ||
        payload.planned ||
        payload.style ||
        payload.happened ||
        payload.threads ||
        payload.readerKnowledge;
      if (!has) {
        throw new ZhizhangError("empty_body", "foundation payload 至少填一个根基字段");
      }
    } else {
      const chapter = String(payload.chapter ?? payload.chapterId ?? "").trim();
      if (!chapter) throw new ZhizhangError("bad_args", "outline payload 须含 chapter");
      const ending = String(payload.ending ?? "").trim();
      if (!ending) throw new ZhizhangError("bad_args", "outline payload 须含 ending（可兑付落点）");
    }

    const candId = newId("icand");
    const now = nowIso();
    const cand: InspirationCandidate = {
      schemaVersion: 1,
      id: candId,
      sessionId,
      kind,
      payload: { ...payload },
      status: "staged",
      createdAt: now,
      updatedAt: now,
    };
    const d = inspDirs(paths);
    await atomicWrite(
      path.join(d.candidates, `${candId}.json`),
      JSON.stringify(cand, null, 2) + "\n",
    );

    let mindN = 0;
    let craftN = 0;
    let withMind = 0;
    let withFeel = 0;
    for (const id of session.cardIds) {
      try {
        const c = await LibraryPort.getCard(paths, id);
        if (coerceAxis(c) === "mind") {
          mindN += 1;
          if (c.mind) withMind += 1;
        } else {
          craftN += 1;
          if (c.humanFeel) withFeel += 1;
        }
      } catch {
        /* skip missing */
      }
    }
    const craftOnly = Boolean(session.craftOnly);
    const styleReminder =
      kind === "foundation"
        ? `planned/locks/threads 主吃 mind（有 mind ${mindN} 张` +
          (withMind < mindN ? `，偏薄 ${mindN - withMind}` : "") +
          `）；style 可辅 craft（${craftN}，含写法 ${withFeel}）` +
          (craftOnly ? "；本会话 craft_only" : "") +
          "。写成可迁移设定/纲；章纲留追读余地。"
        : `ending/压力换对齐 mind.debtAndSwap；stateLens=场面状态（非声纹）；mind ${mindN} / craft ${craftN}` +
          (craftOnly ? "；craft_only" : "") +
          "。相邻章换压力/场面推进。";

    return { candId, kind, styleReminder };
  },

  async acceptEmit(
    paths: StoragePaths,
    candId: string,
    opts: { workKey: string; apply?: boolean; title?: string; genre?: string; premise?: string },
  ): Promise<{ candId: string; applied: boolean; workKey: string; detail: string }> {
    await ensureInsp(paths);
    const d = inspDirs(paths);
    const candPath = path.join(d.candidates, `${candId}.json`);
    if (!(await fileExists(candPath))) {
      throw new ZhizhangError("candidate_not_found", `找不到灵感候选 ${candId}`);
    }
    const cand = JSON.parse(await readFile(candPath, "utf8")) as InspirationCandidate;
    if (cand.status === "accepted" && cand.appliedWorkKey) {
      throw new ZhizhangError("already_accepted", `灵感候选 ${candId} 已采纳到 ${cand.appliedWorkKey}`);
    }

    const workKey = String(opts.workKey ?? "").trim();
    if (!workKey) throw new ZhizhangError("bad_args", "workKey 不能为空");
    const apply = Boolean(opts.apply);
    let detail = "仅标记采纳，未写入作品（apply=false）";

    if (apply) {
      // Ensure work exists
      let dir: string;
      try {
        dir = await resolveWorkDir(paths, workKey);
      } catch {
        const created = await createWork(paths, {
          title: opts.title || workKey,
          genre: opts.genre,
          premise: opts.premise,
          key: workKey,
        });
        dir = created.dir;
      }

      if (cand.kind === "foundation") {
        const p = cand.payload;
        const patch: Partial<Foundation> = {};
        for (const key of [
          "locks",
          "happened",
          "characters",
          "readerKnowledge",
          "planned",
          "threads",
          "style",
        ] as const) {
          if (typeof p[key] === "string" && String(p[key]).trim()) {
            patch[key] = String(p[key]);
          }
        }
        if (Object.keys(patch).length === 0) {
          throw new ZhizhangError("empty_body", "foundation payload 无可写入字段");
        }
        const meta = await setFoundation(dir, patch);
        detail = `已 apply foundation → 作品「${meta.title}」（${meta.key}）：${Object.keys(patch).join("、")}`;
      } else {
        const p = cand.payload;
        const chapterId = String(p.chapter ?? p.chapterId ?? "").trim();
        const outlinePatch: Partial<Outline> = {};
        for (const key of [
          "pov",
          "locks",
          "knowledge",
          "synopsis",
          "conflict",
          "beats",
          "ending",
          "situationLens",
          "livedScene",
          "stateLens",
        ] as const) {
          if (typeof p[key] === "string") outlinePatch[key] = String(p[key]);
        }
        // legacy alias
        if (typeof p.voiceTone === "string" && String(p.voiceTone).trim()) {
          if (!outlinePatch.stateLens) outlinePatch.stateLens = String(p.voiceTone);
        }
        if (typeof p.targetWords === "number") outlinePatch.targetWords = p.targetWords;
        let title = typeof p.title === "string" ? p.title : undefined;
        let body = "";
        let position: number | undefined;
        let status: "planned" | "drafting" | "drafted" | "reviewed" | "final" | undefined;
        try {
          const existing = await readChapter(dir, chapterId);
          title = title ?? existing.title;
          body = existing.body;
          position = existing.position;
          status = existing.status;
          Object.assign(outlinePatch, { ...existing.outline, ...outlinePatch });
        } catch {
          title = title ?? chapterId;
          status = "planned";
        }
        await saveChapter(dir, {
          id: chapterId,
          title: title!,
          body,
          position,
          status: status!,
          outline: outlinePatch as Outline,
        });
        const meta = await readWorkMeta(dir);
        detail = `已 apply outline → 作品「${meta.title}」章 ${chapterId}《${title}》`;
      }
    }

    const now = nowIso();
    const updated: InspirationCandidate = {
      ...cand,
      status: "accepted",
      updatedAt: now,
      acceptedAt: now,
      appliedWorkKey: apply ? workKey : cand.appliedWorkKey,
    };
    await withLock(`inspiration:${paths.inspiration}`, async () => {
      await atomicWrite(candPath, JSON.stringify(updated, null, 2) + "\n");
    });

    return { candId, applied: apply, workKey, detail };
  },

  /**
   * Resolve technique cards for chapter_brief / writing path.
   * Priority: explicit cardIds → inspire sessions applied to work → genre tag search → none.
   */
  async resolveCardsForBrief(
    paths: StoragePaths,
    opts: {
      cardIds?: string[];
      workKey?: string;
      genre?: string;
      limit?: number;
    } = {},
  ): Promise<{
    cards: TechniqueCard[];
    source: "explicit" | "inspire_apply" | "genre_tags" | "none";
    note: string;
    cardIds: string[];
  }> {
    await ensureInsp(paths);
    await LibraryPort.ensureLibrary(paths);
    const limit = Math.max(1, Math.min(opts.limit ?? 5, 12));
    const explicit = (opts.cardIds ?? []).map((id) => String(id).trim()).filter(Boolean);

    if (explicit.length > 0) {
      const cards: TechniqueCard[] = [];
      for (const id of explicit.slice(0, limit)) {
        const card = await LibraryPort.getCard(paths, id);
        if (card.status !== "accepted") {
          throw new ZhizhangError(
            "card_not_accepted",
            `技法卡 ${id} 尚未 accept，不能注入 chapter_brief`,
          );
        }
        cards.push(card);
      }
      cards.sort((a, b) => {
        const aa = coerceAxis(a) === "craft" ? 0 : 1;
        const bb = coerceAxis(b) === "craft" ? 0 : 1;
        return aa - bb;
      });
      return {
        cards,
        source: "explicit",
        note: `显式 card_ids（${cards.length}；craft 优先）`,
        cardIds: cards.map((c) => c.id),
      };
    }

    const workKey = String(opts.workKey ?? "").trim();
    if (workKey) {
      const d = inspDirs(paths);
      const { readdir } = await import("node:fs/promises");
      const names = await readdir(d.candidates).catch(() => [] as string[]);
      type Hit = { at: string; sessionId: string };
      const hits: Hit[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        try {
          const cand = JSON.parse(
            await readFile(path.join(d.candidates, name), "utf8"),
          ) as InspirationCandidate;
          if (cand.status === "accepted" && cand.appliedWorkKey === workKey) {
            hits.push({
              at: cand.acceptedAt || cand.updatedAt || cand.createdAt,
              sessionId: cand.sessionId,
            });
          }
        } catch {
          /* skip */
        }
      }
      hits.sort((a, b) => (b.at || "").localeCompare(a.at || ""));
      const seen = new Set<string>();
      const cardIds: string[] = [];
      for (const h of hits) {
        try {
          const s = await InspirationPort.getSession(paths, h.sessionId);
          for (const id of s.cardIds) {
            if (seen.has(id)) continue;
            seen.add(id);
            cardIds.push(id);
            if (cardIds.length >= limit) break;
          }
        } catch {
          /* skip */
        }
        if (cardIds.length >= limit) break;
      }
      if (cardIds.length > 0) {
        const cards: TechniqueCard[] = [];
        for (const id of cardIds) {
          try {
            const card = await LibraryPort.getCard(paths, id);
            if (card.status === "accepted") cards.push(card);
          } catch {
            /* skip */
          }
        }
        if (cards.length > 0) {
          return {
            cards,
            source: "inspire_apply",
            note: `作品「${workKey}」最近灵感 apply 绑定的技法卡（${cards.length}）`,
            cardIds: cards.map((c) => c.id),
          };
        }
      }
    }

    const genre = String(opts.genre ?? "").trim();
    if (genre) {
      const rows = await LibraryPort.searchCards(paths, genre);
      const cards: TechniqueCard[] = [];
      for (const row of rows.slice(0, limit)) {
        try {
          cards.push(await LibraryPort.getCard(paths, row.id));
        } catch {
          /* skip */
        }
      }
      if (cards.length > 0) {
        return {
          cards,
          source: "genre_tags",
          note: `按题材/标签「${genre}」检索（${cards.length}）`,
          cardIds: cards.map((c) => c.id),
        };
      }
    }

    return {
      cards: [],
      source: "none",
      note: "未绑定技法卡（可传 card_ids，或先 inspire_accept apply 到本作品）",
      cardIds: [],
    };
  },

  /**
   * Markdown section for chapter_brief.
   * lean：只主注 craft（写法+状态）；mind 不整段灌句式。
   */
  formatCardsSection(
    cards: TechniqueCard[],
    meta: { source: string; note: string; lean?: boolean },
  ): string {
    const lean = Boolean(meta.lean);
    const craftCards = cards.filter((c) => coerceAxis(c) === "craft");
    const mindCards = cards.filter((c) => coerceAxis(c) === "mind");
    const inject = lean ? craftCards : cards;
    const title = lean
      ? "## 技法卡（lean · craft 写法+状态）"
      : "## 拆书库卡（craft + mind）";
    if (inject.length === 0) {
      const extra =
        lean && mindCards.length > 0
          ? `（已绑定 ${mindCards.length} 张 mind，lean 正文不灌规划卡；设定/纲走 inspire。）`
          : "（无卡注入；方法包只管流程纪律。）";
      return [title, meta.note, extra].join("\n");
    }
    const thinFeel = craftCards.filter((c) => !c.humanFeel).length;
    const lines = [
      title,
      `- 来源：${meta.note}`,
      `- 来源码：${meta.source}`,
      `- 分轴：craft ${craftCards.length} · mind ${mindCards.length}` +
        (lean ? "（lean 只注入 craft）" : ""),
      lean
        ? "- 模式：lean（写法/状态/毛边/fail + continueWhy；无机制/分析；mind 不灌）"
        : "- 模式：full",
      craftCards.length === 0
        ? "- （无 craft）"
        : thinFeel > 0
          ? `- ⚠️ ${thinFeel}/${craftCards.length} 张 craft 写法/状态偏薄`
          : `- ✓ craft 均含 humanFeel`,
      lean
        ? "先吃写法与场面状态；mind 供规划，不灌进 lean 当句式。"
        : "craft 吃写法；mind 吃创作思维。方法包 ≠ 本区。",
      "",
    ];
    for (const c of inject) {
      lines.push(lean ? formatTechniqueCardBlockLean(c) : formatTechniqueCardBlock(c));
      lines.push("");
    }
    if (lean && mindCards.length > 0) {
      lines.push(
        `- （另有 mind ${mindCards.length} 张未注入 lean：${mindCards.map((c) => c.id).join("、")}）`,
      );
    }
    return lines.join("\n").trimEnd();
  },
};


