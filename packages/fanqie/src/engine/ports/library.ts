import { parseSourceMeta } from "./library/input.js";
import type { SourceMeta } from "./library/types.js";
import type {
  ImportSourceInput,
  StageCardInput,
  CardFilter,
  ComboInput,
  TechniqueCard,
} from "./library/types.js";
import { readJson, sha256, isMissingFileError, isFsError } from "../../../../core/src/fsx.js";
import { errorText } from "../../../../core/src/errors.js";
/**
 * LibraryPort — 拆书库支柱（live）。
 * User submits a novel → dissect brief → AI stages cards → explicit accept → searchable.
 * 双轴：axis=craft|mind。craft→正文 brief；mind→inspire 设定/章纲。
 * Technique cards ≠ MethodRegistry. 拒收百科/梗概/声纹/人设墙。
 * 兼容：旧卡无 axis 时按 humanFeel/mind 推断；kind 降为次标签。
 */
import { randomUUID } from "node:crypto";
import { link, mkdir, open, readFile, readdir, stat, rm } from "node:fs/promises";
import path from "node:path";
import { NovelError } from "../errors.js";
import {
  assertNoPendingCard,
  createCardJournal,
  finishCardJournal,
} from "../storage/card-journal.js";
import { createSourceJournal, finishSourceJournal } from "../storage/source-journal.js";
import { createDiscardJournal, finishDiscardJournal } from "../storage/discard-journal.js";
import { snapshotFile } from "../storage/journal.js";
import { withResourceLock } from "../storage/process-lock.js";
import { atomicWrite, assertResourceId } from "../work-store.js";
import { readJsonCached } from "../file-cache.js";
import { parseChapterNumber } from "../domain/chapter-heading.js";
import { REPORT_SECTION_COUNT } from "../domain/report-sections.js";

import type { StoragePaths } from "../types.js";
import { chapterIndex } from "./analysis/chapters.js";
import { readAnalysisBundle } from "./analysis/meta.js";
import { dissectBatchText, dissectBriefText } from "./library/dissect.js";
import { deriveAxis, validateModule } from "../domain/card-schema.js";
import { verifyModuleEvidence } from "./analysis/evidence.js";
import { verifyBodyQuotes } from "../domain/evidence.js";
import { assertSourceId } from "../storage/primitives.js";
import {
  normalizeMechanism,
  normalizeHumanFeel,
  normalizeBookCraft,
  normalizeHandoff,
  normalizeKind,
  normalizeAxis,
  normalizeMind,
  coerceAxis,
  warnCharacterStateWall,
  readingArtifactWarnings,
  admitCardContent,
} from "./library/schema.js";
import { auditCardContent, normForMatch } from "./library/audit.js";
import {
  nowIso,
  newId,
  fileExists,
  libraryDirs,
  emptyIndex,
  readIndex,
  filterCardRows,
  comboScore,
  decodeBookBuffer,
  tokenizeQuery,
  cardDeepHay,
  reconcileIndex,
} from "./library/store.js";
export * from "./library/schema.js";
export { auditCardContent, normForMatch } from "./library/audit.js";
// —— § 拆书源缓存（文本 + 章索引派生） ——
// 面板刷新与阅读复用源文本缓存；证据校验单独读取源文件字节，不把缓存当完整性证明。
const SOURCE_CACHE_MAX = 6;
interface SourceCacheEntry {
  mtimeMs: number;
  ctimeMs: number;
  ino: number;
  size: number;
  meta: SourceMeta;
  text: string;
  index?: ReturnType<typeof chapterIndex>;
}
const sourceCache = new Map<string, SourceCacheEntry>();
/**
 * excerptPath 来自磁盘元数据，仍须是 sources/ 下的单段文件名：
 * 不能让一个被改坏的 meta 把读取路径带出沙箱。
 */
