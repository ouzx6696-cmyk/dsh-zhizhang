import { sha256, shortId } from "../../../../core/src/fsx.js";

import { snapshotFiles } from "../../../../core/src/snapshots.js";
import { mkdir, readdir, readFile, stat } from "node:fs/promises";
import path from "node:path";

import { randomUUID } from "node:crypto";
import { SCHEMA_VERSION } from "../types.js";
import type { Candidate } from "../types.js";
import { assertContextBasis } from "./chapters.js";
import { lintStyle } from "../style-linter.js";
import { fingerprint } from "../domain/lifecycle.js";
import { NovelError } from "../errors.js";
import { resolveHappenedText } from "../domain/foundation-outcome.js";
import { readJsonCached } from "../file-cache.js";
import {
  assertCandidateFile,
  assertResourceId,
  countWords,
  isMissingFileError,
  nowIso,
} from "./primitives.js";
import { readChapter, prepareChapterSaveUnlocked } from "./chapters.js";
import {
  assertNoPendingAccept,
  createAcceptJournal,
  finishAcceptJournal,
  snapshotFile,
} from "./accept-journal.js";
import { createWorkRecordJournal, finishChapterJournal } from "./chapter-journal.js";
import { readLedger, appendLedger } from "./ledger.js";
import { withResourceLock } from "./process-lock.js";
import { metaPath, readWorkMeta } from "./work-meta.js";

/** Persist candidate JSON without dropping optional multi-draft / edit fields. */
type CandidateMeta = Omit<Candidate, "body">;
const OPTIONAL_META_KEYS = [
  "revisionSource",
  "targetRevision",
  "basis",
  "lintPassToken",
  "lintedAt",
  "lintBodyHash",
  "lintHitCount",
  "acceptedAt",
  "acceptedMode",
  "editOf",
  "editMode",
  "editedAt",
  "draftLabel",
  "variantGroup",
  "unifyOf",
] as const;
function candidateToDiskMeta(cand: Candidate): CandidateMeta {
  const disk: CandidateMeta = {
    schemaVersion: cand.schemaVersion,
    id: cand.id,
    workKey: cand.workKey,
    chapterId: cand.chapterId,
    stagedAt: cand.stagedAt,
    source: cand.source,
    note: cand.note,
    bodyFile: cand.bodyFile,
    wordCount: typeof cand.wordCount === "number" ? cand.wordCount : countWords(cand.body),
  };
  for (const key of OPTIONAL_META_KEYS) {
    const include =
      key === "lintHitCount"
        ? cand[key] !== undefined
        : key === "unifyOf"
          ? cand.unifyOf?.length
          : Boolean(cand[key]);
    if (include) Object.assign(disk, { [key]: cand[key] });
  }
  return disk;
}
export async function stageCandidate(dir: string, input: any) {
  return withResourceLock(dir, async () => {
    if (!input.body.trim()) {
      throw new NovelError("candidate_empty", "候选正文为空，拒绝暂存");
    }
    const chapterId = assertResourceId(input.chapterId, "章节 id");
    // 候选必须指向已存在的章（章纲由 outline_set / inspire apply 建立）——否则 accept 的
    // brief/兑付闸都无从对照，错误还会迟到且语义不明（先撞 brief_required）。
    const meta = await readWorkMeta(dir);
    if (!meta.chapters.some((c) => c.id === chapterId)) {
      throw new NovelError(
        "chapter_not_found",
        `目标章 ${chapterId} 不存在：先 outline_set（或 inspire_accept apply）建章纲，再交候选`,
      );
    }
    // Date.now() 只能到毫秒；并发 stage 会在同一毫秒生成同一个 id 并互相覆盖。
    const id = shortId("cand");
    await mkdir(candidatesDir(dir), { recursive: true });
    const bodyFile = `${id}.md`;
    if (
      (await snapshotFile(path.join(candidatesDir(dir), bodyFile))) !== null ||
      (await snapshotFile(path.join(candidatesDir(dir), `${id}.json`))) !== null
    )
      throw new NovelError("id_collision", "候选 id 已存在，未覆盖原文件，请重新暂存。");
    const stagedAt = nowIso();
    const current = await readChapter(dir, chapterId);
    if (input.expectedRevision !== undefined && input.expectedRevision !== current.revision)
      throw new NovelError("revision_conflict", "暂存期间目标版本变化");
    if (input.capturedBasis) await assertContextBasis(dir, input.capturedBasis, chapterId);
    const preparedContext = input.capturedBasis
      ? { basis: input.capturedBasis }
      : await getRecentBrief(dir, chapterId, Infinity);
    const cand: Candidate = {
      schemaVersion: SCHEMA_VERSION,
      id,
      workKey: meta.key,
      chapterId,
      stagedAt,
      targetRevision: current.revision,
      revisionSource: input.revisionSource,
      basis: preparedContext?.basis,
      source: input.source ?? "agent",
      note: input.note ?? "",
      body: input.body,
      bodyFile,
      wordCount: countWords(input.body),
    };
    if (input.editOf) {
      cand.editOf = input.editOf;
      cand.editedAt = stagedAt;
    }
    if (input.editMode) cand.editMode = input.editMode;
    if (input.draftLabel?.trim()) cand.draftLabel = input.draftLabel.trim();
    if (input.variantGroup?.trim()) cand.variantGroup = input.variantGroup.trim();
    if (input.unifyOf?.length) cand.unifyOf = [...input.unifyOf];
    const disk = candidateToDiskMeta(cand);
    const journal = await createWorkRecordJournal(dir, {
      kind: "stage",
      chapterId,
      candidateId: id,
      writes: [
        { file: `candidates/${bodyFile}`, before: null, content: input.body },
        {
          file: `candidates/${id}.json`,
          before: null,
          content: JSON.stringify(disk, null, 2) + "\n",
        },
      ],
    });
    await finishChapterJournal(dir, journal);
    return cand;
  });
}
/** Decode the same metadata contract for reads and list projections. */
function candidateBodyFile(disk: any, id: string): string {
  if (
    !disk ||
    typeof disk !== "object" ||
    Array.isArray(disk) ||
    disk.id !== id ||
    typeof disk.chapterId !== "string"
  )
    throw new NovelError("bad_candidate", `候选 ${id} 元数据损坏，请保留文件并核对。`);
  assertResourceId(disk.chapterId, "章节 id");
  return assertCandidateFile(disk.bodyFile ?? `${id}.md`);
}
async function readCandidateUnlocked(dir: string, candidateId: string): Promise<Candidate> {
  const id = assertResourceId(candidateId, "候选 id");
  const raw = await readFile(path.join(candidatesDir(dir), `${id}.json`), "utf8");
  const disk = JSON.parse(raw);
  const bodyFile = candidateBodyFile(disk, id);
  const body = await readFile(path.join(candidatesDir(dir), bodyFile), "utf8");
  return { ...disk, body };
}
export async function readCandidate(dir: string, candidateId: string): Promise<Candidate> {
  await assertNoPendingAccept(dir);
  return readCandidateUnlocked(dir, candidateId);
}
/**
 * Record that style_lint ran on a staged candidate and issue lintPassToken.
 * Token proves the sensor ran (hitCount may be > 0) — NOT a quality pass.
 * Replaces any prior scan. Adoption can also scan inline; existing credentials must remain valid.
 */
