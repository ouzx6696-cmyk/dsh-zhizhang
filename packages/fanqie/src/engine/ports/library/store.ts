import { asObject, asString, asStringArray } from "../../parse.js";
import type { LibraryIndex, CardIndexRow, CardFilter, TechniqueCard } from "./types.js";
/**
 * 拆书库存储层 — 索引 / 路径 / 导入解码 / 过滤 / 排序。
 * 不包含卡 schema（见 schema.js）与机械审计（见 audit.js）。
 */
import path from "node:path";
import { atomicWrite, assertResourceId } from "../../storage/primitives.js";
import { listDir, readJson, readText } from "../../../../../core/src/fsx.js";
import { withResourceLock } from "../../storage/process-lock.js";
import { assertNoPendingCard } from "../../storage/card-journal.js";
import { coerceAxis, coerceHumanFeel } from "./schema.js";
import { NovelError } from "../../errors.js";
import type { StoragePaths } from "../../types.js";

export { nowIso, shortId as newId, exists as fileExists } from "../../../../../core/src/fsx.js";
export function libraryDirs(paths: StoragePaths) {
  return {
    root: paths.library,
    sources: path.join(paths.library, "sources"),
    cards: path.join(paths.library, "cards"),
    candidates: path.join(paths.library, "candidates"),
    index: path.join(paths.library, "index.json"),
  };
}
export async function emptyIndex(): Promise<LibraryIndex> {
  return { schemaVersion: 1, sources: [], cards: [] };
}
export async function readIndex(paths: StoragePaths): Promise<LibraryIndex> {
  await assertNoPendingCard(paths.library);
  const dirs = libraryDirs(paths);
  const text = await readText(dirs.index);
  if (text === undefined) {
    const entries = await Promise.all(
      [dirs.sources, dirs.cards, dirs.candidates, path.join(dirs.root, "analyses")].map(listDir),
    );
    if (entries.some((files) => files.length > 0))
      throw new NovelError(
        "library_index_missing",
        "拆书库索引缺失但仍有资产，请保留原文件并核对。",
      );
    return emptyIndex();
  }
  let raw;
  try {
    raw = JSON.parse(text);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new NovelError("library_index_invalid", "拆书库索引 JSON 损坏，请保留原文件并核对。");
  }
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.sources) || !Array.isArray(raw.cards))
    throw new NovelError("library_index_invalid", "拆书库索引格式损坏，请保留原文件并核对。");
  for (const row of [...raw.sources, ...raw.cards]) assertIndexRow(row);
  return {
    ...raw,
    schemaVersion: raw.schemaVersion ?? 1,
    sources: raw.sources,
    cards: raw.cards,
  };
}
const INDEX_STRING_KEYS = [
  "sourceId",
  "author",
  "createdAt",
  "status",
  "updatedAt",
  "axis",
  "layer",
  "dimension",
];
function assertIndexRow(row: unknown) {
  const value = asObject(row, "拆书库索引条目");
  asString(value, "id", { required: true });
  asString(value, "title", { required: true });
  for (const key of INDEX_STRING_KEYS)
    if (value[key] !== undefined && typeof value[key] !== "string")
      throw new NovelError("library_index_invalid", `索引 ${key} 必须是字符串`);
  if (
    value.tags !== undefined &&
    (!Array.isArray(value.tags) || !value.tags.every((tag: unknown) => typeof tag === "string"))
  )
    throw new NovelError("library_index_invalid", "索引 tags 必须是字符串数组");
}
async function writeIndex(paths: StoragePaths, idx: LibraryIndex) {
  await assertNoPendingCard(paths.library);
  const { index } = libraryDirs(paths);
  await atomicWrite(index, JSON.stringify(idx, null, 2) + "\n");
}
async function readCardFile(paths: StoragePaths, cardId: string) {
  const id = assertResourceId(cardId, "卡 id");
  const card = await readJson<unknown>(path.join(libraryDirs(paths).cards, `${id}.json`));
  if (card === undefined) throw new NovelError("card_not_found", `找不到技法卡 ${id}`);
  return asObject(card, "技法卡元数据");
}
async function resolveSourceIdFilter(paths: StoragePaths, opts: CardFilter) {
  const ids = new Set();
  let active = false;
  const one = opts.sourceId ?? "";
  if (one) {
    active = true;
    ids.add(one);
  }
  if (opts.sourceIds) {
    for (const raw of opts.sourceIds) {
      const id = raw;
      if (id) {
        active = true;
        ids.add(id);
      }
    }
  }
  const titleQ = (opts.sourceTitle ?? "").toLowerCase();
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
export async function filterCardRows(paths: StoragePaths, rows: CardIndexRow[], opts: CardFilter) {
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
    const rowsWithAxis: CardIndexRow[] = [];
    for (let offset = 0; offset < out.length; offset += 16) {
      rowsWithAxis.push(
        ...(await Promise.all(
          out
            .slice(offset, offset + 16)
            .map(async (row) =>
              row.axis === "craft" || row.axis === "mind"
                ? { ...row, axis: row.axis }
                : { ...row, axis: coerceAxis(await readCardFile(paths, row.id)) },
            ),
        )),
      );
    }
    out = rowsWithAxis.filter((row) => row.axis === want);
  }
  return out;
}
export function comboScore(row: CardIndexRow, query: string, deepHay: string) {
  const tokens = tokenizeQuery(query);
  if (!tokens.length) {
    const t = Date.parse(row.updatedAt ?? "");
    return { score: Number.isFinite(t) ? t / 1e12 : 0, matched: 0 };
  }
  let score = 0;
  let matched = 0;
  const title = row.title.toLowerCase();
  const tags = (row.tags ?? []).join(" ").toLowerCase();
  const meta = `${row.sourceId} ${row.axis ?? ""}`.toLowerCase();
  for (const t of tokens) {
    let hit = 0;
    if (title.includes(t)) hit += 100;
    if (tags.includes(t)) hit += 40;
    if (meta.includes(t)) hit += 10;
    if (deepHay && deepHay.includes(t)) hit += 25;
    if (hit > 0) matched += 1;
    score += hit;
  }
  // 多词覆盖加成：命中两个词的卡明显优于只命中一个
  if (tokens.length > 1) score += matched * matched * 30;
  // slight recency tie-break
  const t = Date.parse(row.updatedAt ?? "");
  if (Number.isFinite(t)) score += (t % 10000) / 1e6;
  return { score, matched };
}

