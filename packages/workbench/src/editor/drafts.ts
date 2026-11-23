/**
 * 未保存源码草稿的持久化读写：
 * - 文件后端：读写工作目录下的 `.zhizhang/drafts/<key>.json`
 * - 浏览器后端：兼容 `localStorage` 暂存，防止意外关闭丢失
 */
export const DRAFTS_DIR = ".zhizhang/drafts";
const PREFIX = "zhizhang:draft:";
const WORK_PARTS = 3;

export interface DraftEntry {
  text: string;
  savedAt: number;
  baseRevision: string;
}

export interface DraftFileBackend {
  readFile(filePath: string): Promise<string | null>;
  writeFile(filePath: string, content: string): Promise<void>;
  removeFile(filePath: string): Promise<void>;
  listFiles?(dirPath: string): Promise<string[]>;
}

function draftKey(parts: readonly (string | undefined)[]): string {
  return PREFIX + JSON.stringify(parts);
}

/** The draft of one slot ("official" or a candidate id) of a novel chapter. */
export function chapterDraftKey({
  base,
  work,
  chapter,
  slot,
}: {
  base?: string;
  work: string;
  chapter: string;
  slot: string;
}): string {
  return draftKey(["fanqie", base, work, chapter, slot]);
}

/** The draft of a Toutiao article's working text. */
export function articleDraftKey({ root, id }: { root: string; id: string }): string {
  return draftKey(["toutiao", root, id]);
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

export function draftFileName(key: string): string {
  const safe = key
    .replace(PREFIX, "")
    .replace(/[^a-zA-Z0-9_-]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 48);
  return `${safe || "draft"}-${fnv1aHex(key)}.json`;
}

export function draftFilePath(workDir: string, key: string): string {
  const base = workDir.replace(/[\\/]+$/, "");
  return `${base}/${DRAFTS_DIR}/${draftFileName(key)}`;
}

function isErrno(error: unknown, code: string): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === code
  );
}

function parseStored(raw: string): DraftEntry | null {
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
  if (!value || typeof value !== "object") return null;
  const text = "text" in value ? value.text : undefined;
  const savedAt = "savedAt" in value ? value.savedAt : undefined;
  const baseRevision = "baseRevision" in value ? value.baseRevision : undefined;
  if (
    typeof text === "string" &&
    typeof savedAt === "number" &&
    Number.isFinite(savedAt) &&
    "baseRevision" in value
  ) {
    return {
      text,
      savedAt,
      baseRevision: typeof baseRevision === "string" ? baseRevision : "",
    };
  }
  return null;
}

/** Node.js 文件系统后端（按需动态加载 node:fs/promises 与 node:path，避免影响浏览器打包）。 */
export function createNodeDraftBackend(): DraftFileBackend {
  return {
    async readFile(filePath: string): Promise<string | null> {
      const fs = await import("node:fs/promises");
      try {
        return await fs.readFile(filePath, "utf8");
      } catch (error) {
        if (isErrno(error, "ENOENT")) return null;
        throw error;
      }
    },
    async writeFile(filePath: string, content: string): Promise<void> {
      const fs = await import("node:fs/promises");
      const path = await import("node:path");
      const crypto = await import("node:crypto");
      const dir = path.dirname(filePath);
      await fs.mkdir(dir, { recursive: true });
      const tmp = path.join(dir, `.${path.basename(filePath)}.${crypto.randomUUID()}.tmp`);
      try {
        await fs.writeFile(tmp, content, "utf8");
        await fs.rename(tmp, filePath);
      } catch (error) {
        await fs.unlink(tmp).catch(() => undefined);
        throw error;
      }
    },
    async removeFile(filePath: string): Promise<void> {
      const fs = await import("node:fs/promises");
      try {
        await fs.unlink(filePath);
      } catch (error) {
        if (!isErrno(error, "ENOENT")) throw error;
      }
    },
    async listFiles(dirPath: string): Promise<string[]> {
      const fs = await import("node:fs/promises");
      try {
        return await fs.readdir(dirPath);
      } catch (error) {
        if (isErrno(error, "ENOENT")) return [];
        throw error;
      }
    },
  };
}

/** 从 `.zhizhang/drafts/` 读取草稿；内容损坏时自动清理并返回 null。 */
export async function readDraftFile(
  workDir: string,
  key: string,
  backend: DraftFileBackend = createNodeDraftBackend(),
): Promise<DraftEntry | null> {
  const filePath = draftFilePath(workDir, key);
  const raw = await backend.readFile(filePath);
  if (raw == null) return null;
  const draft = parseStored(raw);
  if (draft) return draft;
  await backend.removeFile(filePath);
  return null;
}

/** 将草稿写入 `.zhizhang/drafts/`，返回保存时间戳。 */
export async function writeDraftFile(
  workDir: string,
  key: string,
  text: string,
  baseRevision: string,
  backend: DraftFileBackend = createNodeDraftBackend(),
  now: () => number = Date.now,
): Promise<number> {
  const savedAt = now();
  const payload: DraftEntry = { text, savedAt, baseRevision };
  await backend.writeFile(draftFilePath(workDir, key), JSON.stringify(payload));
  return savedAt;
}

/** 删除 `.zhizhang/drafts/` 下指定草稿。 */
export async function clearDraftFile(
  workDir: string,
  key: string,
  backend: DraftFileBackend = createNodeDraftBackend(),
): Promise<void> {
  await backend.removeFile(draftFilePath(workDir, key));
}

function keyParts(key: string): unknown[] | null {
  try {
    const parts: unknown = JSON.parse(key.slice(PREFIX.length));
    return Array.isArray(parts) ? parts : null;
  } catch (error) {
    if (error instanceof SyntaxError) return null;
    throw error;
  }
}

/** The stored draft in browser localStorage, or null; an unreadable entry is removed. */
export function readDraft(key: string): DraftEntry | null {
  const raw = window.localStorage.getItem(key);
  if (raw == null) return null;
  const draft = parseStored(raw);
  if (draft) return draft;
  window.localStorage.removeItem(key);
  return null;
}

/** Stores draft in browser localStorage and returns the saved timestamp. */
export function writeDraft(
  key: string,
  text: string,
  baseRevision: string,
  now: () => number = Date.now,
): number {
  const savedAt = now();
  window.localStorage.setItem(key, JSON.stringify({ text, savedAt, baseRevision }));
  return savedAt;
}

export function clearDraft(key: string): void {
  window.localStorage.removeItem(key);
}

function storedDraftKeys(): string[] {
  const storage = window.localStorage;
  const keys: string[] = [];
  for (let index = 0; index < storage.length; index += 1) {
    const key = storage.key(index);
    if (key?.startsWith(PREFIX)) keys.push(key);
  }
  return keys;
}

/** Drafts of every other work, offered for clearing when storage is full. */
export function otherDraftKeys(key: string): string[] {
  const current = keyParts(key);
  const work = JSON.stringify((current ?? []).slice(0, WORK_PARTS));
  return storedDraftKeys().filter((other) => {
    const parts = keyParts(other);
    return parts !== null && JSON.stringify(parts.slice(0, WORK_PARTS)) !== work;
  });
}
