import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import {
  atomicWrite,
  resolveResourcePath,
  readJson,
  readTextIfExists,
  sha256,
} from "@zhizhang/core/fs";
import { commitIntent } from "@zhizhang/core/journal";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import { bool, int, lit, obj, opt, str } from "@zhizhang/core/schema";
import { serializeChapterMarkdown, type ChapterDocument } from "../domain/chapter.js";
import type { ChapterStatus } from "../domain/status.js";
import { countChineseWords, parsePlainDraft } from "../pipelines/chapter/rules.js";
import {
  DerivedFromSchema,
  ReviewResultSchema,
  type DerivedFrom,
} from "../pipelines/chapter/schemas.js";
import { readChapter } from "./chapter.js";

export interface CandidateView {
  id: string;
  chapterId: string;
  title: string;
  wordCount: number;
  accepted: boolean;
  rejected: boolean;
  derivedFrom?: DerivedFrom;
}

export interface StaleDownstreamCandidate {
  chapterId: string;
  candidateId: string;
  derivedFromChapterId: string;
  derivedFromCandidateId: string;
}

export type AcceptCandidateResult = ChapterDocument & {
  staleDownstreamCandidates: StaleDownstreamCandidate[];
};

const CandidateReview = obj(
  {
    bodyHash: str(),
    editorPass: bool,
    editorRejections: int({ min: 0 }),
    review: ReviewResultSchema,
    derivedFrom: opt(DerivedFromSchema),
    mode: opt(lit("revise", "deai", "polish")),
    reviewPerformed: opt(bool),
  },
  { strict: false },
);

const DerivedFromMetaSchema = obj({ derivedFrom: opt(DerivedFromSchema) }, { strict: false });

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

function toDerivedKind(status: ChapterStatus): "final" | "reviewed" | "drafted" {
  return status === "final" ? "final" : status === "reviewed" ? "reviewed" : "drafted";
}

async function reconcileDownstreamCandidates(
  workPath: string,
  acceptedChapterId: string,
  acceptedCandidateId: string,
  acceptedStatus: ChapterStatus,
  acceptedBodyHash: string,
): Promise<StaleDownstreamCandidate[]> {
  const root = path.join(workPath, "candidates");
  let entries: Array<{ name: string; isDirectory(): boolean }>;
  try {
    entries = await fs.readdir(root, { withFileTypes: true });
  } catch (err) {
    if (isEnoent(err)) return [];
    throw new AppError("storage.io", `无法读取候选目录：${root}`, { root });
  }

  const emptyFiles: string[] = [];
  const stale: StaleDownstreamCandidate[] = [];
  const promotedKind = toDerivedKind(acceptedStatus);
  for (const entry of entries) {
    if (!entry.isDirectory() || entry.name === acceptedChapterId) continue;
    const cid = entry.name;
    const dir = resolveResourcePath(workPath, "candidates", cid);
    const files = await fs.readdir(dir).catch(() => emptyFiles);
    for (const file of files) {
      if (!file.endsWith(".meta.json")) continue;
      const candidateId = file.slice(0, -".meta.json".length);
      const metaPath = resolveResourcePath(workPath, "candidates", cid, file);
      const raw = await readTextIfExists(metaPath);
      if (!raw) continue;
      let parsedUnknown: unknown;
      try {
        parsedUnknown = JSON.parse(raw);
      } catch {
        continue;
      }
      if (
        typeof parsedUnknown !== "object" ||
        parsedUnknown === null ||
        Array.isArray(parsedUnknown)
      )
        continue;
      let parsedMeta: { derivedFrom?: DerivedFrom };
      try {
        parsedMeta = DerivedFromMetaSchema(parsedUnknown, metaPath);
      } catch {
        continue;
      }
      const derived = parsedMeta.derivedFrom;
      if (!derived || derived.chapterId !== acceptedChapterId) continue;
      if (derived.kind === "candidate") {
        if (derived.candidateId === acceptedCandidateId) {
          const nextMeta = Object.assign({}, parsedUnknown, {
            derivedFrom: {
              kind: promotedKind,
              chapterId: acceptedChapterId,
              sourceHash: acceptedBodyHash,
            },
          });
          await atomicWrite(metaPath, JSON.stringify(nextMeta, null, 2));
        } else if (derived.candidateId) {
          stale.push({
            chapterId: cid,
            candidateId,
            derivedFromChapterId: acceptedChapterId,
            derivedFromCandidateId: derived.candidateId,
          });
        }
      } else if (derived.sourceHash && derived.sourceHash !== acceptedBodyHash) {
        stale.push({
          chapterId: cid,
          candidateId,
          derivedFromChapterId: acceptedChapterId,
          derivedFromCandidateId: derived.kind,
        });
      }
    }
  }
  return stale;
}