export async function markCandidateLinted(
  dir: string,
  candidateId: string,
  hitCount: any,
  expectedBody?: string,
) {
  const id = assertResourceId(candidateId, "候选 id");
  return withResourceLock(dir, async () => {
    const candidatePath = path.join(candidatesDir(dir), `${id}.json`);
    const [candidateBefore, ledgerBefore] = await Promise.all([
      snapshotFile(candidatePath),
      snapshotFile(ledgerPath(dir)),
    ]);
    const cand = await readCandidate(dir, id);
    if (cand.acceptedAt) {
      throw new NovelError(
        "candidate_already_accepted",
        `候选 ${id} 已采纳，无需再扫；请重新 stage 新候选后再 lint。`,
      );
    }
    if (expectedBody !== undefined && cand.body !== expectedBody)
      throw new NovelError("candidate_changed", "候选正文在扫描期间发生变化，请重新扫描。");
    const ledger = await readLedger(dir);
    const token = shortId("lint", 16);
    const lintedAt = nowIso();
    const diskMeta = candidateToDiskMeta({
      ...cand,
      lintPassToken: token,
      lintBodyHash: sha256(cand.body),
      lintedAt,
      lintHitCount: hitCount,
    });
    appendLedger(ledger, {
      chapterId: cand.chapterId,
      kind: "style_lint",
      summary: `语感雷达候选 ${id}：${hitCount} 处命中 · token=${token}`,
      styleHitCount: hitCount,
    });
    if (
      (await snapshotFile(candidatePath)) !== candidateBefore ||
      (await snapshotFile(ledgerPath(dir))) !== ledgerBefore
    )
      throw new NovelError("recovery_conflict", "候选或审校账本在准备期间变化，请重新扫描。");
    const journal = await createWorkRecordJournal(dir, {
      kind: "lint",
      chapterId: cand.chapterId,
      candidateId: id,
      writes: [
        {
          file: `candidates/${id}.json`,
          before: candidateBefore,
          content: JSON.stringify(diskMeta, null, 2) + "\n",
        },
        {
          file: "ledger.json",
          before: ledgerBefore,
          content: JSON.stringify(ledger, null, 2) + "\n",
        },
      ],
    });
    await finishChapterJournal(dir, journal);
    return { token, lintedAt, hitCount, chapterId: cand.chapterId };
  });
}
/** True when candidate has a lint pass recorded at/after stagedAt. */
export function candidateHasLintPass(cand: Candidate) {
  if (!cand.lintPassToken || !cand.lintedAt || !cand.lintBodyHash || typeof cand.body !== "string")
    return false;
  const actual = sha256(cand.body);
  return cand.lintBodyHash === actual && Date.parse(cand.lintedAt) >= Date.parse(cand.stagedAt);
}
/**
 * Accept a staged candidate into the chapter draft. Explicit tool only —
 * never called implicitly by generation. Replaces or appends body per mode.
 *
 * Refuse rules (engineering gate — not AI judgment):
 * - already-accepted candidate → refuse (stage a new one)
 * - no recorded scan → scan inline; stale recorded scan → refuse
 * - lintPassToken provided but mismatches → refuse
 * - target chapter status is final → refuse unless force=true
 */
