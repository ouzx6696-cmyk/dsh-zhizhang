/**
 * LibraryPort — 拆书库支柱（live）。
 * User submits a novel → dissect brief → AI stages cards → explicit accept → searchable.
 * 0.7.0 双轴：axis=craft|mind。craft→正文 brief；mind→inspire 设定/章纲。
 * Technique cards ≠ MethodRegistry. 拒收百科/梗概/声纹/人设墙。
 * 兼容：旧卡无 axis 时按 humanFeel/mind 推断；kind 降为次标签。
 */
import { mkdir, readFile, access } from "node:fs/promises";
import path from "node:path";
import { ZhizhangError } from "../errors.js";
import {
  atomicWrite,
  sessionCwd,
  type StoragePaths,
  withLock,
} from "../store.js";
import { MethodRegistry } from "./methods.js";
import { QualityPolicy } from "./quality-policy.js";

export type PillarStatus = "live" | "reserved";

export interface LibraryCapability {
  id: string;
  title: string;
  ready: boolean;
}

export interface MechanismSpec {
  name: string;
  experience: string;
  rebuild: string;
  discard: string;
  failWhen: string;
}

/** 双轴：写作技法 | 创作思维（0.7.0 硬字段） */
export type CardAxis = "craft" | "mind";

/**
 * 活人证据（归 craft）：作家写法 + 场面角色状态。
 * characterState = 场面状态（写法+状态）；非台词范本/人设墙。
 */
export interface HumanFeelSpec {
  /** 作家写法：叙述口吻、场面取舍、信息怎么漏、节奏/小物 */
  writerCraft: string;
  /** 写法证据出处 / 阅读范围 */
  craftRange: string;
  /** 这一刻场面状态（慌、赖皮、在算账…），非声纹、非人设清单 */
  characterState: string;
  /** 状态落到纸上的手法（身体、偏题、半截话等）——写法层 */
  stateOnPage: string;
  /** 重造到新作时允许的毛边 */
  allowedEdges: string;
  /** 写成齐整范文腔 / 说明书腔即失败 */
  failAsTemplate: string;
}

/**
 * 书感/续写面（归 craft · 方案 A）：章级「继续为何」。
 * 不是完整创作思维；长线债/换压见 MindSpec。
 */
export interface BookCraftSpec {
  continueWhy: string;
  adjacentChange?: string;
  failAsShortStory?: string;
}

/**
 * 创作思维证据（归 mind）：指向设定 / 章纲 / 卷纲，不是句级口吻。
 */
export interface MindSpec {
  /** 卖点如何进能力与代价 */
  sellIntoCost: string;
  /** 信息如何分期交付 */
  infoStaging: string;
  /** 人物关系如何当压力机 */
  pressureMachine: string;
  /** 长线债与换压（章/卷） */
  debtAndSwap: string;
  /** 读者合同如何立 */
  readerContract: string;
  /** 写成百科/设定表/梗概即失败 */
  failAsEncyclopedia: string;
}

/** 旧版 AnalysisHandoff 四项（可选；两轴可用） */
export interface AnalysisHandoff {
  purpose: string;
  experience: string;
  rebuild: string;
  discard: string;
}

/** 次标签（场面粒度）；axis=mind 才进创作思维轨 */
export type TechniqueCardKind = "craft" | "scene" | "book";

export interface TechniqueCard {
  schemaVersion: 1;
  id: string;
  title: string;
  sourceId: string;
  readingRange: string;
  /** 0.7.0 硬轴：craft | mind */
  axis: CardAxis;
  mechanisms: MechanismSpec[];
  /** craft：写法+状态 */
  humanFeel?: HumanFeelSpec;
  /** craft：章级续写面 */
  bookCraft?: BookCraftSpec;
  /** mind：创作思维 */
  mind?: MindSpec;
  handoff?: AnalysisHandoff;
  /** 可选次标签；≠ axis */
  kind?: TechniqueCardKind;
  body: string;
  tags: string[];
  status: "drafted" | "accepted";
  createdAt: string;
  updatedAt: string;
  acceptedAt?: string;
}

