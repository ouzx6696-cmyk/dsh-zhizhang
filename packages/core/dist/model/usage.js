import fs from "node:fs/promises";
import path from "node:path";
import { classify } from "../errors/classify.js";
import { readTextIfExists } from "../fs/read.js";
export function emptyUsageSummary() {
    return { input: 0, cachedInput: 0, output: 0, cost: 0, calls: 0 };
}
export function addUsageEntry(acc, entry) {
    const cost = acc.cost === null || entry.cost === null ? null : acc.cost + entry.cost;
    return {
        input: acc.input + entry.input,
        cachedInput: acc.cachedInput + entry.cachedInput,
        output: acc.output + entry.output,
        cost,
        calls: acc.calls + 1,
    };
}
export function summarizeUsage(entries) {
    let acc = emptyUsageSummary();
    for (const entry of entries) {
        acc = addUsageEntry(acc, entry);
    }
    return acc;
}
export function groupUsageByRole(entries) {
    const grouped = {};
    for (const entry of entries) {
        const prev = grouped[entry.role] ?? emptyUsageSummary();
        grouped[entry.role] = addUsageEntry(prev, entry);
    }
    return grouped;
}
export function groupUsageByModel(entries) {
    const grouped = {};
    for (const entry of entries) {
        const key = `${entry.connection}:${entry.model}`;
        const prev = grouped[key] ?? emptyUsageSummary();
        grouped[key] = addUsageEntry(prev, entry);
    }
    return grouped;
}
export function createUsageTracker() {
    const items = [];
    return {
        record(entry) {
            items.push(entry);
        },
        entries() {
            return [...items];
        },
        summary() {
            return summarizeUsage(items);
        },
        byRole() {
            return groupUsageByRole(items);
        },
        byModel() {
            return groupUsageByModel(items);
        },
    };
}
export async function appendUsageEntry(filePath, entry) {
    try {
        await fs.mkdir(path.dirname(filePath), { recursive: true });
        await fs.appendFile(filePath, `${JSON.stringify(entry)}\n`, "utf8");
    }
    catch (err) {
        throw classify(err);
    }
}
export async function readUsageEntries(filePath) {
    const raw = await readTextIfExists(filePath);
    if (!raw)
        return [];
    const entries = [];
    for (const line of raw.split(/\r?\n/)) {
        const trimmed = line.trim();
        if (!trimmed)
            continue;
        entries.push(JSON.parse(trimmed));
    }
    return entries;
}
