/** 文件工具：原子写、根目录越界检查、按路径串行化。只用 Node 标准库。 */
import {
  mkdir,
  readdir,
  readFile,
  realpath,
  rename,
  open,
  lstat,
  rm,
  stat,
  unlink,
} from "node:fs/promises";
import { randomBytes, createHash } from "node:crypto";
import path from "node:path";
import { WriterError } from "./tool.js";
import { isFsError, isMissingFileError } from "./errors.js";

export { isFsError, isMissingFileError } from "./errors.js";

const WINDOWS_BUSY = ["EPERM", "EACCES", "EBUSY"];
function windowsFileBusy(error: unknown) {
  return process.platform === "win32" && WINDOWS_BUSY.some((code) => isFsError(error, code));
}

/** Serialize lock-file transitions across processes. A crashed transition is left for inspection. */
export async function withFileGate<T>(
  file: string,
  fn: () => Promise<T>,
  waitMs = 10000,
): Promise<T> {
  const deadline = Date.now() + waitMs;
  let handle;
  for (;;) {
    try {
      handle = await open(file, "wx", 0o600);
      break;
    } catch (error) {
      const exists = isFsError(error, "EEXIST");
      // Windows can deny an open while the previous gate is pending deletion.
      if (!exists && !windowsFileBusy(error)) throw error;
      if (Date.now() >= deadline) {
        if (!exists) throw error;
        throw new WriterError(
          "CONFLICT",
          `锁登记正忙：${file}。请关闭所有织章实例，确认没有进程写入后删除此登记文件并重试。`,
        );
      }
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
  try {
    return await fn();
  } finally {
    await handle.close();
    await unlink(file);
  }
}

/** 把 rel 解析到 root 下；越界（含 .. 与绝对路径跳出）抛 OUT_OF_ROOT。 */
export function resolveInside(root: string, ...rel: string[]): string {
  const base = path.resolve(root);
  const target = path.resolve(base, ...rel);
  const relative = path.relative(base, target);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return target;
  throw new WriterError("OUT_OF_ROOT", `路径越界：${rel.join("/")}`);
}

/**
 * 读侧的路径沙箱：先按字面 resolveInside，再把根与目标都按 realpath 解析后比较，
 * 挡住经符号链接或 junction 逃出根目录的读取。目标不存在时检查最近的已存在祖先。
 * 返回解析后的真实路径（不存在的部分原样接在真实祖先后面）。
 */
export async function resolveRealInside(root: string, ...rel: string[]): Promise<string> {
  const target = resolveInside(root, ...rel);
  const realRoot = await realpath(root);
  let existing = target;
  const missing: string[] = [];
  for (;;) {
    try {
      existing = await realpath(existing);
      break;
    } catch (error) {
      if (!isMissingFileError(error) || existing === path.dirname(existing)) throw error;
      missing.unshift(path.basename(existing));
      existing = path.dirname(existing);
    }
  }
  const real = path.join(existing, ...missing);
  const relative = path.relative(realRoot, real);
  if (relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative))) return real;
  throw new WriterError("OUT_OF_ROOT", `路径越界（经链接指向目录外）：${rel.join("/")}`);
}

/** Reject links and non-directory ancestors before publishing a local file. Returns true if immediate parent exists. */
export async function assertSafeAncestors(file: string): Promise<boolean> {
  const immediate = path.resolve(path.dirname(file));
  let immediateExists = false;
  for (let current = immediate; ; current = path.dirname(current)) {
    try {
      const info = await lstat(current);
      if (info.isSymbolicLink() || !info.isDirectory())
        throw new WriterError("unsafe_path", `写入路径包含链接或非目录，拒绝越界风险：${current}`);
      if (current === immediate) immediateExists = true;
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    if (current === path.dirname(current)) break;
  }
  return immediateExists;
}

export async function atomicWrite(file: string, data: string): Promise<void> {
  const parentReady = await assertSafeAncestors(file);
  if (!parentReady) {
    await mkdir(path.dirname(file), { recursive: true });
    await assertSafeAncestors(file);
  }
  try {
    if ((await lstat(file)).isSymbolicLink())
      throw new WriterError("unsafe_path", `拒绝覆盖链接资产：${file}`);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
  const tmp = `${file}.${process.pid}.${randomBytes(8).toString("hex")}.tmp`;
  const handle = await open(tmp, "wx");
  try {
    try {
      await handle.writeFile(data, "utf8");
      await handle.sync();
    } finally {
      await handle.close();
    }
    await publish(tmp, file);
    if (process.platform !== "win32") {
      const directory = await open(path.dirname(file), "r");
      try {
        await directory.sync();
      } finally {
        await directory.close();
      }
    }
  } catch (error) {
    try {
      await rm(tmp, { force: true });
    } catch (cleanupError) {
      throw new AggregateError([error, cleanupError], "原子写入失败，临时文件清理也失败");
    }
    throw error;
  }
}

/** Windows briefly denies the rename while a reader, indexer or antivirus still holds the target open. */
async function publish(tmp: string, file: string): Promise<void> {
  const deadline = Date.now() + 2000;
  for (;;) {
    try {
      await rename(tmp, file);
      return;
    } catch (error) {
      if (!windowsFileBusy(error) || Date.now() >= deadline) throw error;
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
  }
}

/** Missing directories are empty; permission and IO errors remain visible. */
export async function listDir(dir: string) {
  try {
    return await readdir(dir, { withFileTypes: true });
  } catch (error) {
    if (isMissingFileError(error)) return [];
    throw error;
  }
}

export async function readText(file: string): Promise<string | undefined> {
  try {
    return await readFile(file, "utf8");
  } catch (err) {
    if (isMissingFileError(err)) return undefined;
    throw err;
  }
}

export async function readJson<T>(file: string): Promise<T | undefined> {
  const t = await readText(file);
  if (t === undefined) return undefined;
  try {
    return JSON.parse(t.replace(/^\uFEFF/, "")) as T;
  } catch (error) {
    throw new WriterError("CONFLICT", `JSON 文件损坏：${path.resolve(file)}`, { cause: error });
  }
}

export async function exists(p: string): Promise<boolean> {
  try {
    await stat(p);
    return true;
  } catch (error) {
    if (isMissingFileError(error)) return false;
    throw error;
  }
}

export function sha256(value: string | Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

export function shortId(prefix: string, n = 12): string {
  if (!Number.isSafeInteger(n) || n < 1 || n > 64) throw new RangeError("ID 长度必须为 1–64");
  return `${prefix}-${randomBytes(Math.ceil(n / 2))
    .toString("hex")
    .slice(0, n)}`;
}

/** 同一进程内对同一 key 的异步操作串行执行（防止并发读改写 meta.json 丢更新）。 */
const chains = new Map<string, Promise<unknown>>();
export function serialize<T>(key: string, fn: () => Promise<T>): Promise<T> {
  const prev = chains.get(key) ?? Promise.resolve();
  const run = prev.then(fn, fn);
  // allow-catch: queue continuation only; the original rejecting promise is returned to the caller.
  const tail = run.catch(() => undefined);
  chains.set(key, tail);
  void tail.then(() => {
    if (chains.get(key) === tail) chains.delete(key);
  });
  return run;
}

/** UTC timestamps compare independently of the machine timezone. */
export function nowIso(date: Date = new Date()): string {
  return date.toISOString();
}

/** Local calendar day (YYYY-MM-DD): article folders and backup names follow the author's clock. */
export function localDay(date: Date = new Date()): string {
  const pad = (value: number) => String(value).padStart(2, "0");
  return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
}
