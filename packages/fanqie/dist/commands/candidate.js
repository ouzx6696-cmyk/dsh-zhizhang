import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, sha256 } from "@zhizhang/core/fs";
import { createLockService } from "@zhizhang/core/lock";
import { serializeChapterMarkdown } from "../domain/chapter.js";
import { countChineseWords, parsePlainDraft } from "../pipelines/chapter/index.js";
import { readChapter } from "./chapter.js";
export async function listCandidates(workPath, chapterId) {
    const root = path.join(workPath, "candidates");
    const chapterDirs = [];
    if (chapterId) {
        chapterDirs.push(chapterId);
    }
    else {
        try {
            const entries = await fs.readdir(root, { withFileTypes: true });
            for (const e of entries) {
                if (e.isDirectory())
                    chapterDirs.push(e.name);
            }
        }
        catch (err) {
            if (err.code === "ENOENT")
                return [];
            throw new AppError("storage.io", `无法读取候选目录：${root}`, { root });
        }
    }
    const out = [];
    for (const cid of chapterDirs) {
        const dir = path.join(root, cid);
        let files;
        try {
            files = await fs.readdir(dir);
        }
        catch (err) {
            if (err.code === "ENOENT")
                continue;
            throw new AppError("storage.io", `无法读取章节候选目录：${dir}`, { dir });
        }
        for (const file of files) {
            if (!file.endsWith(".md"))
                continue;
            const candId = file.slice(0, -3);
            const raw = await readTextIfExists(path.join(dir, file));
            if (!raw)
                continue;
            const parsed = parsePlainDraft(`${raw.trim()}\n<<<END>>>`);
            const accepted = (await readTextIfExists(path.join(dir, `${candId}.accepted.json`))) !== undefined;
            const rejected = (await readTextIfExists(path.join(dir, `${candId}.rejected.json`))) !== undefined;
            out.push({
                id: candId,
                chapterId: cid,
                title: parsed.title,
                wordCount: countChineseWords(parsed.body),
                accepted,
                rejected,
            });
        }
    }
    return out;
}
export async function readCandidate(workPath, chapterId, candidateId) {
    const filePath = path.join(workPath, "candidates", chapterId, `${candidateId}.md`);
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
export async function acceptCandidate(workPath, input, lock = createLockService(systemClock)) {
    return lock.write({ kind: "work", path: workPath }, async () => {
        const cand = await readCandidate(workPath, input.chapterId, input.candidateId);
        const prev = await readChapter(workPath, input.chapterId).catch(() => undefined);
        if (prev && prev.body.trim().length > 0) {
            const historyFile = path.join(workPath, "history", `${input.chapterId}-${prev.meta.revision}-${Date.now()}.md`);
            await atomicWrite(historyFile, serializeChapterMarkdown(prev));
        }
        const nextBody = input.mode === "append" && prev?.body
            ? `${prev.body.trimEnd()}\n\n${cand.body}`
            : cand.body;
        const doc = {
            meta: {
                id: input.chapterId,
                title: cand.title || prev?.meta.title || input.chapterId,
                status: "drafted",
                revision: `rev-${sha256(nextBody).slice(0, 8)}`,
                outline: prev?.meta.outline,
                scenes: prev?.meta.scenes,
                editorPass: false,
            },
            body: nextBody,
        };
        await atomicWrite(path.join(workPath, "chapters", `${input.chapterId}.md`), serializeChapterMarkdown(doc));
        await atomicWrite(path.join(workPath, "candidates", input.chapterId, `${input.candidateId}.accepted.json`), JSON.stringify({ acceptedAt: systemClock.iso(), revision: doc.meta.revision }, null, 2));
        return doc;
    });
}
export async function rejectCandidate(workPath, input, lock = createLockService(systemClock)) {
    return lock.write({ kind: "work", path: workPath }, async () => {
        await readCandidate(workPath, input.chapterId, input.candidateId);
        const rejectedAt = systemClock.iso();
        await atomicWrite(path.join(workPath, "candidates", input.chapterId, `${input.candidateId}.rejected.json`), JSON.stringify({ rejectedAt, reason: input.reason ?? "" }, null, 2));
        return { candidateId: input.candidateId, rejectedAt };
    });
}
