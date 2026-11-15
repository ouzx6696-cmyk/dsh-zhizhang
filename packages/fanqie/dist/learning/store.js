import fs from "node:fs/promises";
import path from "node:path";
import { systemClock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, sha256 } from "@zhizhang/core/fs";
const EMPTY_LEARNING = { patterns: [] };
const EMPTY_STYLE = { contract: "", rules: [], voiceSamples: [] };
const PROMOTE_THRESHOLD = 3;
async function readJsonOrFallback(file, fallback) {
    try {
        const raw = await fs.readFile(file, "utf8");
        return JSON.parse(raw);
    }
    catch (err) {
        if (err.code === "ENOENT")
            return fallback;
        throw new AppError("storage.format_unsupported", `Invalid learning/style file: ${file}`, { file });
    }
}
function ruleIdOf(signature) {
    return `learn-${sha256(signature).slice(0, 8)}`;
}
export function createLearningStore(lock) {
    const learningPath = (workPath) => path.join(workPath, "bible", "learning.json");
    const stylePath = (workPath) => path.join(workPath, "bible", "style.json");
    async function read(workPath) {
        return readJsonOrFallback(learningPath(workPath), EMPTY_LEARNING);
    }
    async function record(workPath, edits, meta = {}) {
        return lock.write({ kind: "work", path: workPath }, async () => {
            const state = await read(workPath);
            const patterns = [...state.patterns];
            const nowIso = meta.nowIso ?? systemClock.iso();
            const newlyPromoted = [];
            for (const edit of edits) {
                const existingIdx = patterns.findIndex((p) => p.signature === edit.signature);
                if (existingIdx === -1) {
                    const created = {
                        signature: edit.signature,
                        kind: edit.kind,
                        condition: edit.condition,
                        change: edit.change,
                        why: edit.why,
                        count: 1,
                        examples: [{ before: edit.before, after: edit.after, chapter: meta.chapter }],
                        promoted: false,
                        updatedAt: nowIso,
                    };
                    patterns.push(created);
                }
                else {
                    const prev = patterns[existingIdx];
                    const nextCount = prev.count + 1;
                    const nextExamples = [
                        ...prev.examples.slice(-4),
                        { before: edit.before, after: edit.after, chapter: meta.chapter },
                    ];
                    const shouldPromote = !prev.promoted && nextCount >= PROMOTE_THRESHOLD;
                    const updated = {
                        ...prev,
                        count: nextCount,
                        examples: nextExamples,
                        promoted: prev.promoted || shouldPromote,
                        updatedAt: nowIso,
                    };
                    patterns[existingIdx] = updated;
                    if (shouldPromote) {
                        newlyPromoted.push(updated);
                    }
                }
            }
            const nextState = { patterns };
            await atomicWrite(learningPath(workPath), JSON.stringify(nextState, null, 2));
            const promotedRules = [];
            if (newlyPromoted.length > 0) {
                const style = await readJsonOrFallback(stylePath(workPath), EMPTY_STYLE);
                const rules = [...style.rules];
                for (const pattern of newlyPromoted) {
                    const id = ruleIdOf(pattern.signature);
                    if (!rules.some((r) => r.id === id)) {
                        const rule = {
                            id,
                            condition: pattern.condition,
                            change: pattern.change,
                            why: pattern.why,
                        };
                        rules.push(rule);
                        promotedRules.push(rule);
                    }
                }
                const nextStyle = { ...style, rules };
                await atomicWrite(stylePath(workPath), JSON.stringify(nextStyle, null, 2));
            }
            return { state: nextState, promotedRules };
        });
    }
    return { read, record };
}