function sourceTextName(meta: SourceMeta, id: string) {
  return typeof meta.excerptPath === "string" &&
    /^[A-Za-z0-9][A-Za-z0-9._-]*\.txt$/.test(meta.excerptPath)
    ? meta.excerptPath
    : `${id}.txt`;
}
/** 证据核对读取书源文件；缺失与面板读取同一错误码，调用方据此区分「来源缺失」。 */
async function readSourceBytes(file: string, id: string) {
  try {
    return await readFile(file);
  } catch (error) {
    if (isMissingFileError(error))
      throw new NovelError("source_not_found", `书源文件缺失：${id}；请检查并保留已有文件。`);
    throw error;
  }
}
async function getSourceCached(paths: StoragePaths, sourceId: string) {
  const id = assertSourceId(sourceId);
  const d = libraryDirs(paths);
  const metaPath = path.join(d.sources, `${id}.json`);
  if (!(await fileExists(metaPath))) {
    throw new NovelError("source_not_found", `找不到来源 ${id}`);
  }
  let rawMeta: unknown;
  try {
    rawMeta = await readJsonCached<unknown>(metaPath);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
    throw new NovelError("source_not_found", `书源元数据缺失：${id}；请检查并保留已有文件。`);
  }
  const meta = parseSourceMeta(rawMeta, id);
  const textPath = path.join(d.sources, sourceTextName(meta, id));
  let st;
  try {
    st = await stat(textPath);
  } catch (err) {
    if (isMissingFileError(err))
      throw new NovelError("source_not_found", `书源正文缺失：${id}；请检查并保留已有文件。`);
    throw err;
  }
  const hit = sourceCache.get(textPath);
  if (
    hit &&
    hit.mtimeMs === st.mtimeMs &&
    hit.ctimeMs === st.ctimeMs &&
    hit.ino === st.ino &&
    hit.size === st.size
  ) {
    // meta 与文本同目录同生命周期；命中时顺带刷新缓存里的 meta 引用。
    hit.meta = meta;
    return { meta, text: hit.text, entry: hit };
  }
  let text: string;
  try {
    text = await readFile(textPath, "utf8");
  } catch (error) {
    if (isMissingFileError(error))
      throw new NovelError("source_not_found", `书源正文缺失：${id}；请检查并保留已有文件。`);
    throw error;
  }
  const after = await stat(textPath);
  if (
    st.mtimeMs !== after.mtimeMs ||
    st.ctimeMs !== after.ctimeMs ||
    st.ino !== after.ino ||
    st.size !== after.size
  )
    throw new NovelError("source_changed", `书源 ${id} 在读取期间发生变化；请重新核对后再试。`);
  const entry: SourceCacheEntry = {
    mtimeMs: after.mtimeMs,
    ctimeMs: after.ctimeMs,
    ino: after.ino,
    size: after.size,
    meta,
    text,
  };
  sourceCache.delete(textPath);
  if (text.length * 2 <= 64 * 1024 * 1024) sourceCache.set(textPath, entry);
  while (
    sourceCache.size > SOURCE_CACHE_MAX ||
    [...sourceCache.values()].reduce((n, v) => n + v.text.length * 2, 0) > 64 * 1024 * 1024
  ) {
    const oldest = sourceCache.keys().next().value;
    if (oldest !== undefined) sourceCache.delete(oldest);
  }
  return { meta, text, entry };
}
/** Evidence decisions always re-read source bytes; polling caches are not integrity proofs. */
async function readSourceForEvidence(paths: StoragePaths, sourceId: string) {
  const id = assertSourceId(sourceId);
  const d = libraryDirs(paths);
  const metaBytes = await readSourceBytes(path.join(d.sources, `${id}.json`), id);
  let rawMeta: unknown;
  try {
    rawMeta = JSON.parse(metaBytes.toString("utf8"));
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    throw new NovelError("bad_source", `书源元数据 JSON 损坏：${id}；请保留原文件并检查。`);
  }
  const meta = parseSourceMeta(rawMeta, id);
  const excerptName = sourceTextName(meta, id);
  const bytes = await readSourceBytes(path.join(d.sources, excerptName), id);
  let text: string;
  try {
    text = new TextDecoder("utf-8", { fatal: true, ignoreBOM: true }).decode(bytes);
  } catch {
    throw new NovelError(
      "bad_source",
      "书源不是有效 UTF-8，无法安全核对引文；请保留原文件并检查。",
    );
  }
  return {
    text,
    index: chapterIndex(text),
    sourceId: id,
    sourceFile: excerptName,
    sourceHash: sha256(bytes),
    metaHash: sha256(metaBytes),
  };
}
/** 章索引按需派生一次，挂在缓存条目上；同一本书的多张卡共用。 */
function sourceIndexOf(entry: SourceCacheEntry | null, text: string = "") {
  if (!entry) return chapterIndex(text);
  if (!entry.index) entry.index = chapterIndex(entry.text);
  return entry.index;
}
export const LibraryPort = {
  id: "port.library",
  status: "live",
  title: "拆书库",
  summary:
    "闭环第1段：交书→plan（auto 10% / full 须同意）→dissect（批次）→facts（白描）→structure（剧情/节奏/人物）→card（v2 模块）→accept→report→combo。book 交灵感；scene 交写作。验收=真读原文（脚本只核字段与字面引文）。≠ MethodRegistry。",
  capabilities() {
    return [
      { id: "import_source", title: "导入小说原文", ready: true },
      { id: "plan", title: "抽样计划（Auto 10% 分层 / Full 须同意）", ready: true },
      { id: "dissect", title: "拆书批次（原文 + 事实模板）", ready: true },
      { id: "facts", title: "逐章事实（白描，禁补动机）", ready: true },
      { id: "structure", title: "聚合：剧情条 / 节奏 / 人物", ready: true },
      { id: "card_stage", title: "暂存模块卡（层/维度 + 5 项 + 证据）", ready: true },
      { id: "card_accept", title: "显式采纳入库", ready: true },
      { id: "card_search", title: "检索卡（按书/按轴/主题）", ready: true },
      { id: "card_get", title: "读取卡全文", ready: true },
      { id: "card_combo", title: "组合包：1 book + N scene（可跨书）", ready: true },
      { id: "report", title: `拆书报告（${REPORT_SECTION_COUNT} 节，确定性拼装）`, ready: true },
      { id: "card_audit", title: "审计：引文回溯 / 白描违规 / 覆盖率", ready: true },
    ];
  },
  async ensureLibrary(paths: StoragePaths) {
    await mkdir(paths.library, { recursive: true });
    return withResourceLock(paths.library, async () => {
      const d = libraryDirs(paths);
      await assertNoPendingCard(paths.library);
      await mkdir(d.sources, { recursive: true });
      await mkdir(d.cards, { recursive: true });
      await mkdir(d.candidates, { recursive: true });
      if (!(await fileExists(d.index))) {
        const managed = [d.sources, d.cards, d.candidates, path.join(d.root, "analyses")];
        const contents = await Promise.all(
          managed.map(async (dir) => {
            try {
              return await readdir(dir);
            } catch (err) {
              if (!isMissingFileError(err)) throw err;
              return [];
            }
          }),
        );
        if (contents.some((items) => items.length > 0) && !(await fileExists(d.index)))
          throw new NovelError(
            "library_index_missing",
            "拆书库索引缺失但目录中仍有资产；请保留原文件并检查，不自动创建空索引。",
          );
        // Publish a complete initial index without replacing a concurrent creator's file.
        const tmp = `${d.index}.${randomUUID()}.init.tmp`;
        try {
          const handle = await open(tmp, "wx", 0o600);
          try {
            await handle.writeFile(JSON.stringify(await emptyIndex(), null, 2) + "\n", "utf8");
            await handle.sync();
          } finally {
            await handle.close();
          }
          try {
            await link(tmp, d.index);
          } catch (err) {
            if (!isFsError(err, "EEXIST")) throw err;
          }
        } finally {
          await rm(tmp, { force: true });
        }
      }
      await reconcileIndex(paths);
      return paths;
    });
  },
  async importSource(paths: StoragePaths, input: ImportSourceInput) {
    await LibraryPort.ensureLibrary(paths);
    const title = input.title;
    if (!title) throw new NovelError("bad_args", "title 不能为空");
    let text = input.text ?? "";
    let encoding = "utf8";
    let converted = false;
    if ((!text || !text.trim()) && input.file) {
      const filePath = input.file;
      let buf;
      try {
        buf = await readFile(filePath);
      } catch (error) {
        throw new NovelError(
          "file_read_failed",
          `无法读取文件：${input.file}（已尝试路径：${filePath}；${errorText(error)}）`,
        );
      }
      const decoded = decodeBookBuffer(buf);
      text = decoded.text;
      encoding = decoded.encoding;
      converted = decoded.converted;
    }
    if (!text.trim()) throw new NovelError("empty_body", "导入正文不能为空（传 text 或 file）");
    const sourceId = newId("src");
    const d = libraryDirs(paths);
    const excerptPath = path.join(d.sources, `${sourceId}.txt`);
    const metaPath = path.join(d.sources, `${sourceId}.json`);
    const now = nowIso();
    const meta = {
      schemaVersion: 1,
      id: sourceId,
      title,
      author: input.author ?? "",
      readingRange: input.readingRange || "全文（已导入）",
      excerptPath: `${sourceId}.txt`,
      charCount: text.length,
      encoding,
      createdAt: now,
      updatedAt: now,
    };
    await withResourceLock(paths.library, async () => {
      const indexBefore = await snapshotFile(d.index);
      if (!indexBefore)
        throw new NovelError("library_index_missing", "拆书库索引缺失，请先检查原文件。");
      const idx = await readIndex(paths);
      if ((await snapshotFile(d.index)) !== indexBefore)
        throw new NovelError(
          "library_recovery_conflict",
          "拆书库索引在导入准备期间变化，请重新检查。",
        );
      if ((await snapshotFile(excerptPath)) !== null || (await snapshotFile(metaPath)) !== null)
        throw new NovelError("id_collision", "生成的书源 id 已存在；未覆盖原文件，请重新尝试。");
      idx.sources.unshift({ id: sourceId, title: meta.title, author: meta.author, createdAt: now });
      const journal = await createSourceJournal(paths.library, {
        sourceId,
        text,
        metaContent: JSON.stringify(meta, null, 2) + "\n",
        indexBefore,
        indexContent: JSON.stringify(idx, null, 2) + "\n",
      });
      await finishSourceJournal(paths.library, journal);
    });
    return {
      sourceId,
      charCount: text.length,
      encoding,
      converted,
      excerptPath: meta.excerptPath,
      warning:
        converted && encoding !== "utf-8"
          ? `文件不是 UTF-8，已按 ${encoding} 解码（原文件若为乱码请检查编码）`
          : undefined,
    };
  },
  async getSource(paths: StoragePaths, sourceId: string) {
    const cached = await getSourceCached(paths, sourceId);
    return { meta: cached.meta, text: cached.text };
  },
  /**
   * getSource + 已解析的章索引。整本书（可能数 MB）此前在 dissect / 卡
   * stage / accept / audit 里被反复整读 + 全文正则重扫；这里按文本文件
   * mtime+size 缓存文本与章索引，未变时全部命中。
   */
  async getSourceIndexed(paths: StoragePaths, sourceId: string) {
    const cached = await getSourceCached(paths, sourceId);
    return {
      meta: cached.meta,
      text: cached.text,
      index: sourceIndexOf(cached.entry, cached.text),
    };
  },
  async listSources(paths: StoragePaths) {
    return (await readIndex(paths)).sources;
  },
  async dissectBrief(
    paths: StoragePaths,
    sourceId: string,
    opts: {
      mode?: string;
      from?: number;
      count?: number;
      maxChars?: number;
      includeRecommend?: boolean;
    } = {},
  ) {
    return withResourceLock(paths.library, async () => {
      await assertNoPendingCard(paths.library);
      const source = await LibraryPort.getSourceIndexed(paths, sourceId);
      return opts.mode
        ? dissectBatchText(paths, source, opts.mode, opts)
        : dissectBriefText(source.meta, source.text, opts);
    });
  },
  async stageCard(paths: StoragePaths, input: StageCardInput) {
    await LibraryPort.ensureLibrary(paths);
    const title = input.title;
    const body = input.body;
    const sourceId = input.sourceId;
    if (!title) throw new NovelError("bad_args", "title 不能为空");
    if (!sourceId) throw new NovelError("bad_args", "sourceId 不能为空");
    if (!body.trim()) throw new NovelError("empty_body", "卡 body 不能为空");
    if (input.mechanisms.length === 0) {
      throw new NovelError("bad_args", "mechanisms 至少一条");
    }
    await LibraryPort.getSource(paths, sourceId);
    const mechanisms = input.mechanisms.map((m, i) => normalizeMechanism(m, i));
    const { handoff, warnings: w3 } = normalizeHandoff(input.handoff);
    const { kind, warnings: w4 } = normalizeKind(input.kind);
    const tags = input.tags ?? [];
    const v2 = {
      layer: input.layer ?? "",
      dimension: input.dimension ?? "",
      readerWant: input.readerWant ?? "",
      emotionArc: input.emotionArc ?? "",
      dramaticUnit: input.dramaticUnit ?? "",
      replaceables: input.replaceables ?? [],
      mustNotCopy: input.mustNotCopy ?? [],
      transfer: input.transfer ?? "",
      failWhen: input.failWhen ?? "",
      evidence: input.evidence ?? [],
      steps: input.steps ?? [],
      bannedDiction: input.bannedDiction ?? [],
      styleMust: input.styleMust ?? [],
      styleForbidden: input.styleForbidden ?? [],
      styleSceneAdjust: input.styleSceneAdjust ?? [],
      transferSample: input.transferSample ?? "",
    };
    const hasV2 = Boolean(
      v2.layer ||
      v2.dimension ||
      v2.readerWant ||
      v2.emotionArc ||
      v2.dramaticUnit ||
      v2.transfer ||
      v2.failWhen ||
      v2.replaceables.length ||
      v2.mustNotCopy.length ||
      v2.evidence.length,
    );
    if (
      !hasV2 &&
      (v2.steps.length > 0 ||
        v2.bannedDiction.length > 0 ||
        v2.styleMust.length > 0 ||
        v2.styleForbidden.length > 0 ||
        v2.styleSceneAdjust.length > 0 ||
        v2.transferSample.length > 0)
    ) {
      throw new NovelError(
        "bad_args",
        "steps / bannedDiction / 文风三段（styleMust 等）仅用于 v2 模块卡：请同时传 layer + dimension，或改用 mechanisms 写操作",
      );
    }
    const v2Warnings = [];
    let evidenceSourceHash: string | undefined;
    if (hasV2) {
      const check = validateModule({ ...v2, mechanisms: input.mechanisms });
      if (check.errors.length)
        throw new NovelError("bad_module", `模块未通过：${check.errors.join("；")}`);
      v2Warnings.push(...check.warnings);
      const src = await readSourceForEvidence(paths, sourceId);
      evidenceSourceHash = src.sourceHash;
      const bad = verifyModuleEvidence(v2, src.text, src.index);
      if (bad.length) throw new NovelError("bad_evidence", `模块证据未通过：${bad.join("；")}`);
    }
    // Peek presence before full normalize (avoid craft-warn spam on mind cards)
    const peekFeel = input.humanFeel != null;
    const peekBook = input.bookCraft != null;
    const peekMind = input.mind != null;
    const derivedAxis = hasV2 && !input.axis ? deriveAxis(v2.layer, v2.dimension) : input.axis;
    const { axis, warnings: wAxis } = normalizeAxis(derivedAxis, {
      hasHumanFeel: peekFeel,
      hasMind: peekMind,
      hasBookCraft: peekBook,
      tags,
      kind,
    });
    let humanFeel;
    let bookCraft;
    let mind;
    const w1 = [];
    const w2 = [];
    const wMind = [];
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
    if (input.kind?.toLowerCase() === "book" && axis === "mind" && !mind) {
      wAxis.push("kind=book 不能冒充 mind：请填 mind 块或改 axis=craft");
    }
    const admit = admitCardContent({ title, body, axis, mechanisms });
    if (admit.hardReject) {
      throw new NovelError("card_rejected", admit.hardReject);
    }
    const warnings = hasV2
      ? [...v2Warnings, ...w3, ...w4, ...warnCharacterStateWall(humanFeel?.characterState)]
      : [
          ...wAxis,
          ...w1,
          ...w2,
          ...wMind,
          ...w3,
          ...w4,
          ...admit.warnings,
          ...warnCharacterStateWall(humanFeel?.characterState),
          ...readingArtifactWarnings(body, axis),
        ];
    // Axis-specific soft expectations（v2 模块走 5 项校验，不再套旧轴口令）
    if (!hasV2) {
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
    }
    const candId = newId("lcand");
    const now = nowIso();
    const card: TechniqueCard = {
      schemaVersion: 1,
      id: candId,
      title,
      sourceId,
      readingRange: input.readingRange || "见拆书简报",
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
    if (hasV2) {
      card.schemaVersion = 2;
      card.layer = v2.layer;
      card.dimension = v2.dimension;
      card.readerWant = v2.readerWant;
      card.emotionArc = v2.emotionArc;
      card.dramaticUnit = v2.dramaticUnit;
      card.replaceables = v2.replaceables;
      card.mustNotCopy = v2.mustNotCopy;
      card.transfer = v2.transfer;
      card.failWhen = v2.failWhen;
      card.evidence = v2.evidence;
      // Snapshot only explicit reading declarations for cited chapters; quotes do not prove depth.
      const analysis = await readAnalysisBundle(paths, sourceId);

      const chapterNums = [
        ...new Set(
          v2.evidence
            .map((e) => parseChapterNumber(e.chapter))
            .filter((n) => Number.isInteger(n) && n > 0),
        ),
      ] as number[];
      const chapters = chapterNums.map((n) => {
        const matches = analysis.chapters.filter((f) => Number(f.n) === n);
        const fact = matches.length === 1 ? matches[0] : undefined;
        const level =
          fact?.readingLevel === "正文已读" || fact?.readingLevel === "深读"
            ? fact.readingLevel
            : "未声明";
        return {
          chapter: n,
          readingLevel: level,
          sourceHash: fact?.sourceHash,
          sourceStart: fact?.sourceStart,
          sourceMatches: fact?.sourceHash ? fact.sourceHash === evidenceSourceHash : null,
        };
      });
      card.readingEvidence = {
        capturedAt: now,
        sourceHash: evidenceSourceHash,
        planMode: analysis.meta?.scope?.mode ?? "未建计划",
        chapters,
        note: "阅读程度为提交者申报，引用匹配不证明已读或深读；来源版本不同时仅为历史申报，旧记录来源未知",
      };
      if (chapters.some((ch) => ch.readingLevel === "未声明"))
        warnings.push("部分证据章的阅读程度未声明；引文匹配不证明已读或深读。");
      if (v2.steps.length) card.steps = v2.steps;
      if (v2.bannedDiction.length) card.bannedDiction = v2.bannedDiction;
      if (v2.styleMust.length) card.styleMust = v2.styleMust;
      if (v2.styleForbidden.length) card.styleForbidden = v2.styleForbidden;
      if (v2.styleSceneAdjust.length) card.styleSceneAdjust = v2.styleSceneAdjust;
      if (v2.transferSample) card.transferSample = v2.transferSample;
    }
    const d = libraryDirs(paths);
    const candidatePath = path.join(d.candidates, `${candId}.json`);
    await withResourceLock(paths.library, async () => {
      await assertNoPendingCard(paths.library);
      if ((await snapshotFile(candidatePath)) !== null)
        throw new NovelError("id_collision", "生成的卡候选 id 已存在；未覆盖原文件，请重新尝试。");
      await atomicWrite(candidatePath, JSON.stringify(card, null, 2) + "\n");
    });
    return { candId, title, warnings };
  },
  async acceptCard(paths: StoragePaths, candId: string) {
    const id = assertResourceId(candId, "卡候选 id");
    await LibraryPort.ensureLibrary(paths);
    // 读候选 → 查已采纳 → 写卡 + 索引 + 回写候选全程持同一把库锁：
    // 并发/重试不能把同一张候选重复采纳成两张卡。
    return withResourceLock(paths.library, async () => {
      await assertNoPendingCard(paths.library);
      const d = libraryDirs(paths);
      const candPath = path.join(d.candidates, `${id}.json`);
      const candidateBefore = await snapshotFile(candPath);
      if (candidateBefore === null) {
        throw new NovelError("candidate_not_found", `找不到技法卡候选 ${id}`);
      }
      const indexBefore = await snapshotFile(d.index);
      if (indexBefore === null)
        throw new NovelError("library_index_missing", "拆书库索引缺失，请先核对原文件。");
      const staged = await readJson<TechniqueCard>(candPath);
      if (!staged) throw new NovelError("candidate_not_found", `找不到技法卡候选 ${id}`);
      if (staged.status === "accepted" || staged.acceptedCardId) {
        throw new NovelError(
          "candidate_already_accepted",
          `卡候选 ${id} 已采纳${staged.acceptedCardId ? `（${staged.acceptedCardId}）` : ""}，不能重复入库。请重新 card_stage。`,
        );
      }
      if (!staged.body?.trim()) {
        throw new NovelError("empty_body", "候选 body 为空，拒绝采纳");
      }
      let moduleWarnings: string[] = [];
      let sourceGuard:
        { sourceId: string; sourceFile: string; metaHash: string; sourceHash: string } | undefined;
      if (staged.schemaVersion === 2 || staged.layer) {
        const check = validateModule(staged);
        if (check.errors.length)
          throw new NovelError("bad_module", `模块未通过：${check.errors.join("；")}`);
        moduleWarnings = check.warnings;
        const src = await readSourceForEvidence(paths, staged.sourceId);
        if (
          staged.readingEvidence?.sourceHash &&
          staged.readingEvidence.sourceHash !== src.sourceHash
        )
          throw new NovelError(
            "source_changed",
            "书源在暂存卡后发生变化；请重新核对原文并暂存卡，避免沿用旧阅读依据。",
          );
        const bad = verifyModuleEvidence(staged, src.text, src.index);
        if (bad.length) throw new NovelError("bad_evidence", `模块证据未通过：${bad.join("；")}`);
        sourceGuard = {
          sourceId: src.sourceId,
          sourceFile: src.sourceFile,
          metaHash: src.metaHash,
          sourceHash: src.sourceHash,
        };
      }
      let auditWarnings: string[] = [];
      if (!(staged.schemaVersion === 2 || staged.layer)) {
        try {
          const src = await LibraryPort.getSource(paths, staged.sourceId);
          const audit = auditCardContent(
            { ...staged, axis: coerceAxis(staged) },
            src.text,
            undefined,
          );
          auditWarnings = audit.warnings;
          if (audit.unverifiable.length > 0) {
            auditWarnings.unshift(
              `证据引文 ${audit.evidenceVerified}/${audit.evidenceQuotes} 可在原文中核对，${audit.unverifiable.length} 条未命中`,
            );
          }
        } catch (err) {
          auditWarnings.push(`旧卡原文未能核对（${errorText(err)}）；采纳前须人工检查来源。`);
        }
      }
      auditWarnings.unshift(...moduleWarnings);
      const cardId = newId("card");
      const now = nowIso();
      const card: TechniqueCard = {
        ...staged,
        id: cardId,
        status: "accepted",
        updatedAt: now,
        acceptedAt: now,
      };
      const idx = await readIndex(paths);
      const cardBefore = await snapshotFile(path.join(d.cards, `${cardId}.json`));
      if (cardBefore !== null)
        throw new NovelError("id_collision", "生成的卡 id 已存在；未覆盖原卡，请重新尝试。");
      idx.cards.unshift({
        id: cardId,
        title: card.title,
        sourceId: card.sourceId,
        tags: card.tags,
        status: "accepted",
        updatedAt: now,
        axis: coerceAxis(card),
        layer: card.layer,
        dimension: card.dimension,
      });
      const acceptedCandidate = {
        ...staged,
        status: "accepted",
        acceptedCardId: cardId,
        updatedAt: now,
      };
      const journalId = await createCardJournal(paths.library, {
        candidateId: id,
        cardId,
        sourceGuard,
        writes: [
          {
            file: `cards/${cardId}.json`,
            before: cardBefore,
            content: JSON.stringify(card, null, 2) + "\n",
          },
          { file: "index.json", before: indexBefore, content: JSON.stringify(idx, null, 2) + "\n" },
          {
            file: `candidates/${id}.json`,
            before: candidateBefore,
            content: JSON.stringify(acceptedCandidate, null, 2) + "\n",
          },
        ],
      });
      await finishCardJournal(paths.library, journalId);
      return {
        cardId,
        title: card.title,
        warnings: auditWarnings,
        judgment: [
          "机械审计只证明引文没编、字段没缺，不证明卡能用。",
          "采纳前请真读原文，按五条判：可操作 / 特异性（换书名还成立=没抓到本书）/ 非梗概 / 状态落纸 / 失败边界具体。",
          "并在回执里写一句：这张卡最可能失效的地方是___。",
        ],
      };
    });
  },
  async discardCard(paths: StoragePaths, cardId: string) {
    const id = assertResourceId(cardId, "卡 id");
    await LibraryPort.ensureLibrary(paths);
    const d = libraryDirs(paths);
    return withResourceLock(paths.library, async () => {
      const indexBefore = await snapshotFile(d.index);
      if (!indexBefore)
        throw new NovelError("library_index_missing", "拆书库索引缺失，请先检查原文件。");
      const fresh = await readIndex(paths);
      if ((await snapshotFile(d.index)) !== indexBefore)
        throw new NovelError("library_recovery_conflict", "索引在删卡准备期间变化，请重新检查。");
      const hit = fresh.cards.find((c) => c.id === id);
      if (!hit) throw new NovelError("card_not_found", `找不到卡 ${cardId}`);
      fresh.cards = fresh.cards.filter((c) => c.id !== id);
      const cardBefore = await snapshotFile(path.join(d.cards, `${id}.json`));
      const journal = await createDiscardJournal(paths.library, {
        cardId: id,
        indexBefore,
        cardBefore,
        indexContent: JSON.stringify(fresh, null, 2) + "\n",
      });
      await finishDiscardJournal(paths.library, journal);
      return { cardId: id, title: hit.title, remaining: fresh.cards.length };
    });
  },
  async listCards(paths: StoragePaths, opts: CardFilter = {}) {
    const idx = await readIndex(paths);
    return filterCardRows(paths, idx.cards, {
      status: opts.status ?? "accepted",
      sourceId: opts.sourceId,
      sourceIds: opts.sourceIds,
      sourceTitle: opts.sourceTitle,
      axis: opts.axis,
    });
  },
  async searchCards(paths: StoragePaths, query: string, opts: CardFilter = {}) {
    const tokens = tokenizeQuery(query);
    const tag = (opts.tag ?? "").toLowerCase();
    const hasFilter = Boolean(
      opts.sourceId ||
      (opts.sourceIds && opts.sourceIds.length) ||
      opts.sourceTitle ||
      opts.axis ||
      tag,
    );
    if (!tokens.length && !hasFilter) {
      throw new NovelError("bad_args", "query 不能为空（或提供 source/axis/tag 过滤）");
    }
    const idx = await readIndex(paths);
    let pool = await filterCardRows(paths, idx.cards, {
      status: opts.status ?? "accepted",
      sourceId: opts.sourceId,
      sourceIds: opts.sourceIds,
      sourceTitle: opts.sourceTitle,
      axis: opts.axis,
    });
    if (tag) {
      pool = pool.filter((row) => (row.tags ?? []).some((t) => String(t).toLowerCase() === tag));
    }
    if (!tokens.length) return pool;
    const matches = await Promise.all(
      pool.map(async (row) => {
        const shallow =
          `${row.title} ${(row.tags ?? []).join(" ")} ${row.sourceId} ${row.axis ?? ""}`.toLowerCase();
        if (tokens.every((t) => shallow.includes(t))) return row;
        const card = await LibraryPort.getCard(paths, row.id);
        const deep = cardDeepHay(card);
        return tokens.every((t) => deep.includes(t)) ? { ...row, axis: coerceAxis(card) } : null;
      }),
    );
    return matches.filter((row) => row !== null);
  },
  /**
   * 推荐组合包：优先 1 mind + 最多 N craft；有用的 craft 可独立返回。
   * 缺 mind 不阻断；没有任何可用卡时返回空原因。
   */
  async suggestCombo(paths: StoragePaths, input: ComboInput = {}) {
    const warnings = [];
    const nRaw = input.craftCount ?? 2;
    const craftCount = Math.max(1, Math.min(8, Math.floor(Number(nRaw) || 2)));
    if (input.craftCount != null && Number(input.craftCount) !== craftCount) {
      warnings.push(`craftCount 已夹紧为 ${craftCount}（允许 1–8）`);
    }
    const query = input.query ?? "";
    const preferMind = new Set(input.preferMindSourceIds ?? []);
    const pool = await LibraryPort.listCards(paths, {
      status: "accepted",
      sourceIds: input.sourceIds,
      sourceTitle: input.sourceTitle,
    });
    const typed = await Promise.all(
      pool.map(async (row) =>
        row.axis === "craft" || row.axis === "mind"
          ? { ...row, axis: row.axis }
          : { ...row, axis: (await LibraryPort.getCard(paths, row.id)).axis },
      ),
    );
    const minds = typed.filter((row) => row.axis === "mind");
    const crafts = typed.filter((row) => row.axis !== "mind");
    if (minds.length === 0) {
      const selected = [...crafts]
        .sort((a, b) => comboScore(b, query, "").score - comboScore(a, query, "").score)
        .slice(0, craftCount);
      return {
        ok: selected.length > 0,
        cardIds: selected.map((c) => c.id),
        mind: null,
        crafts: selected,
        warnings: [
          ...warnings,
          "没有 mind；按本书作者材料规划，craft 仅提供写法参考，不要求补卡。",
        ],
        emptyReason: selected.length ? undefined : "当前范围没有参考卡；可以直接按作者目标规划。",
      };
    }
    // score minds
    // 深打分与深检索同源（cardDeepHay）：v2 模块的 readerWant/transfer/
    // dramaticUnit/replaceables/evidence 等也参与主题命中——
    // 此前手拼 mind.*/body 会让 v2 卡在主题排序里几乎不可见。
    const scored = await Promise.all(
      typed.map(async (row) => {
        const cs = comboScore(row, query, cardDeepHay(await LibraryPort.getCard(paths, row.id)));
        return { row, score: cs.score, matched: cs.matched };
      }),
    );
    const mindScored = scored
      .filter((s) => s.row.axis === "mind")
      .map((s) =>
        preferMind.size && s.row.sourceId !== undefined && preferMind.has(s.row.sourceId)
          ? { ...s, score: s.score + 50 }
          : s,
      );
    mindScored.sort((a, b) => b.score - a.score);
    const mindRow = mindScored[0].row;
    // score crafts; prefer source diversity after mind's source
    // light bonus for different source than mind (cross-book mix)
    const craftScored = scored
      .filter((s) => s.row.axis !== "mind")
      .map((s) => (s.row.sourceId !== mindRow.sourceId ? { ...s, score: s.score + 5 } : s));
    craftScored.sort((a, b) => b.score - a.score);
    if (
      query &&
      !mindScored.some((s) => s.matched > 0) &&
      !craftScored.some((s) => s.matched > 0)
    ) {
      warnings.push(`主题词「${query}」在候选池无命中：已按更新时间兜底`);
    }
    const pickedCrafts = [];
    const usedSources = new Set([mindRow.sourceId]);
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
    const mindRef = {
      id: mindRow.id,
      title: mindRow.title,
      sourceId: mindRow.sourceId,
      axis: "mind",
      tags: mindRow.tags,
    };
    const craftRefs = pickedCrafts.map((c) => ({
      id: c.id,
      title: c.title,
      sourceId: c.sourceId,
      axis: "craft",
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
  async auditCards(paths: StoragePaths, opts: CardFilter & { cardId?: string } = {}) {
    const idx = await readIndex(paths);
    let rows = await filterCardRows(paths, idx.cards, {
      status: opts.status ?? "accepted",
      sourceId: opts.sourceId,
      axis: opts.axis,
    });
    if (opts.cardId) rows = rows.filter((r) => r.id === opts.cardId);
    const srcCache = new Map();
    const out = [];
    for (const row of rows) {
      const card = await LibraryPort.getCard(paths, row.id);
      let entry = srcCache.get(card.sourceId);
      if (entry === undefined) {
        try {
          const src = await LibraryPort.getSourceIndexed(paths, card.sourceId);
          entry = { text: src.text, norm: normForMatch(src.text), index: src.index };
        } catch (error) {
          // getSourceIndexed 把缺失的元数据或正文统一报成 source_not_found。
          if (!(error instanceof NovelError && error.code === "source_not_found")) throw error;
          // source 缺失：引文一律记为未命中
          entry = { text: "", norm: normForMatch(""), index: [] };
        }
        srcCache.set(card.sourceId, entry);
      }
      if (card.schemaVersion === 2 || card.layer) {
        const check = validateModule(card);
        const bad = entry.text
          ? verifyModuleEvidence(card, entry.text, entry.index)
          : (card.evidence ?? []).map(
              (_: unknown, i: number) => `evidence[${i}] 来源缺失，无法核对`,
            );
        const quotes = (card.evidence ?? []).length;
        const bodyCheck = entry.text
          ? verifyBodyQuotes(card, entry.text)
          : { total: 0, ok: 0, bad: ["来源缺失，正文引文无法核对"], skipped: 0 };
        out.push({
          id: card.id,
          title: card.title,
          axis: coerceAxis(card),
          layer: card.layer,
          dimension: card.dimension,
          evidenceQuotes: quotes,
          evidenceVerified: Math.max(0, quotes - bad.length),
          unverifiable: bad,
          skippedShort: [],
          bodyQuotes: bodyCheck.total,
          bodyVerified: bodyCheck.ok,
          bodyUnverifiable: bodyCheck.bad,
          bodySkipped: bodyCheck.skipped ?? 0,
          warnings: [
            ...check.errors,
            ...check.warnings.filter((w) => !w.includes("mechanisms 为空")),
          ],
          chapterOk: bad.length || bodyCheck.bad.length ? false : true,
        });
        continue;
      }
      const audit = auditCardContent({ ...card, axis: coerceAxis(card) }, entry.text, entry.norm);
      out.push({ id: card.id, title: card.title, axis: coerceAxis(card), ...audit });
    }
    return out;
  },
  async getCard(paths: StoragePaths, cardId: string): Promise<TechniqueCard> {
    const id = assertResourceId(cardId, "卡 id");
    const d = libraryDirs(paths);
    const cardPath = path.join(d.cards, `${id}.json`);
    if (!(await fileExists(cardPath))) {
      throw new NovelError("card_not_found", `找不到技法卡 ${id}`);
    }
    // mtime 缓存：combo 深打分 / 深检索 / 面板刷新会反复读同一批卡。
    const raw = await readJsonCached<TechniqueCard>(cardPath);
    return { ...raw, axis: coerceAxis(raw) };
  },
  async getCandidate(paths: StoragePaths, candId: string) {
    const id = assertResourceId(candId, "卡候选 id");
    const d = libraryDirs(paths);
    const candPath = path.join(d.candidates, `${id}.json`);
    if (!(await fileExists(candPath))) {
      throw new NovelError("candidate_not_found", `找不到技法卡候选 ${id}`);
    }
    const raw = await readJsonCached<TechniqueCard>(candPath);
    return { ...raw, axis: coerceAxis(raw) };
  },
};
