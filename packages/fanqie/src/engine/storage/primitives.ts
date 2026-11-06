/** Shared process-local synchronization and filesystem primitives. */
import { open, unlink } from "node:fs/promises";
import { NovelError } from "../errors.js";
import { isMissingFileError, serialize } from "../../../../core/src/fsx.js";
/** Shared queue, separate namespace from unrelated core file updates. */
export function withLock<T>(key: string, fn: () => T | Promise<T>): Promise<T> {
  return serialize(`novel:${key}`, async () => fn());
}
/** 独占创建并落盘（wx + fsync）；EEXIST 原样抛出由调用方处理，写失败时清理半成品。 */
export async function createExclusive(file: string, data: string | Uint8Array): Promise<void> {
  const handle = await open(file, "wx", 0o600);
  try {
    try {
      await handle.writeFile(data);
      await handle.sync();
    } finally {
      await handle.close();
    }
  } catch (error) {
    try {
      await unlink(file);
    } catch (cleanupError) {
      if (!isMissingFileError(cleanupError))
        throw new AggregateError([error, cleanupError], "独占写入与清理均失败");
    }
    throw error;
  }
}
export function countWords(text: string) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const cjk =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)
      ?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}
/** One safe path segment for chapter / candidate ids (no separators, no traversal). */
const SAFE_RESOURCE_ID = /^[^/\\\u0000-\u001f]{1,64}$/;
/** Windows 保留设备名：主干命中即拒绝（con.txt 与 con 同样不可用）。 */
export const WINDOWS_RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i;
export function assertResourceId(id: string, label: string = "id") {
  const t = id.trim();
  if (
    !t ||
    !SAFE_RESOURCE_ID.test(t) ||
    t === "." ||
    t === ".." ||
    WINDOWS_RESERVED_NAME.test(t) ||
    /[<>:"|?*]/.test(t) ||
    /[. ]$/.test(t)
  ) {
    throw new NovelError("bad_id", `${label} 非法（禁止目录穿越 / 保留名）：${t.slice(0, 80)}`);
  }
  return t;
}
export {
  atomicWrite,
  assertSafeAncestors,
  nowIso,
  isMissingFileError,
} from "../../../../core/src/fsx.js";

export function assertCandidateFile(value: unknown): string {
  if (typeof value !== "string" || !/^[A-Za-z0-9][A-Za-z0-9._-]*\.md$/.test(value))
    throw new NovelError("bad_candidate", "候选正文文件名非法，请保留文件并核对。");
  return value;
}
export function assertSourceId(value: unknown): string {
  if (typeof value !== "string" || !/^src-[A-Za-z0-9_-]{1,64}$/.test(value))
    throw new NovelError("bad_args", "sourceId 非法");
  return value;
}