interface CandidateAcceptOptions {
  force?: boolean;
  expectedRevision?: string;
  lintPassToken?: string;
  validate?: (candidate: Candidate) => Promise<{ outline: string }>;
}
export async function acceptCandidate(
  dir: string,
  candidateId: string,
  mode: "append" | "replace" = "replace",
  opts: CandidateAcceptOptions = {},
) {
  const id = assertResourceId(candidateId, "候选 id");
  const acceptMode = mode;
  return withResourceLock(dir, async () => {
    await assertNoPendingAccept(dir);
    const candidatePath = path.join(candidatesDir(dir), `${id}.json`);
    const candidateBefore = await snapshotFile(candidatePath);
    const cand = await readCandidateUnlocked(dir, id);
    const chapterId = assertResourceId(cand.chapterId, "章节 id");
    if (cand.acceptedAt)
      throw new NovelError(
        "candidate_already_accepted",
        `候选 ${id} 已于 ${cand.acceptedAt} 采纳，禁止重复写回。请重新暂存候选。`,
      );
    if (!cand.body.trim()) throw new NovelError("candidate_empty", `候选 ${id} 正文为空，拒绝采纳`);
    if (!cand.lintPassToken) cand.lintHitCount = (await lintStyle(cand.body)).length;
    const checked = await opts.validate?.(cand);
    const provided = opts.lintPassToken;
    if (provided && (!cand.lintPassToken || cand.lintPassToken !== provided))
      throw new NovelError(
        "lint_token_mismatch",
        `lintPassToken 无效或不匹配，请对候选 ${id} 重新调用 style_lint。`,
      );
    if (!candidateHasLintPass(cand)) {
      if (cand.lintPassToken)
        throw new NovelError("lint_required", `候选 ${id} 在扫描后变化，请重新扫描。`);
      cand.lintBodyHash = sha256(cand.body);
      cand.lintedAt = nowIso();
      cand.lintPassToken = `inline-${randomUUID()}`;
    }
    if (
      cand.revisionSource &&
      ((await readWorkMeta(dir)).pace ?? null) !== cand.revisionSource.pace
    )
      throw new NovelError("context_changed", "修订采用的节奏已变化");
    if (cand.basis) await assertContextBasis(dir, cand.basis, chapterId);
    if (!cand.targetRevision && opts.expectedRevision === undefined)
      throw new NovelError(
        "legacy_baseline_required",
        "旧候选无目标版本，请传 expected_revision 明确核对当前目标，或重新暂存。",
      );
    const bodyFile = assertCandidateFile(cand.bodyFile ?? `${id}.md`);
    const bodyHash = await snapshotFile(path.join(candidatesDir(dir), bodyFile));
    if (!bodyHash || bodyHash !== sha256(cand.body))
      throw new NovelError("candidate_changed", "候选正文在采纳期间发生变化，请重新检查并扫描。");
    const chapterPath = path.join(dir, "chapters", `${assertResourceId(chapterId, "章节 id")}.md`);
    const [chapterBefore, metaBefore, ledgerBefore] = await Promise.all([
      snapshotFile(chapterPath),
      snapshotFile(metaPath(dir)),
      snapshotFile(ledgerPath(dir)),
    ]);
    const ledger = await readLedger(dir);
    let body = cand.body;
    let title = chapterId;
    let existingFinal = false;
    try {
      const existing = await readChapter(dir, chapterId);
      title = existing.title;
      if (checked && checked.outline !== fingerprint(existing.outline))
        throw new NovelError("context_changed", "章纲在采纳检查期间变化，请重核诊断与依据。");
      if (existing.status === "final") {
        existingFinal = true;
        if (!opts.force)
          throw new NovelError(
            "refuse_overwrite_final",
            `章节 ${chapterId} 已是 final，拒绝用候选取代。确需改稿请传 force=true，采纳后需重新定稿。`,
          );
      }
      if (acceptMode === "append") body = `${existing.body.trimEnd()}\n\n${cand.body}`;
    } catch (err) {
      if (!isMissingFileError(err)) throw err;
    }
    const prepared = await prepareChapterSaveUnlocked(dir, {
      id: chapterId,
      title,
      body,
      status: "drafted",
      force: opts.force,
      expectedRevision:
        acceptMode === "replace" ? (cand.targetRevision ?? opts.expectedRevision) : undefined,
      dependencies: cand.basis?.previous ? [cand.basis.previous] : [],
    });
    // The prepared intent already includes the versioned continuation index.
    const meta = JSON.parse(prepared.metaContent);
    const ending = prepared.record.outline.ending || "";
    const resolved = resolveHappenedText({ ending, body: prepared.record.body });
    const append = { appended: false, line: "", reason: "working_only" };
    const stateUpdate = { ending, resolved, append, threads: meta.foundation.threads };
    const acceptedAt = nowIso();
    const diskMeta = candidateToDiskMeta({ ...cand, acceptedAt, acceptedMode: acceptMode });
    appendLedger(ledger, {
      chapterId: chapterId,
      kind: "note",
      history: prepared.history,
      summary: existingFinal
        ? `强制采纳候选 ${id}（${acceptMode}，原 final→drafted）→ 本地草稿，未定稿`
        : `采纳候选 ${id}（${acceptMode}）→ 本地草稿，未定稿`,
    });
    await snapshotFiles(dir, [metaPath(dir), chapterPath]);
    const journalId = await createAcceptJournal(dir, {
      chapterId: chapterId,
      candidateId: id,
      mode: acceptMode,
      bodyFile,
      bodyHash,
      writes: [
        {
          file: `chapters/${chapterId}.md`,
          before: chapterBefore,
          content: prepared.chapterContent,
        },
        { file: "meta.json", before: metaBefore, content: prepared.metaContent },
        {
          file: `candidates/${id}.json`,
          before: candidateBefore,
          content: JSON.stringify(diskMeta, null, 2) + "\n",
        },
        {
          file: "ledger.json",
          before: ledgerBefore,
          content: JSON.stringify(ledger, null, 2) + "\n",
        },
      ],
    });
    await finishAcceptJournal(dir, journalId);
    return { ...prepared.record, stateUpdate };
  });
}