// ===== 编码 / 路径 / 查询分词 / 证据审计 =====

/** 解码书籍文件：UTF-8 严格校验 → GB18030 回退；避免 GBK 书导入成乱码。 */
export function decodeBookBuffer(buf: Buffer) {
  if (buf.length >= 2 && buf[0] === 0xff && buf[1] === 0xfe) {
    return {
      text: new TextDecoder("utf-16le").decode(buf.subarray(2)),
      encoding: "utf-16le",
      converted: true,
    };
  }
  if (buf.length >= 3 && buf[0] === 0xef && buf[1] === 0xbb && buf[2] === 0xbf) {
    return { text: buf.subarray(3).toString("utf8"), encoding: "utf-8-bom", converted: true };
  }
  try {
    return {
      text: new TextDecoder("utf-8", { fatal: true }).decode(buf),
      encoding: "utf-8",
      converted: false,
    };
  } catch (error) {
    if (!(error instanceof TypeError)) throw error;
  }
  try {
    return { text: new TextDecoder("gb18030").decode(buf), encoding: "gb18030", converted: true };
  } catch (error) {
    if (!(error instanceof RangeError)) throw error;
  }
  return { text: buf.toString("utf8"), encoding: "utf-8-lossy", converted: true };
}

/** 兼容 MSYS 风格 /d/foo/bar 与带引号路径。 */
export function normalizeUserPath(raw: string) {
  let p = raw.trim().replace(/^["']|["']$/g, "");
  const msys = p.match(/^\/([a-zA-Z])\/(.*)$/);
  if (msys) p = `${msys[1].toUpperCase()}:/${msys[2]}`;
  return p;
}

/** 查询分词：空格 / 逗号 / 顿号 / 分号 / 加号 都算分隔符。 */
export function tokenizeQuery(query: string) {
  return query
    .toLowerCase()
    .split(/[\s,，、;；/|+]+/)
    .map((t) => t.trim())
    .filter((t) => /[一-龥A-Za-z0-9]/.test(t));
}

export function cardDeepHay(card: TechniqueCard) {
  const coerced = coerceHumanFeel(card.humanFeel);
  const hf = coerced
    ? `${coerced.writerCraft} ${coerced.characterState} ${coerced.stateOnPage} ${coerced.allowedEdges} ${coerced.failAsTemplate}`
    : "";
  const bc = card.bookCraft
    ? `${card.bookCraft.continueWhy} ${card.bookCraft.adjacentChange ?? ""} ${card.bookCraft.failAsShortStory ?? ""}`
    : "";
  const md = card.mind
    ? `${card.mind.sellIntoCost} ${card.mind.infoStaging} ${card.mind.pressureMachine} ${card.mind.debtAndSwap} ${card.mind.readerContract} ${card.mind.failAsEncyclopedia ?? ""}`
    : "";
  const mech = (card.mechanisms ?? [])
    .map((m) => `${m.name} ${m.failWhen} ${m.rebuild} ${m.experience ?? ""} ${m.discard ?? ""}`)
    .join(" ");
  const ho = card.handoff
    ? `${card.handoff.purpose ?? ""} ${card.handoff.experience ?? ""} ${card.handoff.rebuild ?? ""} ${card.handoff.discard ?? ""}`
    : "";
  // v2 模块层：读者想要 / 情绪走向 / 戏剧单元 / 可替换项 / 不可照搬 / 迁移 / 失败边界 / 文风三段与试写
  const v2 = [
    card.layer,
    card.dimension,
    card.readerWant,
    card.emotionArc,
    card.dramaticUnit,
    ...(card.replaceables ?? []),
    ...(card.mustNotCopy ?? []),
    card.transfer,
    card.failWhen,
    ...(card.steps ?? []),
    ...(card.bannedDiction ?? []),
    ...(card.styleMust ?? []),
    ...(card.styleForbidden ?? []),
    ...(card.styleSceneAdjust ?? []),
    card.transferSample,
  ]
    .filter(Boolean)
    .join(" ");
  // 证据引文：按「第 N 章 + 引文」入库，检索时也要能命中
  const ev = (card.evidence ?? []).map((e) => `${e.chapter ?? ""} ${e.quote ?? ""}`).join(" ");
  return `${card.body} ${mech} ${hf} ${bc} ${md} ${ho} ${v2} ${ev} ${card.kind ?? ""} ${card.readingRange ?? ""}`.toLowerCase();
}

const reconciledLibs = new Set();

/** 索引与卡文件对齐：tags/axis/title/updatedAt 以卡文件为准（防止改了卡、索引还是旧的）。 */
export async function reconcileIndex(paths: StoragePaths) {
  const key = paths.library;
  if (reconciledLibs.has(key)) return 0;
  return withResourceLock(paths.library, async () => {
    if (reconciledLibs.has(key)) return 0;
    const d = libraryDirs(paths);
    const idx = await readIndex(paths);
    const cards: unknown[] = [];
    for (let offset = 0; offset < idx.cards.length; offset += 16) {
      cards.push(
        ...(await Promise.all(
          idx.cards
            .slice(offset, offset + 16)
            .map((row) =>
              readJson<unknown>(path.join(d.cards, `${assertResourceId(row.id, "卡 id")}.json`)),
            ),
        )),
      );
    }
    let changed = 0;
    idx.cards.forEach((row, i) => {
      const raw = cards[i];
      if (raw === undefined) return;
      const card = asObject(raw, "技法卡元数据");
      const next = {
        title: asString(card, "title", { trim: false }) ?? row.title,
        sourceId: asString(card, "sourceId", { trim: false }) ?? row.sourceId,
        tags: asStringArray(card, "tags", { trim: false }) ?? row.tags,
        axis: coerceAxis(card),
        status: asString(card, "status", { trim: false }) ?? row.status,
        updatedAt: asString(card, "updatedAt", { trim: false }) ?? row.updatedAt,
      };
      for (const [k, v] of Object.entries(next)) {
        if (JSON.stringify(row[k as keyof CardIndexRow]) !== JSON.stringify(v)) {
          Object.assign(row, { [k]: v });
          changed += 1;
        }
      }
    });
    if (changed) await writeIndex(paths, idx);
    reconciledLibs.add(key);
    return changed;
  });
}
