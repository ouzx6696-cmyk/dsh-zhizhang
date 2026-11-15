/**
 * 未保存源码草稿的持久化读写：
 * - 文件后端：读写工作目录下的 `.zhizhang/drafts/<key>.json`
 * - 浏览器后端：兼容 `localStorage` 暂存，防止意外关闭丢失
 */
export const DRAFTS_DIR = ".zhizhang/drafts";
const PREFIX = "dsh-writer-draft:";
const WORK_PARTS = 3;
function draftKey(parts) {
    return PREFIX + JSON.stringify(parts);
}
/** The draft of one slot ("official" or a candidate id) of a novel chapter. */
export function chapterDraftKey({ base, work, chapter, slot, }) {
    return draftKey(["fanqie", base, work, chapter, slot]);
}
/** The draft of a Toutiao article's working text. */
export function articleDraftKey({ root, id }) {
    return draftKey(["toutiao", root, id]);
}
function fnv1aHex(input) {
    let hash = 0x811c9dc5;
    for (let i = 0; i < input.length; i += 1) {
        hash ^= input.charCodeAt(i);
        hash = Math.imul(hash, 0x01000193);
    }
    return (hash >>> 0).toString(16).padStart(8, "0");
}
export function draftFileName(key) {
    const safe = key
        .replace(PREFIX, "")
        .replace(/[^a-zA-Z0-9_-]+/g, "_")
        .replace(/^_+|_+$/g, "")
        .slice(0, 48);
    return `${safe || "draft"}-${fnv1aHex(key)}.json`;
}
export function draftFilePath(workDir, key) {
    const base = workDir.replace(/[\\/]+$/, "");
    return `${base}/${DRAFTS_DIR}/${draftFileName(key)}`;
}
function parseStored(raw) {
    let value;
    try {
        value = JSON.parse(raw);
    }
    catch (error) {
        if (error instanceof SyntaxError)
            return null;
        throw error;
    }
    if (!value || typeof value !== "object")
        return null;
    const record = value;
    if (typeof record.text === "string" &&
        typeof record.savedAt === "number" &&
        Number.isFinite(record.savedAt) &&
        "baseRevision" in record) {
        return {
            text: record.text,
            savedAt: record.savedAt,
            baseRevision: typeof record.baseRevision === "string" ? record.baseRevision : "",
        };
    }
    return null;
}
/** Node.js 文件系统后端（按需动态加载 node:fs/promises 与 node:path，避免影响浏览器打包）。 */
export function createNodeDraftBackend() {
    return {
        async readFile(filePath) {
            const fs = await import("node:fs/promises");
            try {
                return await fs.readFile(filePath, "utf8");
            }
            catch (error) {
                if (error?.code === "ENOENT")
                    return null;
                throw error;
            }
        },
        async writeFile(filePath, content) {
            const fs = await import("node:fs/promises");
            const path = await import("node:path");
            await fs.mkdir(path.dirname(filePath), { recursive: true });
            await fs.writeFile(filePath, content, "utf8");
        },
        async removeFile(filePath) {
            const fs = await import("node:fs/promises");
            try {
                await fs.unlink(filePath);
            }
            catch (error) {
                if (error?.code !== "ENOENT")
                    throw error;
            }
        },
        async listFiles(dirPath) {
            const fs = await import("node:fs/promises");
            try {
                return await fs.readdir(dirPath);
            }
            catch (error) {
                if (error?.code === "ENOENT")
                    return [];
                throw error;
            }
        },
    };
}
/** 从 `.zhizhang/drafts/` 读取草稿；内容损坏时自动清理并返回 null。 */
export async function readDraftFile(workDir, key, backend = createNodeDraftBackend()) {
    const filePath = draftFilePath(workDir, key);
    const raw = await backend.readFile(filePath);
    if (raw == null)
        return null;
    const draft = parseStored(raw);
    if (draft)
        return draft;
    await backend.removeFile(filePath);
    return null;
}
/** 将草稿写入 `.zhizhang/drafts/`，返回保存时间戳。 */
export async function writeDraftFile(workDir, key, text, baseRevision, backend = createNodeDraftBackend()) {
    const savedAt = Date.now();
    const payload = { text, savedAt, baseRevision };
    await backend.writeFile(draftFilePath(workDir, key), JSON.stringify(payload));
    return savedAt;
}
/** 删除 `.zhizhang/drafts/` 下指定草稿。 */
export async function clearDraftFile(workDir, key, backend = createNodeDraftBackend()) {
    await backend.removeFile(draftFilePath(workDir, key));
}
function keyParts(key) {
    try {
        const parts = JSON.parse(key.slice(PREFIX.length));
        return Array.isArray(parts) ? parts : null;
    }
    catch (error) {
        if (error instanceof SyntaxError)
            return null;
        throw error;
    }
}
/** The stored draft in browser localStorage, or null; an unreadable entry is removed. */
export function readDraft(key) {
    const raw = window.localStorage.getItem(key);
    if (raw == null)
        return null;
    const draft = parseStored(raw);
    if (draft)
        return draft;
    window.localStorage.removeItem(key);
    return null;
}
/** Stores draft in browser localStorage and returns the saved timestamp. */
export function writeDraft(key, text, baseRevision) {
    const savedAt = Date.now();
    window.localStorage.setItem(key, JSON.stringify({ text, savedAt, baseRevision }));
    return savedAt;
}
export function clearDraft(key) {
    window.localStorage.removeItem(key);
}
function storedDraftKeys() {
    const storage = window.localStorage;
    const keys = [];
    for (let index = 0; index < storage.length; index += 1) {
        const key = storage.key(index);
        if (key?.startsWith(PREFIX))
            keys.push(key);
    }
    return keys;
}
/** Drafts of every other work, offered for clearing when storage is full. */
export function otherDraftKeys(key) {
    const current = keyParts(key);
    const work = JSON.stringify((current ?? []).slice(0, WORK_PARTS));
    return storedDraftKeys().filter((other) => {
        const parts = keyParts(other);
        return parts !== null && JSON.stringify(parts.slice(0, WORK_PARTS)) !== work;
    });
}
