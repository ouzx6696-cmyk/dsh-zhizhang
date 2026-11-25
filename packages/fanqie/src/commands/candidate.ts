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
import { bool, int, obj, opt, str } from "@zhizhang/core/schema";
import { createLockService, type LockService } from "@zhizhang/core/lock";
import { serializeChapterMarkdown, type ChapterDocument } from "../domain/chapter.js";
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
  },
  { strict: false },
);

const DerivedFromMetaSchema = obj({ derivedFrom: opt(DerivedFromSchema) }, { strict: false });

function isEnoent(err: unknown): boolean {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}

async function reconcileDownstreamCandidates(
  workPath: string,
  acceptedChapterId: string,
  acceptedCandidateId: string,
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
      if (!derived || derived.kind !== "candidate" || derived.chapterId !== acceptedChapterId) {
        continue;
      }
      if (derived.candidateId === acceptedCandidateId) {
        const nextMeta = Object.assign({}, parsedUnknown, {
          derivedFrom: { kind: "final", chapterId: acceptedChapterId },
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
    const review = input.mode === "append" ? undefined : reviewed;

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

    const doc: ChapterDocument = {
      meta: {
        id: input.chapterId,
        title: cand.title || prev?.meta.title || input.chapterId,
        status: review ? "reviewed" : "drafted",
        revision: `rev-${sha256(nextBody).slice(0, 8)}`,
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

    await atomicWrite(
      resolveResourcePath(workPath, "chapters", `${input.chapterId}.md`),
      serializeChapterMarkdown(doc),
    );
    await atomicWrite(
      resolveResourcePath(
        workPath,
        "candidates",
        input.chapterId,
        `${input.candidateId}.accepted.json`,
      ),
      JSON.stringify({ acceptedAt: systemClock.iso(), revision: doc.meta.revision }, null, 2),
    );
    const staleDownstreamCandidates = await reconcileDownstreamCandidates(
      workPath,
      input.chapterId,
      input.candidateId,
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