export async function listCandidates(
  workPath: string,
  chapterId?: string,
): Promise<CandidateView[]> {
  const root = path.join(workPath, "candidates");
  const chapterDirs: string[] = [];
  if (chapterId) {
    chapterDirs.push(chapterId);
  } else {
    try {
      const entries = await fs.readdir(root, { withFileTypes: true });
      for (const e of entries) {
        if (e.isDirectory()) chapterDirs.push(e.name);
      }
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") return [];
      throw new AppError("storage.io", `无法读取候选目录：${root}`, { root });
    }
  }

  const out: CandidateView[] = [];
  for (const cid of chapterDirs) {
    const dir = resolveResourcePath(workPath, "candidates", cid);
    let files: string[];
    try {
      files = await fs.readdir(dir);
    } catch (err) {
      if ((err as { code?: string }).code === "ENOENT") continue;
      throw new AppError("storage.io", `无法读取章节候选目录：${dir}`, { dir });
    }
    for (const file of files) {
      if (!file.endsWith(".md")) continue;
      const candId = file.slice(0, -3);
      const raw = await readTextIfExists(resolveResourcePath(workPath, "candidates", cid, file));
      if (!raw) continue;
      const parsed = parsePlainDraft(`${raw.trim()}\n<<<END>>>`);
      const accepted =
        (await readTextIfExists(
          resolveResourcePath(workPath, "candidates", cid, `${candId}.accepted.json`),
        )) !== undefined;
      const rejected =
        (await readTextIfExists(
          resolveResourcePath(workPath, "candidates", cid, `${candId}.rejected.json`),
        )) !== undefined;
      const meta = await readJson(
        resolveResourcePath(workPath, "candidates", cid, `${candId}.meta.json`),
        DerivedFromMetaSchema,
      ).catch(() => undefined);
      const normalizedDerived = meta?.derivedFrom
        ? {
            kind: meta.derivedFrom.kind,
            chapterId: meta.derivedFrom.chapterId,
            ...(meta.derivedFrom.candidateId ? { candidateId: meta.derivedFrom.candidateId } : {}),
            ...(meta.derivedFrom.sourceHash ? { sourceHash: meta.derivedFrom.sourceHash } : {}),
          }
        : undefined;
      out.push({
        id: candId,
        chapterId: cid,
        title: parsed.title,
        wordCount: countChineseWords(parsed.body),
        accepted,
        rejected,
        ...(normalizedDerived ? { derivedFrom: normalizedDerived } : {}),
      });
    }
  }
  return out;
}

export async function readCandidate(
  workPath: string,
  chapterId: string,
  candidateId: string,
): Promise<{ id: string; chapterId: string; title: string; body: string; wordCount: number }> {
  const filePath = resolveResourcePath(workPath, "candidates", chapterId, `${candidateId}.md`);
  const raw = await readTextIfExists(filePath);
  if (raw === undefined) {
    throw new AppError("input.not_found", `未找到候选稿：${chapterId}/${candidateId}`, {
      chapterId,
      candidateId,
    });
  }
  const parsed = parsePlainDraft(`${raw.trim()}\n<<<END>>>`);
  return {
    id: candidateId,
    chapterId,
    title: parsed.title,
    body: parsed.body,
    wordCount: countChineseWords(parsed.body),
  };
}

