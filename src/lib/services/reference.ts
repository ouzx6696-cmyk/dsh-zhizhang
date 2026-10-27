/** Local analysis artifacts stay outside the shared library until explicitly promoted. */
import { createHash, randomUUID } from "node:crypto";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, assertResourceId } from "../storage/primitives.js";
import { ZhizhangError } from "../errors.js";
import type { StoragePaths } from "../types.js";

export interface TransferPackage {
    experience: string;
    steps: string[];
    recreate: string[];
    discard: string[];
    failWhen: string;
}
export function validateTransfer(value: unknown): TransferPackage {
    const t = value as TransferPackage;
    if (!t || typeof t.experience !== "string" || !t.experience.trim() || typeof t.failWhen !== "string" || !t.failWhen.trim() ||
        ![t.steps, t.recreate, t.discard].every(a => Array.isArray(a) && a.every(v => typeof v === "string" && v.trim().length > 0)) || !t.steps.length)
        throw new ZhizhangError("bad_transfer", "迁移包须有 experience、steps、recreate、discard、failWhen；做法不能为空，不要求固定条数。");
    return t;
}
export async function analyzeReference(paths: StoragePaths, input: { text: string; question: string; report?: string; quotes?: string[]; transfer?: unknown; save?: boolean }) {
    if (!input.text.trim() || !input.question.trim()) throw new ZhizhangError("bad_args", "须指定原文与分析问题。");
    for (const quote of input.quotes ?? []) if (!quote.trim() || !input.text.includes(quote))
        throw new ZhizhangError("quote_not_found", "逐字引文未在指定材料命中，请改正或作为转述表达。");
    if (input.report !== undefined && !input.report.trim()) throw new ZhizhangError("empty_report", "分析报告为空。");
    const transfer = input.transfer === undefined ? undefined : validateTransfer(input.transfer);
    const artifact = { schemaVersion: 1, id: `ref-${randomUUID()}`, sourceHash: createHash("sha256").update(input.text).digest("hex"),
        sourceText: input.text, scope: "仅本次提供的原文；没有推断全书已读", question: input.question, report: input.report, quotes: input.quotes ?? [], transfer,
        note: "分析与迁移是声明；引文命中不证明文学效果。本成果未入公共库。" };
    if (input.save) {
        if (!input.report?.trim()) throw new ZhizhangError("report_required", "保存分析须提供实际报告。");
        await atomicWrite(path.join(paths.base, "analyses", `${artifact.id}.json`), JSON.stringify(artifact, null, 2) + "\n");
    }
    return artifact;
}
export async function readReference(paths: StoragePaths, id: string) {
    const artifact = JSON.parse(await readFile(path.join(paths.base, "analyses", `${assertResourceId(id)}.json`), "utf8"));
    if (!artifact || artifact.schemaVersion !== 1 || artifact.id !== id || !/^[a-f0-9]{64}$/.test(artifact.sourceHash) || typeof artifact.report !== "string")
        throw new ZhizhangError("bad_reference", "工作区分析成果格式损坏。");
    if (typeof artifact.sourceText !== "string" || createHash("sha256").update(artifact.sourceText).digest("hex") !== artifact.sourceHash || !Array.isArray(artifact.quotes) || artifact.quotes.some((q: unknown) => typeof q !== "string" || !artifact.sourceText.includes(q)))
        throw new ZhizhangError("bad_reference", "工作区原文快照或引文校验不一致。");
    if (artifact.transfer) validateTransfer(artifact.transfer);
    return artifact;
}