export async function listCandidates(dir: string) {
  let names;
  try {
    names = await readdir(candidatesDir(dir));
  } catch (err) {
    if (isMissingFileError(err)) return [];
    throw err;
  }
  const rows = [];
  for (const name of names) {
    if (!name.endsWith(".json")) continue;
    try {
      // mtime 缓存：面板每轮轮询都全量列候选，未变的候选不必重读。
      const raw = await readJsonCached(path.join(candidatesDir(dir), name));
      const bodyFile = candidateBodyFile(raw, name.slice(0, -5));
      const bodyStat = await stat(path.join(candidatesDir(dir), bodyFile));
      const metaStat = await stat(path.join(candidatesDir(dir), name));
      if (!bodyStat.isFile())
        throw new NovelError("bad_candidate", `候选 ${raw.id} 正文不是普通文件。`);
      // wordCount is persisted at stage time; only legacy rows re-read the body.
      let wordCount = typeof raw.wordCount === "number" ? raw.wordCount : 0;
      if (typeof raw.wordCount !== "number") {
        const body = await readFile(path.join(candidatesDir(dir), bodyFile), "utf8");
        wordCount = countWords(body);
      }
      rows.push({
        ...raw,
        readVersion: [
          metaStat.mtimeMs,
          metaStat.ctimeMs,
          metaStat.ino,
          metaStat.size,
          bodyStat.mtimeMs,
          bodyStat.ctimeMs,
          bodyStat.ino,
          bodyStat.size,
        ].join(":"),
        wordCount,
        pending: !raw.acceptedAt,
      });
    } catch (err) {
      rows.push({
        id: name.slice(0, -5),
        chapterId: "",
        stagedAt: "",
        pending: false,
        unavailable: true,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  rows.sort((a, b) => (a.stagedAt < b.stagedAt ? 1 : -1));
  return rows;
}

import { getRecentBrief } from "./work-records.js";
import { ledgerPath, candidatesDir } from "./paths.js";