export async function acceptCandidate(
  workPath: string,
  input: {
    chapterId: string;
    candidateId: string;
    mode?: "replace" | "append";
    expectedRevision?: string;
  },
  lock: LockService = createLockService(systemClock),
): Promise<AcceptCandidateResult> {
  return lock.write({ kind: "work", path: workPath }, async () => {
    const cand = await readCandidate(workPath, input.chapterId, input.candidateId);
    const chapterPath = resolveResourcePath(workPath, "chapters", `${input.chapterId}.md`);
    const prevRaw = await readTextIfExists(chapterPath);
    const prev = await readChapter(workPath, input.chapterId).catch(() => undefined);
    if (
      input.expectedRevision !== undefined &&
      (prev?.meta.revision ?? "") !== input.expectedRevision
    ) {
      throw new AppError("storage.conflict", "正文已在别处修改，请刷新后再采纳");
    }
    const reviewed = await readJson(
      resolveResourcePath(
        workPath,
        "candidates",
        input.chapterId,
        `${input.candidateId}.meta.json`,
      ),
      CandidateReview,
    );
    if (reviewed && reviewed.bodyHash !== sha256(cand.body)) {
      throw new AppError("storage.conflict", "候选稿已变更，请重新审读");
    }
    const isFormalReview = Boolean(
      reviewed &&
      input.mode !== "append" &&
      reviewed.reviewPerformed !== false &&
      reviewed.mode !== "deai" &&
      reviewed.mode !== "polish",
    );
    const review = isFormalReview ? reviewed : undefined;

    if (prev && prev.body.trim().length > 0) {
      const historyFile = path.join(
        workPath,
        "history",
        `${input.chapterId}-${prev.meta.revision}-${Date.now()}.md`,
      );
      await atomicWrite(historyFile, serializeChapterMarkdown(prev));
    }

    const nextBody =
      input.mode === "append" && prev?.body ? `${prev.body.trimEnd()}\n\n${cand.body}` : cand.body;
    const nextStatus: ChapterStatus = review ? "reviewed" : "drafted";
    const nextBodyHash = sha256(nextBody);

    const doc: ChapterDocument = {
      meta: {
        id: input.chapterId,
        title: cand.title || prev?.meta.title || input.chapterId,
        status: nextStatus,
        revision: `rev-${nextBodyHash.slice(0, 8)}`,
        outline: prev?.meta.outline,
        scenes: prev?.meta.scenes,
        editorPass: review?.editorPass ?? false,
        editorRejections: review?.editorRejections,
        review: review
          ? {
              round: review.editorRejections + 1,
              verdict: review.review.verdict,
              quotes: review.review.issues.map((issue) => issue.quote),
              at: systemClock.iso(),
            }
          : undefined,
      },
      body: nextBody,
    };

    const acceptedPath = resolveResourcePath(
      workPath,
      "candidates",
      input.chapterId,
      `${input.candidateId}.accepted.json`,
    );
    const prevAcceptedRaw = await readTextIfExists(acceptedPath);
    await commitIntent(
      path.join(workPath, ".journal"),
      {
        format: FORMAT_VERSION,
        id: `accept-candidate-${input.chapterId}-${input.candidateId}-${systemClock.now()}`,
        writes: [
          {
            path: chapterPath,
            beforeHash: prevRaw === undefined ? null : sha256(prevRaw),
            after: serializeChapterMarkdown(doc),
          },
          {
            path: acceptedPath,
            beforeHash: prevAcceptedRaw === undefined ? null : sha256(prevAcceptedRaw),
            after: JSON.stringify(
              { acceptedAt: systemClock.iso(), revision: doc.meta.revision },
              null,
              2,
            ),
          },
        ],
        meta: {
          operation: "fanqie.candidate.accept",
          chapterId: input.chapterId,
          candidateId: input.candidateId,
        },
      },
      lock,
      { kind: "work", path: workPath },
    );
    const staleDownstreamCandidates = await reconcileDownstreamCandidates(
      workPath,
      input.chapterId,
      input.candidateId,
      nextStatus,
      nextBodyHash,
    );
    return { ...doc, staleDownstreamCandidates };
  });
}

export async function rejectCandidate(
  workPath: string,
  input: { chapterId: string; candidateId: string; reason?: string },
  lock: LockService = createLockService(systemClock),
): Promise<{ candidateId: string; rejectedAt: string }> {
  return lock.write({ kind: "work", path: workPath }, async () => {
    await readCandidate(workPath, input.chapterId, input.candidateId);
    const rejectedAt = systemClock.iso();
    await atomicWrite(
      resolveResourcePath(
        workPath,
        "candidates",
        input.chapterId,
        `${input.candidateId}.rejected.json`,
      ),
      JSON.stringify({ rejectedAt, reason: input.reason ?? "" }, null, 2),
    );
    return { candidateId: input.candidateId, rejectedAt };
  });
}