export interface LibrarySourceMeta {
  schemaVersion: 1;
  id: string;
  title: string;
  author: string;
  readingRange: string;
  excerptPath: string;
  charCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface LibraryIndex {
  schemaVersion: 1;
  sources: Array<{
    id: string;
    title: string;
    author: string;
    createdAt: string;
  }>;
  cards: Array<{
    id: string;
    title: string;
    sourceId: string;
    tags: string[];
    status: "drafted" | "accepted";
    updatedAt: string;
    /** 0.7.0；旧 index 可缺 */
    axis?: CardAxis;
  }>;
}

export type CardRow = LibraryIndex["cards"][number];

/** list / search 过滤：按书、按轴 */
export interface CardQueryOpts {
  status?: "accepted" | "drafted" | "all";
  /** 单本来源 */
  sourceId?: string;
  /** 多本来源（与 sourceId 并集） */
  sourceIds?: string[];
  /** 书名/作者子串（不区分大小写）→ 解析为 sourceId 集合 */
  sourceTitle?: string;
  /** craft | mind */
  axis?: CardAxis;
}

export interface ComboSuggestInput {
  /** 限制候选池到来源（可跨书；空=全库已采纳） */
  sourceIds?: string[];
  /** 书名/作者子串过滤候选池 */
  sourceTitle?: string;
  /** 技法张数 N（默认 2，夹在 1–8） */
  craftCount?: number;
  /** 主题检索：给 mind/craft 打分排序 */
  query?: string;
  /** 优先从这些 source 抽 mind；池内不够再回落 */
  preferMindSourceIds?: string[];
}

export interface ComboCardRef {
  id: string;
  title: string;
  sourceId: string;
  axis: CardAxis;
  tags: string[];
}

export interface ComboSuggestResult {
  ok: boolean;
  /** 恰好 1 mind + ≤N craft 的 id 列表（mind 在前） */
  cardIds: string[];
  mind: ComboCardRef | null;
  crafts: ComboCardRef[];
  warnings: string[];
  emptyReason?: string;
}

export interface StageCardInput {
  title: string;
  sourceId: string;
  readingRange?: string;
  /** craft | mind；缺则兼容推断 */
  axis?: CardAxis | string;
  mechanisms: MechanismSpec[];
  humanFeel?: HumanFeelSpec | Record<string, unknown>;
  bookCraft?: BookCraftSpec | Record<string, unknown>;
  mind?: MindSpec | Record<string, unknown>;
  handoff?: AnalysisHandoff | Record<string, unknown>;
  kind?: TechniqueCardKind | string;
  body: string;
  tags?: string[];
}

export interface StageCardResult {
  candId: string;
  title: string;
  warnings: string[];
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

function libraryDirs(paths: StoragePaths) {
  return {
    root: paths.library,
    sources: path.join(paths.library, "sources"),
    cards: path.join(paths.library, "cards"),
    candidates: path.join(paths.library, "candidates"),
    index: path.join(paths.library, "index.json"),
  };
}

async function emptyIndex(): Promise<LibraryIndex> {
  return { schemaVersion: 1, sources: [], cards: [] };
}

async function readIndex(paths: StoragePaths): Promise<LibraryIndex> {
  const { index } = libraryDirs(paths);
  if (!(await fileExists(index))) return emptyIndex();
  try {
    const raw = JSON.parse(await readFile(index, "utf8")) as LibraryIndex;
    return {
      schemaVersion: 1,
      sources: Array.isArray(raw.sources) ? raw.sources : [],
      cards: Array.isArray(raw.cards) ? raw.cards : [],
    };
  } catch {
    return emptyIndex();
  }
}

async function writeIndex(paths: StoragePaths, idx: LibraryIndex): Promise<void> {
  const { index } = libraryDirs(paths);
  await atomicWrite(index, JSON.stringify(idx, null, 2) + "\n");
}

function normalizeMechanism(raw: unknown, i: number): MechanismSpec {
  if (!raw || typeof raw !== "object") {
    throw new ZhizhangError("bad_mechanism", `mechanisms[${i}] 必须是对象`);
  }
  const m = raw as Record<string, unknown>;
  const name = String(m.name ?? "").trim();
  const experience = String(m.experience ?? "").trim();
  const rebuild = String(m.rebuild ?? "").trim();
  const discard = String(m.discard ?? "").trim();
  const failWhen = String(m.failWhen ?? "").trim();
  if (!name) throw new ZhizhangError("bad_mechanism", `mechanisms[${i}].name 不能为空`);
  if (!failWhen) throw new ZhizhangError("bad_mechanism", `mechanisms[${i}].failWhen 不能为空`);
  return {
    name,
    experience: experience || "（未填）",
    rebuild: rebuild || "（未填）",
    discard: discard || "（未填）",
    failWhen,
  };
}

/**
 * Normalize optional humanFeel. Missing block → soft warn, card still stages.
 * Accepts 0.6 writerCraft/characterState shape AND legacy voice/realness shape.
 * Never hard-reject for migration.
 */
export function normalizeHumanFeel(
  raw: unknown,
): { humanFeel?: HumanFeelSpec; warnings: string[] } {
  const warnings: string[] = [];
  if (raw == null) {
    warnings.push(
      "未填 humanFeel（活人证据）：兼容可过；新拆书请补 writerCraft / characterState / allowedEdges / failAsTemplate",
    );
    return { warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("humanFeel 须为对象，已忽略");
    return { warnings };
  }
  const h = raw as Record<string, unknown>;

  // Legacy fields (0.5.x)
  const legacyVoice = String(h.voice ?? "").trim();
  const legacyVoiceRange = String(h.voiceRange ?? h.voice_range ?? "").trim();
  const legacyRealness = String(h.realness ?? "").trim();

  let writerCraft = String(h.writerCraft ?? h.writer_craft ?? "").trim();
  let craftRange = String(h.craftRange ?? h.craft_range ?? "").trim();
  let characterState = String(
    h.characterState ?? h.character_state ?? "",
  ).trim();
  let stateOnPage = String(h.stateOnPage ?? h.state_on_page ?? "").trim();
  const allowedEdges = String(h.allowedEdges ?? h.allowed_edges ?? "").trim();
  const failAsTemplate = String(
    h.failAsTemplate ?? h.fail_as_template ?? "",
  ).trim();

  // Migrate legacy → new
  if (!writerCraft && legacyRealness) {
    writerCraft = legacyRealness;
    warnings.push("已将旧 humanFeel.realness 迁为 writerCraft（写法）");
  }
  if (!craftRange && legacyVoiceRange) {
    craftRange = legacyVoiceRange;
  }
  if (!stateOnPage && legacyVoice) {
    stateOnPage = legacyVoice;
    warnings.push(
      "已将旧 humanFeel.voice 迁为 stateOnPage（落纸手法证据）",
    );
  }
  if (legacyVoice && !h.writerCraft && !h.characterState) {
    warnings.push(
      "检测到旧口径 voice/realness：请改填 writerCraft（作家写法）+ characterState（角色状态）",
    );
  }

  if (!writerCraft) {
    warnings.push("humanFeel.writerCraft 为空：未写作家写法（场面取舍/信息怎么漏/节奏或小物等）");
  }
  if (!characterState) {
    warnings.push("humanFeel.characterState 为空：未写这一刻角色状态（非声纹）");
  }
  if (!stateOnPage) {
    warnings.push("humanFeel.stateOnPage 为空：未写状态落到纸上的手法");
  }
  if (!allowedEdges) {
    warnings.push("humanFeel.allowedEdges 为空：未写允许的毛边");
  }
  if (!failAsTemplate) {
    warnings.push(
      "humanFeel.failAsTemplate 为空：建议写「写成齐整范文腔即失败」",
    );
  }

  return {
    humanFeel: {
      writerCraft: writerCraft || "（未填）",
      craftRange: craftRange || "（见 readingRange）",
      characterState: characterState || "（未填）",
      stateOnPage: stateOnPage || "（未填）",
      allowedEdges: allowedEdges || "（未填）",
      failAsTemplate:
        failAsTemplate || "写成齐整范文腔、说明书腔、任务句连排即失败",
    },
    warnings,
  };
}


/** Coerce on-disk / in-memory humanFeel that may still be legacy voice shape. */
export function coerceHumanFeel(raw: HumanFeelSpec | Record<string, unknown> | undefined): HumanFeelSpec | undefined {
  if (!raw || typeof raw !== "object") return undefined;
  const h = raw as Record<string, unknown>;
  if (typeof h.writerCraft === "string" || typeof h.characterState === "string") {
    return {
      writerCraft: String(h.writerCraft ?? "").trim() || "（未填）",
      craftRange: String(h.craftRange ?? h.voiceRange ?? "").trim() || "（见 readingRange）",
      characterState: String(h.characterState ?? "").trim() || "（未填）",
      stateOnPage: String(h.stateOnPage ?? h.voice ?? "").trim() || "（未填）",
      allowedEdges: String(h.allowedEdges ?? "").trim() || "（未填）",
      failAsTemplate:
        String(h.failAsTemplate ?? "").trim() ||
        "写成齐整范文腔、说明书腔、任务句连排即失败",
    };
  }
  // pure legacy
  if (h.voice != null || h.realness != null || h.voiceRange != null) {
    return {
      writerCraft: String(h.realness ?? "").trim() || "（未填）",
      craftRange: String(h.voiceRange ?? "").trim() || "（见 readingRange）",
      characterState: "（旧卡未分状态）",
      stateOnPage: String(h.voice ?? "").trim() || "（未填）",
      allowedEdges: String(h.allowedEdges ?? "").trim() || "（未填）",
      failAsTemplate:
        String(h.failAsTemplate ?? "").trim() ||
        "写成齐整范文腔、说明书腔、任务句连排即失败",
    };
  }
  return undefined;
}

/** Format humanFeel for forge / brief / card_get. Missing → thin craft/state note. */
export function formatHumanFeelBlock(
  hf: HumanFeelSpec | Record<string, unknown> | undefined,
): string {
  const c = coerceHumanFeel(hf as HumanFeelSpec | undefined);
  if (!c) {
    return [
      "⚠️ **写法/状态偏薄**：本卡无 humanFeel（旧卡或未填）。",
      "请补作家写法 + 场面状态，或换一张有人味的卡。",
      "- （缺 writerCraft / characterState / allowedEdges / failAsTemplate）",
    ].join("\n");
  }
  return [
    `- 作家写法（writerCraft）：${c.writerCraft}`,
    `- 出处范围（craftRange）：${c.craftRange}`,
    `- 角色状态（characterState）：${c.characterState}`,
    `- 落纸手法（stateOnPage）：${c.stateOnPage}`,
    `- 允许毛边（allowedEdges）：${c.allowedEdges}`,
    `- 范文腔失败（failAsTemplate）：${c.failAsTemplate}`,
  ].join("\n");
}

/**
 * Normalize optional bookCraft. Missing → soft warn; never hard-reject.
 */
export function normalizeBookCraft(
  raw: unknown,
): { bookCraft?: BookCraftSpec; warnings: string[] } {
  const warnings: string[] = [];
  if (raw == null) {
    warnings.push(
      "未填 bookCraft（继续证据）：兼容可过；新拆书请补 continueWhy / failAsShortStory",
    );
    return { warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("bookCraft 须为对象，已忽略");
    return { warnings };
  }
  const b = raw as Record<string, unknown>;
  const continueWhy = String(b.continueWhy ?? b.continue_why ?? "").trim();
  const adjacentChange = String(
    b.adjacentChange ?? b.adjacent_change ?? "",
  ).trim();
  const failAsShortStory = String(
    b.failAsShortStory ?? b.fail_as_short_story ?? "",
  ).trim();

  if (!continueWhy) {
    warnings.push("bookCraft.continueWhy 为空：未写收束后为何还想翻");
  }
  if (!failAsShortStory) {
    warnings.push(
      "bookCraft.failAsShortStory 为空：建议写「写成独立短篇闭环即失败」",
    );
  }

  const bookCraft: BookCraftSpec = {
    continueWhy: continueWhy || "（未填）",
  };
  if (adjacentChange) bookCraft.adjacentChange = adjacentChange;
  else warnings.push("bookCraft.adjacentChange 未填：可选，建议写相邻单元变了什么");
  bookCraft.failAsShortStory =
    failAsShortStory || "写成独立短篇闭环、章末无书债、同骨架再演示设定即失败";

  return { bookCraft, warnings };
}

/** Format bookCraft for forge / brief / card_get. */
export function formatBookCraftBlock(bc: BookCraftSpec | undefined): string {
  if (!bc) {
    return [
      "⚠️ **书感偏薄**：本卡无 bookCraft（旧卡或未填）。",
      "请补「收束后为何还想翻」与相邻压力变化。",
      "- （缺 continueWhy / adjacentChange / failAsShortStory）",
    ].join("\n");
  }
  const lines = [
    `- 继续为何（continueWhy）：${bc.continueWhy}`,
  ];
  if (bc.adjacentChange) {
    lines.push(`- 相邻变化（adjacentChange）：${bc.adjacentChange}`);
  } else {
    lines.push("- 相邻变化（adjacentChange）：（未填）");
  }
  lines.push(
    `- 短篇闭环失败（failAsShortStory）：${bc.failAsShortStory ?? "（未填）"}`,
  );
  return lines.join("\n");
}

/**
 * Normalize optional handoff four-tuple. Missing → soft warn only.
 */
export function normalizeHandoff(
  raw: unknown,
): { handoff?: AnalysisHandoff; warnings: string[] } {
  const warnings: string[] = [];
  if (raw == null) {
    warnings.push(
      "未填 handoff（purpose/experience/rebuild/discard）：可选；有助于交接",
    );
    return { warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("handoff 须为对象，已忽略");
    return { warnings };
  }
  const h = raw as Record<string, unknown>;
  const purpose = String(h.purpose ?? "").trim();
  const experience = String(h.experience ?? "").trim();
  const rebuild = String(h.rebuild ?? "").trim();
  const discard = String(h.discard ?? "").trim();
  if (!purpose || !experience || !rebuild || !discard) {
    warnings.push("handoff 四项有空：已填默认占位");
  }
  return {
    handoff: {
      purpose: purpose || "（未填）",
      experience: experience || "（未填）",
      rebuild: rebuild || "（未填）",
      discard: discard || "（未填；须丢弃原作剧情与人名）",
    },
    warnings,
  };
}

export function formatHandoffBlock(h: AnalysisHandoff | undefined): string {
  if (!h) return "（无 handoff）";
  return [
    `- purpose：${h.purpose}`,
    `- experience：${h.experience}`,
    `- rebuild：${h.rebuild}`,
    `- discard：${h.discard}`,
  ].join("\n");
}

const KIND_SET = new Set<string>(["craft", "scene", "book", "voice"]); // voice=legacy alias → craft

export function normalizeKind(
  raw: unknown,
): { kind?: TechniqueCardKind; warnings: string[] } {
  const warnings: string[] = [];
  if (raw == null || raw === "") {
    return { warnings };
  }
  let k = String(raw).trim().toLowerCase();
  if (k === "voice") {
    warnings.push("kind=voice 已迁为 craft（写法卡；非角色声纹）");
    k = "craft";
  }
  if (k !== "craft" && k !== "scene" && k !== "book") {
    warnings.push(`kind 无效「${raw}」（须 craft|scene|book；旧 voice→craft），已忽略`);
    return { warnings };
  }
  return { kind: k as TechniqueCardKind, warnings };
}

/**
 * Normalize / infer axis. Missing → soft warn + default craft (compat).
 * kind=book never becomes mind.
 */
export function normalizeAxis(
  raw: unknown,
  hints: {
    hasHumanFeel?: boolean;
    hasMind?: boolean;
    hasBookCraft?: boolean;
    tags?: string[];
    kind?: string;
  } = {},
): { axis: CardAxis; warnings: string[] } {
  const warnings: string[] = [];
  const rawStr = raw == null || raw === "" ? "" : String(raw).trim().toLowerCase();
  if (rawStr === "craft" || rawStr === "mind") {
    return { axis: rawStr, warnings };
  }
  if (rawStr) {
    warnings.push(`axis 无效「${raw}」（须 craft|mind），已按证据推断`);
  }
  const tags = (hints.tags ?? []).map((t) => String(t).toLowerCase());
  const tagMind = tags.some((t) =>
    t === "mind" || t.includes("思维") || t.includes("创作思维") || t === "planning",
  );
  if (hints.hasMind || tagMind) {
    if (!rawStr) warnings.push("未声明 axis：按 mind 证据推断为 mind");
    return { axis: "mind", warnings };
  }
  if (hints.hasHumanFeel || hints.hasBookCraft) {
    if (!rawStr) warnings.push("未声明 axis：按 humanFeel/bookCraft 推断为 craft");
    return { axis: "craft", warnings };
  }
  // kind is secondary — never promote kind=book to mind
  if (!rawStr) warnings.push("未声明 axis：已默认 craft（兼容旧卡）");
  return { axis: "craft", warnings };
}

/** Coerce on-disk card axis for reads (never throw). */
export function coerceAxis(card: Partial<TechniqueCard> | Record<string, unknown>): CardAxis {
  const raw = (card as TechniqueCard).axis;
  if (raw === "craft" || raw === "mind") return raw;
  const mind = (card as TechniqueCard).mind;
  if (mind && typeof mind === "object") return "mind";
  const hf = (card as TechniqueCard).humanFeel;
  if (hf && typeof hf === "object") return "craft";
  const tags = Array.isArray((card as TechniqueCard).tags)
    ? (card as TechniqueCard).tags!
    : [];
  if (tags.some((t) => /mind|思维|planning/i.test(String(t)))) return "mind";
  return "craft";
}

/**
 * Normalize optional mind block. Missing → soft warn for mind-axis callers.
 */
export function normalizeMind(
  raw: unknown,
): { mind?: MindSpec; warnings: string[] } {
  const warnings: string[] = [];
  if (raw == null) {
    warnings.push(
      "未填 mind（创作思维）：mind 轴请补 sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract / failAsEncyclopedia",
    );
    return { warnings };
  }
  if (typeof raw !== "object" || Array.isArray(raw)) {
    warnings.push("mind 须为对象，已忽略");
    return { warnings };
  }
  const m = raw as Record<string, unknown>;
  const sellIntoCost = String(m.sellIntoCost ?? m.sell_into_cost ?? "").trim();
  const infoStaging = String(m.infoStaging ?? m.info_staging ?? "").trim();
  const pressureMachine = String(m.pressureMachine ?? m.pressure_machine ?? "").trim();
  const debtAndSwap = String(m.debtAndSwap ?? m.debt_and_swap ?? "").trim();
  const readerContract = String(m.readerContract ?? m.reader_contract ?? "").trim();
  const failAsEncyclopedia = String(
    m.failAsEncyclopedia ?? m.fail_as_encyclopedia ?? "",
  ).trim();

  if (!sellIntoCost) warnings.push("mind.sellIntoCost 为空：未写卖点如何进能力/代价");
  if (!infoStaging) warnings.push("mind.infoStaging 为空：未写信息分期");
  if (!pressureMachine) warnings.push("mind.pressureMachine 为空：未写关系压力机");
  if (!debtAndSwap) warnings.push("mind.debtAndSwap 为空：未写长线债与换压");
  if (!readerContract) warnings.push("mind.readerContract 为空：未写读者合同如何立");
  if (!failAsEncyclopedia) {
    warnings.push("mind.failAsEncyclopedia 为空：建议写「写成百科/设定表/梗概即失败」");
  }

  return {
    mind: {
      sellIntoCost: sellIntoCost || "（未填）",
      infoStaging: infoStaging || "（未填）",
      pressureMachine: pressureMachine || "（未填）",
      debtAndSwap: debtAndSwap || "（未填）",
      readerContract: readerContract || "（未填）",
      failAsEncyclopedia:
        failAsEncyclopedia || "写成世界观百科、剧情梗概、设定表堆砌即失败",
    },
    warnings,
  };
}

export function formatMindBlock(mind: MindSpec | undefined): string {
  if (!mind) {
    return [
      "⚠️ **创作思维偏薄**：本卡无 mind 块。",
      "请补卖点进代价 / 信息分期 / 压力机 / 长线债 / 读者合同。",
      "- （缺 sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract）",
    ].join("\n");
  }
  return [
    `- 卖点→代价（sellIntoCost）：${mind.sellIntoCost}`,
    `- 信息分期（infoStaging）：${mind.infoStaging}`,
    `- 压力机（pressureMachine）：${mind.pressureMachine}`,
    `- 长线债/换压（debtAndSwap）：${mind.debtAndSwap}`,
    `- 读者合同（readerContract）：${mind.readerContract}`,
    `- 百科失败（failAsEncyclopedia）：${mind.failAsEncyclopedia}`,
  ].join("\n");
}

/** Soft warn if characterState looks like a personality wall. */
export function warnCharacterStateWall(state: string | undefined): string[] {
  const s = String(state ?? "").trim();
  if (!s || s === "（未填）") return [];
  const warnings: string[] = [];
  if (
    /性格[：:]/.test(s) ||
    /人设[：:]/.test(s) ||
    /(MBTI|INFP|INTJ|ENFP)/i.test(s) ||
    /爱好[：:].*讨厌[：:]/.test(s) ||
    /(善良|勇敢|聪明|傲娇).{0,8}(善良|勇敢|聪明|傲娇)/.test(s)
  ) {
    warnings.push(
      "characterState 疑似人设墙：应写这一刻场面状态（慌/赖皮/算账），非固定性格清单",
    );
  }
  return warnings;
}

/**
 * Strip negation / disclaimer contexts that mention 声纹 without teaching voice.
 * Fixes false positive on「非声纹」「≠角色声纹」etc. (0.10.0).
 */
export function neutralizeVoiceNegations(text: string): string {
  return String(text ?? "").replace(
    /非声纹|禁止声纹|勿当[^。\n]{0,16}声纹|不是[^。\n]{0,12}声纹|≠[^。\n]{0,10}声纹|（非声纹）|\(非声纹\)|非角色声纹|勿学嘴|勿[^。\n]{0,8}声纹背诵|拒收[^。\n]{0,8}声纹|禁止[^。\n]{0,8}声纹|勿灌角色声纹|不灌角色声纹/g,
    " ",
  );
}

/** Collect short snippets around regex hits for reject receipts. */
export function collectAdmitHits(hay: string, re: RegExp, limit = 3): string[] {
  const flags = re.flags.includes("g") ? re.flags : `${re.flags}g`;
  const g = new RegExp(re.source, flags);
  const hits: string[] = [];
  let m: RegExpExecArray | null;
  while ((m = g.exec(hay)) !== null) {
    const start = Math.max(0, m.index - 10);
    const end = Math.min(hay.length, m.index + m[0].length + 10);
    const snip = hay.slice(start, end).replace(/\s+/g, " ").trim();
    if (snip) hits.push(snip);
    if (hits.length >= limit) break;
  }
  return hits;
}

function formatAdmitReject(kind: string, hits: string[], fix: string): string {
  const shown = hits.length ? hits.map((h) => `「${h}」`).join(" ") : "（未截到片段）";
  return `拒收：${kind}。命中：${shown}。改法：${fix}`;
}

/**
 * Admission: hard-reject obvious encyclopedia / voice-teaching / plot-summary cards.
 * Soft path otherwise. Voice checks ignore negation disclaimers (非声纹…).
 */
export function admitCardContent(input: {
  title: string;
  body: string;
  axis: CardAxis;
  mechanisms: MechanismSpec[];
}): { hardReject?: string; warnings: string[] } {
  const warnings: string[] = [];
  const title = input.title.trim();
  const body = input.body.trim();
  const raw = `${title}\n${body}`;
  const hay = raw.toLowerCase();
  const mechNames = input.mechanisms.map((m) => m.name).join(" ");

  // Hard reject patterns — voice: scrub negations first (避免「非声纹」假阳)
  const voiceHay = neutralizeVoiceNegations(raw);
  const voiceRe = /声纹|台词范本|角色口气正例|模仿.{0,8}对白|背诵.{0,8}台词|专属声音/;
  const voiceEnRe = /voice\s*sample|dialogue\s*template/i;
  const voiceTeach = voiceRe.test(voiceHay) || voiceEnRe.test(neutralizeVoiceNegations(hay));
  const encyclopediaRe = /世界观词条|设定百科|人物小传合集|名词解释表|原作专名对照/;
  const encyclopedia =
    encyclopediaRe.test(raw) ||
    (/^【?词条/.test(title) && /设定|世界观/.test(body));
  const plotRe = /全章复述|逐章剧情摘要|抄原作情节链/;
  const plotSummary =
    /^(剧情|情节)(梗概|大纲|复述)$/.test(title) ||
    (plotRe.test(raw) && !/不抄|禁止抄|丢弃原作/.test(body));

  if (voiceTeach) {
    const hits = [
      ...collectAdmitHits(voiceHay, voiceRe),
      ...collectAdmitHits(neutralizeVoiceNegations(hay), voiceEnRe),
    ].slice(0, 3);
    return {
      hardReject: formatAdmitReject(
        "角色声纹/台词范本不是创作技能（会污染创作 AI 气口）",
        hits,
        "删教嘴内容；若只是声明「非声纹/≠声纹」可保留，把场面状态写进 characterState。",
      ),
      warnings,
    };
  }
  if (encyclopedia) {
    const hits = collectAdmitHits(raw, encyclopediaRe);
    if (/^【?词条/.test(title)) hits.unshift(title.slice(0, 24));
    return {
      hardReject: formatAdmitReject(
        "世界观百科/词条不是可迁移创作技能",
        hits.slice(0, 3),
        "改写成可迁移的写法或创作思维（mechanism/mind）。",
      ),
      warnings,
    };
  }
  if (plotSummary) {
    const hits = /^(剧情|情节)/.test(title)
      ? [title]
      : collectAdmitHits(raw, plotRe);
    return {
      hardReject: formatAdmitReject(
        "剧情梗概/情节复述不是技法或创作思维",
        hits.slice(0, 3),
        "丢掉事件链复述；抽出可迁移的压力换/写法证据。",
      ),
      warnings,
    };
  }

  // Soft: axis mismatch hints
  if (input.axis === "craft") {
    if (/卷纲设计|世界观如何分期|能力代价飞轮/.test(`${title}${body}`) && !/写法|场面|落纸|节奏/.test(body)) {
      warnings.push("内容更像创作思维：建议改 axis=mind，或补场面写法证据");
    }
  } else {
    if (/半截话怎么写|递烟小物|叙述口吻/.test(`${title}${body}`) && !/能力|代价|分期|压力|读者合同/.test(body)) {
      warnings.push("内容更像写作技法：建议改 axis=craft，或补设定/纲向思维字段");
    }
  }

  if (/原作专名|卡塞尔学院|言灵体系词条/.test(mechNames)) {
    warnings.push("mechanisms.name 疑似原作名词词条：应迁过程/结构，不迁专名");
  }

  return { warnings };
}

/**
 * Full card inject block. Branches by axis.
 * craft: humanFeel + bookCraft + mechanisms
 * mind: mind + mechanisms（规划向）
 */
export function formatTechniqueCardBlock(card: TechniqueCard): string {
  const axis = coerceAxis(card);
  const mech = card.mechanisms
    .map(
      (m, i) =>
        `${i + 1}. **${m.name}**\n   - 体验：${m.experience}\n   - 重建：${m.rebuild}\n   - 可弃：${m.discard}\n   - 失败边界：${m.failWhen}`,
    )
    .join("\n");
  const kindLine = card.kind
    ? `- kind（次标签）：${card.kind}`
    : "- kind：（未标；≠ axis）";
  const axisLine = `- axis：**${axis}**（${axis === "craft" ? "写作技法→正文" : "创作思维→设定/纲"}）`;

  if (axis === "mind") {
    const thinMind = !card.mind;
    return [
      `### 创作思维卡 · ${card.title}（${card.id}）`,
      `- sourceId：${card.sourceId}`,
      axisLine,
      kindLine,
      `- tags：${card.tags.join("、") || "（无）"}`,
      `- readingRange：${card.readingRange}`,
      thinMind ? "- ⚠️ 创作思维偏薄：缺 mind" : "- ✓ 含 mind（创作思维）",
      "",
      "#### 创作思维（mind）——设定 / 章纲 / 卷纲",
      formatMindBlock(card.mind),
      "",
      ...(card.handoff
        ? ["#### handoff（交接四项）", formatHandoffBlock(card.handoff), ""]
        : []),
      "#### 可迁机制（结构/设计过程；不抄剧情）",
      mech || "（无机制）",
      "",
      "#### 分析正文",
      card.body,
    ].join("\n");
  }

  const thinFeel = !card.humanFeel;
  const thinBook = !card.bookCraft;
  const flags: string[] = [];
  flags.push(thinFeel ? "⚠️ 写法/状态偏薄：缺 humanFeel" : "✓ 含写法+状态");
  flags.push(thinBook ? "⚠️ 续写面偏薄：缺 bookCraft" : "✓ 含继续证据");
  return [
    `### 技法卡 · ${card.title}（${card.id}）`,
    `- sourceId：${card.sourceId}`,
    axisLine,
    kindLine,
    `- tags：${card.tags.join("、") || "（无）"}`,
    `- readingRange：${card.readingRange}`,
    `- ${flags.join(" · ")}`,
    "",
    "#### 活人证据（humanFeel）——作家写法 + 场面状态",
    formatHumanFeelBlock(card.humanFeel),
    "",
    "#### 续写面（bookCraft）——章级继续为何（≠ 完整创作思维）",
    formatBookCraftBlock(card.bookCraft),
    "",
    ...(card.handoff
      ? ["#### handoff（交接四项）", formatHandoffBlock(card.handoff), ""]
      : []),
    "#### 机制（次之；只迁技巧，不抄剧情）",
    mech || "（无机制）",
    "",
    "#### 分析正文",
    card.body,
  ].join("\n");
}

/**
 * Lean block for chapter_brief：**仅 craft**。
 * mind 卡返回一行提示，不整段灌句式/规划正文。
 */
export function formatTechniqueCardBlockLean(card: TechniqueCard): string {
  const axis = coerceAxis(card);
  if (axis === "mind") {
    return [
      `### 创作思维卡 · ${card.title}（${card.id}）· axis=mind`,
      "- （规划侧资产：不注入 lean 正文 brief 当句式范本；设定/纲请走 inspire_forge）",
    ].join("\n");
  }
  const hf = coerceHumanFeel(
    card.humanFeel as HumanFeelSpec | Record<string, unknown> | undefined,
  );
  const bc = card.bookCraft;
  const craft = hf?.writerCraft?.trim() || "（无写法 — 偏薄）";
  const state = hf?.characterState?.trim() || "（无状态 — 偏薄）";
  const onPage = hf?.stateOnPage?.trim();
  const edges = hf?.allowedEdges?.trim() || "（未填毛边）";
  const failVoice = hf?.failAsTemplate?.trim() || "写成齐整范文腔即失败";
  const continueWhy = bc?.continueWhy?.trim() || "（无 continueWhy）";
  const adjacent = bc?.adjacentChange?.trim();
  const lines = [
    `### 技法卡 · ${card.title}（${card.id}）· axis=craft`,
    `- 写法：${craft}`,
    `- 状态：${state}`,
  ];
  if (onPage) lines.push(`- 落纸手法：${onPage}`);
  lines.push(`- 毛边：${edges}`, `- 范文失败：${failVoice}`, `- 继续：${continueWhy}`);
  if (adjacent) lines.push(`- 相邻换戏：${adjacent}`);
  return lines.join("\n");
}

async function resolveSourceIdFilter(
  paths: StoragePaths,
  opts: Pick<CardQueryOpts, "sourceId" | "sourceIds" | "sourceTitle">,
): Promise<Set<string> | null> {
  const ids = new Set<string>();
  let active = false;
  const one = String(opts.sourceId ?? "").trim();
  if (one) {
    active = true;
    ids.add(one);
  }
  if (Array.isArray(opts.sourceIds)) {
    for (const raw of opts.sourceIds) {
      const id = String(raw ?? "").trim();
      if (id) {
        active = true;
        ids.add(id);
      }
    }
  }
  const titleQ = String(opts.sourceTitle ?? "").trim().toLowerCase();
  if (titleQ) {
    active = true;
    const idx = await readIndex(paths);
    for (const s of idx.sources) {
      const hay = `${s.title} ${s.author ?? ""}`.toLowerCase();
      if (hay.includes(titleQ)) ids.add(s.id);
    }
  }
  return active ? ids : null;
}

async function filterCardRows(
  paths: StoragePaths,
  rows: CardRow[],
  opts: CardQueryOpts,
): Promise<CardRow[]> {
  let out = rows;
  const status = opts.status ?? "accepted";
  if (status !== "all") {
    out = out.filter((c) => c.status === status);
  }
  const sourceSet = await resolveSourceIdFilter(paths, opts);
  if (sourceSet) {
    out = out.filter((c) => sourceSet.has(c.sourceId));
  }
  if (opts.axis === "craft" || opts.axis === "mind") {
    const want = opts.axis;
    const kept: CardRow[] = [];
    for (const row of out) {
      let axis = row.axis;
      if (axis !== "craft" && axis !== "mind") {
        try {
          const card = await LibraryPort.getCard(paths, row.id);
          axis = coerceAxis(card);
        } catch {
          axis = "craft";
        }
      }
      if (axis === want) kept.push({ ...row, axis });
    }
    out = kept;
  }
  return out;
}

function comboScore(
  row: CardRow,
  query: string,
  deepHay?: string,
): number {
  const q = query.trim().toLowerCase();
  if (!q) {
    const t = Date.parse(row.updatedAt);
    return Number.isFinite(t) ? t / 1e12 : 0;
  }
  let score = 0;
  const title = row.title.toLowerCase();
  const tags = row.tags.join(" ").toLowerCase();
  if (title.includes(q)) score += 100;
  if (tags.includes(q)) score += 40;
  if (`${row.sourceId} ${row.axis ?? ""}`.toLowerCase().includes(q)) score += 10;
  if (deepHay && deepHay.includes(q)) score += 25;
  // slight recency tie-break
  const t = Date.parse(row.updatedAt);
  if (Number.isFinite(t)) score += (t % 10000) / 1e6;
  return score;
}

export const LibraryPort = {
  id: "port.library" as const,
  status: "live" as PillarStatus,
  title: "拆书库",
  summary:
    "闭环第1段：交书→dissect（双轴 craft|mind）→stage→accept→combo。craft 交写作；mind 交灵感。可按书/轴检索；combo=1 mind+N craft 可跨书。≠ MethodRegistry。",

  capabilities(): LibraryCapability[] {
    return [
      { id: "import_source", title: "导入小说原文", ready: true },
      { id: "dissect", title: "拆书简报（craft 技法 | mind 创作思维）", ready: true },
      { id: "card_stage", title: "暂存卡（axis + craft/mind 证据）", ready: true },
      { id: "card_accept", title: "显式采纳入库", ready: true },
      { id: "card_search", title: "检索卡（按书/按轴/主题）", ready: true },
      { id: "card_get", title: "读取卡全文", ready: true },
      { id: "card_combo", title: "组合包：1 mind + N craft（可跨书）", ready: true },
    ];
  },

  async ensureLibrary(paths: StoragePaths): Promise<StoragePaths> {
    const d = libraryDirs(paths);
    await mkdir(d.sources, { recursive: true });
    await mkdir(d.cards, { recursive: true });
    await mkdir(d.candidates, { recursive: true });
    if (!(await fileExists(d.index))) {
      await writeIndex(paths, await emptyIndex());
    }
    return paths;
  },

  async importSource(
    paths: StoragePaths,
    input: {
      title: string;
      author?: string;
      text?: string;
      file?: string;
      readingRange?: string;
      exec?: unknown;
    },
  ): Promise<{ sourceId: string; charCount: number; excerptPath: string }> {
    await LibraryPort.ensureLibrary(paths);
    const title = String(input.title ?? "").trim();
    if (!title) throw new ZhizhangError("bad_args", "title 不能为空");

    let text = input.text ?? "";
    if ((!text || !String(text).trim()) && input.file) {
      const cwd = sessionCwd(input.exec);
      const filePath = path.isAbsolute(input.file)
        ? input.file
        : path.resolve(cwd, input.file);
      try {
        text = await readFile(filePath, "utf8");
      } catch {
        throw new ZhizhangError("file_read_failed", `无法读取文件：${input.file}`);
      }
    }
    text = String(text ?? "");
    if (!text.trim()) throw new ZhizhangError("empty_body", "导入正文不能为空（传 text 或 file）");

    const sourceId = newId("src");
    const d = libraryDirs(paths);
    const excerptPath = path.join(d.sources, `${sourceId}.txt`);
    const metaPath = path.join(d.sources, `${sourceId}.json`);
    const now = nowIso();
    const meta: LibrarySourceMeta = {
      schemaVersion: 1,
      id: sourceId,
      title,
      author: String(input.author ?? "").trim(),
      readingRange: String(input.readingRange ?? "").trim() || "全文（已导入）",
      excerptPath: `${sourceId}.txt`,
      charCount: text.length,
      createdAt: now,
      updatedAt: now,
    };

    await withLock(`library:${paths.library}`, async () => {
      await atomicWrite(excerptPath, text);
      await atomicWrite(metaPath, JSON.stringify(meta, null, 2) + "\n");
      const idx = await readIndex(paths);
      idx.sources.unshift({
        id: sourceId,
        title: meta.title,
        author: meta.author,
        createdAt: now,
      });
      await writeIndex(paths, idx);
    });

    return { sourceId, charCount: text.length, excerptPath: meta.excerptPath };
  },

  async getSource(
    paths: StoragePaths,
    sourceId: string,
  ): Promise<{ meta: LibrarySourceMeta; text: string }> {
    await LibraryPort.ensureLibrary(paths);
    const d = libraryDirs(paths);
    const metaPath = path.join(d.sources, `${sourceId}.json`);
    if (!(await fileExists(metaPath))) {
      throw new ZhizhangError("source_not_found", `找不到来源 ${sourceId}`);
    }
    const meta = JSON.parse(await readFile(metaPath, "utf8")) as LibrarySourceMeta;
    const textPath = path.join(d.sources, meta.excerptPath || `${sourceId}.txt`);
    const text = (await fileExists(textPath)) ? await readFile(textPath, "utf8") : "";
    return { meta, text };
  },

  async listSources(paths: StoragePaths): Promise<LibraryIndex["sources"]> {
    await LibraryPort.ensureLibrary(paths);
    return (await readIndex(paths)).sources;
  },

  async dissectBrief(
    paths: StoragePaths,
    sourceId: string,
    opts: { maxChars?: number; includeRecommend?: boolean } = {},
  ): Promise<string> {
    const { meta, text } = await LibraryPort.getSource(paths, sourceId);
    const maxChars = Math.max(800, Math.min(opts.maxChars ?? 12000, 80000));
    const excerpt =
      text.length <= maxChars
        ? text
        : text.slice(0, maxChars) + `\n\n…（已截断，原文共 ${text.length} 字；完整在 sources/${meta.excerptPath}）`;

    const analyze = MethodRegistry.get("analyze");
    const recommend =
      opts.includeRecommend !== false ? MethodRegistry.get("recommend") : undefined;

    const lines = [
      `# 拆书简报 · ${meta.title}${meta.author ? `（${meta.author}）` : ""}`,
      `- sourceId：${meta.id}`,
      `- readingRange：${meta.readingRange}`,
      `- 导入字数：${meta.charCount}`,
      "",
      "【工程说明】本工具只注入摘录与方法包，**不代写分析**。请你按双轴提炼后调用 zhizhang_library_card_stage；须 zhizhang_library_card_accept 才入库。",
      "",
      "## 双轴准入（只拆两样）",
      QualityPolicy.surfaceLine(),
      "",
      "### A. craft（写作技法）→ 指导 **具体写作** / chapter_brief",
      "算：场面取舍、信息怎么漏、节奏/小物、状态如何落纸、失败边界可迁到**另一本书的正文**。",
      "必填：`axis=craft` + **humanFeel**（writerCraft / craftRange / characterState / stateOnPage / allowedEdges / failAsTemplate）。",
      "另填：**bookCraft**（章级续写面 continueWhy / adjacentChange / failAsShortStory）——≠ 完整创作思维。",
      "`characterState` = 这一刻场面状态（慌/赖/在算）；写法+状态，不是人设墙或台词范本。",
      "",
      "### B. mind（创作思维）→ 指点 **设定层 / 章纲 / 卷纲**（inspire）",
      "算：能力与代价如何设计、冲突飞轮、信息分期、章/卷压力如何换、读者合同如何立——可迁到**另一本书的设定/纲**。",
      "必填：`axis=mind` + **mind**（sellIntoCost / infoStaging / pressureMachine / debtAndSwap / readerContract / failAsEncyclopedia）。",
      "mind 供 inspire 规划；lean 正文 brief 只吃 craft 写法+状态。",
      "",
      "### 准入样子（两轴）",
      "- craft：可迁到另一本书正文的写法与场面状态",
      "- mind：可迁到另一本书设定/纲的创作思维",
      "- kind 是场面粒度次标签（craft|scene|book），axis 才是双轴",
      "",
      "### 其它",
      "1. **mechanisms** 须含 `name` + `failWhen`；discard 写清丢弃的原作剧情与人名。",
      "2. 可选 **handoff**；可选 **kind**（`craft`|`scene`|`book`）——axis=mind 才进创作思维轨。",
      "3. 同一 source 宜拆：**多张 craft + 至少一张 mind**（完整迁技）；仅技法试写可后注明。",
      "4. 缺证据块时 stage 可软警告通过；准入硬闸拦百科表与台词范本教嘴。",
      "5. **质量面 · 毒点**：" + QualityPolicy.poisonPolicyLine(),
      "",
    ];
    if (analyze) {
      lines.push(MethodRegistry.formatForAgent(analyze));
      lines.push("");
    }
    if (recommend) {
      lines.push(MethodRegistry.formatForAgent(recommend));
      lines.push("");
    }
    lines.push("## 原文摘录");
    lines.push("<<<SOURCE");
    lines.push(excerpt);
    lines.push("SOURCE>>>");
    lines.push("");
    lines.push(
      "完成后：为每张卡填 axis +（craft: humanFeel+bookCraft | mind: mind）+ mechanisms + body，再 card_stage → card_accept。",
    );
    return lines.join("\n");
  },

  async stageCard(
    paths: StoragePaths,
    input: StageCardInput,
  ): Promise<StageCardResult> {
    await LibraryPort.ensureLibrary(paths);
    const title = String(input.title ?? "").trim();
    const body = String(input.body ?? "");
    const sourceId = String(input.sourceId ?? "").trim();
    if (!title) throw new ZhizhangError("bad_args", "title 不能为空");
    if (!sourceId) throw new ZhizhangError("bad_args", "sourceId 不能为空");
    if (!body.trim()) throw new ZhizhangError("empty_body", "卡 body 不能为空");
    if (!Array.isArray(input.mechanisms) || input.mechanisms.length === 0) {
      throw new ZhizhangError("bad_args", "mechanisms 至少一条");
    }
    await LibraryPort.getSource(paths, sourceId);

    const mechanisms = input.mechanisms.map((m, i) => normalizeMechanism(m, i));
    const { handoff, warnings: w3 } = normalizeHandoff(input.handoff);
    const { kind, warnings: w4 } = normalizeKind(input.kind);
    const tags = (input.tags ?? []).map((t) => String(t).trim()).filter(Boolean);

    // Peek presence before full normalize (avoid craft-warn spam on mind cards)
    const peekFeel = input.humanFeel != null;
    const peekBook = input.bookCraft != null;
    const peekMind = input.mind != null;

    const { axis, warnings: wAxis } = normalizeAxis(input.axis, {
      hasHumanFeel: peekFeel,
      hasMind: peekMind,
      hasBookCraft: peekBook,
      tags,
      kind,
    });

    let humanFeel: HumanFeelSpec | undefined;
    let bookCraft: BookCraftSpec | undefined;
    let mind: MindSpec | undefined;
    const w1: string[] = [];
    const w2: string[] = [];
    const wMind: string[] = [];

    if (axis === "craft" || peekFeel) {
      const r = normalizeHumanFeel(input.humanFeel);
      humanFeel = r.humanFeel;
      w1.push(...r.warnings);
    }
    if (axis === "craft" || peekBook) {
      const r = normalizeBookCraft(input.bookCraft);
      bookCraft = r.bookCraft;
      w2.push(...r.warnings);
    }
    if (axis === "mind" || peekMind) {
      const r = normalizeMind(input.mind);
      mind = r.mind;
      wMind.push(...r.warnings);
    }

    // kind=book must not be treated as mind — already enforced in normalizeAxis
    if (kind === "book" && axis === "craft") {
      // ok: book is scene-granularity tag
    }
    if (String(input.kind ?? "").trim().toLowerCase() === "book" && axis === "mind" && !mind) {
      wAxis.push("kind=book 不能冒充 mind：请填 mind 块或改 axis=craft");
    }

    const admit = admitCardContent({ title, body, axis, mechanisms });
    if (admit.hardReject) {
      throw new ZhizhangError("card_rejected", admit.hardReject);
    }

    const warnings = [
      ...wAxis,
      ...w1,
      ...w2,
      ...wMind,
      ...w3,
      ...w4,
      ...admit.warnings,
      ...warnCharacterStateWall(humanFeel?.characterState),
    ];

    // Axis-specific soft expectations
    if (axis === "craft" && !humanFeel) {
      warnings.push("axis=craft 但缺 humanFeel：新拆书应以写法+状态为硬产出目标");
    }
    if (axis === "mind" && !mind) {
      warnings.push("axis=mind 但缺 mind 块：新拆书应以创作思维六项为硬产出目标");
    }
    if (axis === "mind" && humanFeel && !mind) {
      warnings.push("mind 轴却只填了 humanFeel：人味属技法侧，请补 mind 或改 axis=craft");
    }
    if (axis === "craft" && mind && !humanFeel) {
      warnings.push("craft 轴却只填了 mind：创作思维请单独出 mind 卡，或改 axis=mind");
    }

    const candId = newId("lcand");
    const now = nowIso();
    const card: TechniqueCard = {
      schemaVersion: 1,
      id: candId,
      title,
      sourceId,
      readingRange: String(input.readingRange ?? "").trim() || "见拆书简报",
      axis,
      mechanisms,
      body: body.trim(),
      tags,
      status: "drafted",
      createdAt: now,
      updatedAt: now,
    };
    if (humanFeel) card.humanFeel = humanFeel;
    if (bookCraft) card.bookCraft = bookCraft;
    if (mind) card.mind = mind;
    if (handoff) card.handoff = handoff;
    if (kind) card.kind = kind;

    const d = libraryDirs(paths);
    await atomicWrite(
      path.join(d.candidates, `${candId}.json`),
      JSON.stringify(card, null, 2) + "\n",
    );
    return { candId, title, warnings };
  },

  async acceptCard(
    paths: StoragePaths,
    candId: string,
  ): Promise<{ cardId: string; title: string }> {
    await LibraryPort.ensureLibrary(paths);
    const d = libraryDirs(paths);
    const candPath = path.join(d.candidates, `${candId}.json`);
    if (!(await fileExists(candPath))) {
      throw new ZhizhangError("candidate_not_found", `找不到技法卡候选 ${candId}`);
    }
    const staged = JSON.parse(await readFile(candPath, "utf8")) as TechniqueCard;
    if (!staged.body?.trim()) {
      throw new ZhizhangError("empty_body", "候选 body 为空，拒绝采纳");
    }

    const cardId = newId("card");
    const now = nowIso();
    const card: TechniqueCard = {
      ...staged,
      id: cardId,
      status: "accepted",
      updatedAt: now,
      acceptedAt: now,
    };

    await withLock(`library:${paths.library}`, async () => {
      await atomicWrite(path.join(d.cards, `${cardId}.json`), JSON.stringify(card, null, 2) + "\n");
      const idx = await readIndex(paths);
      idx.cards.unshift({
        id: cardId,
        title: card.title,
        sourceId: card.sourceId,
        tags: card.tags,
        status: "accepted",
        updatedAt: now,
        axis: coerceAxis(card),
      });
      await writeIndex(paths, idx);
    });

    return { cardId, title: card.title };
  },

  async listCards(
    paths: StoragePaths,
    opts: CardQueryOpts = {},
  ): Promise<CardRow[]> {
    await LibraryPort.ensureLibrary(paths);
    const idx = await readIndex(paths);
    return filterCardRows(paths, idx.cards, {
      status: opts.status ?? "accepted",
      sourceId: opts.sourceId,
      sourceIds: opts.sourceIds,
      sourceTitle: opts.sourceTitle,
      axis: opts.axis,
    });
  },

  async searchCards(
    paths: StoragePaths,
    query: string,
    opts: CardQueryOpts = {},
  ): Promise<CardRow[]> {
    await LibraryPort.ensureLibrary(paths);
    const q = String(query ?? "").trim().toLowerCase();
    const hasFilter = Boolean(
      opts.sourceId ||
        (opts.sourceIds && opts.sourceIds.length) ||
        opts.sourceTitle ||
        opts.axis,
    );
    if (!q && !hasFilter) {
      throw new ZhizhangError("bad_args", "query 不能为空（或提供 source/axis 过滤）");
    }
    const idx = await readIndex(paths);
    const pool = await filterCardRows(paths, idx.cards, {
      status: opts.status ?? "accepted",
      sourceId: opts.sourceId,
      sourceIds: opts.sourceIds,
      sourceTitle: opts.sourceTitle,
      axis: opts.axis,
    });
    if (!q) return pool;
    const hits: CardRow[] = [];
    for (const row of pool) {
      const hay = `${row.title} ${row.tags.join(" ")} ${row.sourceId} ${row.axis ?? ""}`.toLowerCase();
      if (hay.includes(q)) {
        hits.push(row);
        continue;
      }
      try {
        const card = await LibraryPort.getCard(paths, row.id);
        const axis = coerceAxis(card);
        const coerced = coerceHumanFeel(
          card.humanFeel as HumanFeelSpec | Record<string, unknown> | undefined,
        );
        const hf = coerced
          ? `${coerced.writerCraft} ${coerced.characterState} ${coerced.stateOnPage} ${coerced.allowedEdges} ${coerced.failAsTemplate}`
          : "";
        const bc = card.bookCraft
          ? `${card.bookCraft.continueWhy} ${card.bookCraft.adjacentChange ?? ""} ${card.bookCraft.failAsShortStory ?? ""}`
          : "";
        const md = card.mind
          ? `${card.mind.sellIntoCost} ${card.mind.infoStaging} ${card.mind.pressureMachine} ${card.mind.debtAndSwap} ${card.mind.readerContract}`
          : "";
        const kindTag = card.kind ?? "";
        const deep =
          `${card.body} ${card.mechanisms.map((m) => `${m.name} ${m.failWhen} ${m.rebuild}`).join(" ")} ${hf} ${bc} ${md} ${kindTag} ${axis}`.toLowerCase();
        if (deep.includes(q)) hits.push({ ...row, axis });
      } catch {
        /* skip */
      }
    }
    return hits;
  },

  /**
   * 推荐组合包：恰好 1 mind + 最多 N craft（可跨 source）。
   * 缺 mind → ok=false + emptyReason（不抛，便于产品面展示）。
   */
  async suggestCombo(
    paths: StoragePaths,
    input: ComboSuggestInput = {},
  ): Promise<ComboSuggestResult> {
    await LibraryPort.ensureLibrary(paths);
    const warnings: string[] = [];
    const nRaw = input.craftCount ?? 2;
    const craftCount = Math.max(1, Math.min(8, Math.floor(Number(nRaw) || 2)));
    if (input.craftCount != null && Number(input.craftCount) !== craftCount) {
      warnings.push(`craftCount 已夹紧为 ${craftCount}（允许 1–8）`);
    }
    const query = String(input.query ?? "").trim();
    const preferMind = new Set(
      (input.preferMindSourceIds ?? []).map((x) => String(x).trim()).filter(Boolean),
    );

    const pool = await LibraryPort.listCards(paths, {
      status: "accepted",
      sourceIds: input.sourceIds,
      sourceTitle: input.sourceTitle,
    });

    const minds: CardRow[] = [];
    const crafts: CardRow[] = [];
    for (const row of pool) {
      let axis = row.axis;
      if (axis !== "craft" && axis !== "mind") {
        try {
          axis = coerceAxis(await LibraryPort.getCard(paths, row.id));
        } catch {
          axis = "craft";
        }
      }
      const normalized = { ...row, axis };
      if (axis === "mind") minds.push(normalized);
      else crafts.push(normalized);
    }

    if (minds.length === 0) {
      return {
        ok: false,
        cardIds: [],
        mind: null,
        crafts: [],
        warnings,
        emptyReason:
          "候选池无 mind 卡：请先拆/采纳创作思维卡，或放宽 source 过滤；仅技法试写请 inspire_start(craft_only=true) 自选 craft",
      };
    }

    // score minds
    const mindScored: Array<{ row: CardRow; score: number }> = [];
    for (const row of minds) {
      let deep = "";
      try {
        const card = await LibraryPort.getCard(paths, row.id);
        if (card.mind) {
          deep =
            `${card.mind.sellIntoCost} ${card.mind.infoStaging} ${card.mind.pressureMachine} ${card.mind.debtAndSwap} ${card.mind.readerContract} ${card.body}`.toLowerCase();
        } else {
          deep = card.body.toLowerCase();
        }
      } catch {
        /* ignore */
      }
      let score = comboScore(row, query, deep);
      if (preferMind.size && preferMind.has(row.sourceId)) score += 50;
      mindScored.push({ row, score });
    }
    mindScored.sort((a, b) => b.score - a.score);
    const mindRow = mindScored[0]!.row;

    // score crafts; prefer source diversity after mind's source
    const craftScored: Array<{ row: CardRow; score: number }> = [];
    for (const row of crafts) {
      let deep = "";
      try {
        const card = await LibraryPort.getCard(paths, row.id);
        const coerced = coerceHumanFeel(
          card.humanFeel as HumanFeelSpec | Record<string, unknown> | undefined,
        );
        deep = (
          coerced
            ? `${coerced.writerCraft} ${coerced.characterState} ${coerced.stateOnPage} ${card.body}`
            : card.body
        ).toLowerCase();
      } catch {
        /* ignore */
      }
      let score = comboScore(row, query, deep);
      // light bonus for different source than mind (cross-book mix)
      if (row.sourceId !== mindRow.sourceId) score += 5;
      craftScored.push({ row, score });
    }
    craftScored.sort((a, b) => b.score - a.score);

    const pickedCrafts: CardRow[] = [];
    const usedSources = new Set<string>([mindRow.sourceId]);
    // first pass: prefer new sources
    for (const { row } of craftScored) {
      if (pickedCrafts.length >= craftCount) break;
      if (usedSources.has(row.sourceId) && craftScored.length > craftCount) {
        continue;
      }
      pickedCrafts.push(row);
      usedSources.add(row.sourceId);
    }
    // fill remaining
    if (pickedCrafts.length < craftCount) {
      const have = new Set(pickedCrafts.map((c) => c.id));
      for (const { row } of craftScored) {
        if (pickedCrafts.length >= craftCount) break;
        if (have.has(row.id)) continue;
        pickedCrafts.push(row);
      }
    }

    if (pickedCrafts.length === 0) {
      warnings.push("池内无 craft：仅返回 1 mind；写作 lean brief 将缺少技法卡");
    } else if (pickedCrafts.length < craftCount) {
      warnings.push(`craft 仅 ${pickedCrafts.length} 张（少于请求的 ${craftCount}）`);
    }

    const mindRef: ComboCardRef = {
      id: mindRow.id,
      title: mindRow.title,
      sourceId: mindRow.sourceId,
      axis: "mind",
      tags: mindRow.tags,
    };
    const craftRefs: ComboCardRef[] = pickedCrafts.map((c) => ({
      id: c.id,
      title: c.title,
      sourceId: c.sourceId,
      axis: "craft" as const,
      tags: c.tags,
    }));
    const cardIds = [mindRef.id, ...craftRefs.map((c) => c.id)];

    return {
      ok: true,
      cardIds,
      mind: mindRef,
      crafts: craftRefs,
      warnings,
    };
  },

  async getCard(paths: StoragePaths, cardId: string): Promise<TechniqueCard> {
    await LibraryPort.ensureLibrary(paths);
    const d = libraryDirs(paths);
    const cardPath = path.join(d.cards, `${cardId}.json`);
    if (!(await fileExists(cardPath))) {
      throw new ZhizhangError("card_not_found", `找不到技法卡 ${cardId}`);
    }
    const raw = JSON.parse(await readFile(cardPath, "utf8")) as TechniqueCard;
    return { ...raw, axis: coerceAxis(raw) };
  },

  async getCandidate(paths: StoragePaths, candId: string): Promise<TechniqueCard> {
    await LibraryPort.ensureLibrary(paths);
    const d = libraryDirs(paths);
    const candPath = path.join(d.candidates, `${candId}.json`);
    if (!(await fileExists(candPath))) {
      throw new ZhizhangError("candidate_not_found", `找不到技法卡候选 ${candId}`);
    }
    const raw = JSON.parse(await readFile(candPath, "utf8")) as TechniqueCard;
    return { ...raw, axis: coerceAxis(raw) };
  },
};
