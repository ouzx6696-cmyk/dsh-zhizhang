import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { classify } from "../errors/classify.js";

const RENAME_RETRY_CODES = new Set(["EPERM", "EBUSY", "EACCES"]);
const RENAME_RETRY_DELAYS_MS = [25, 50, 100, 200, 400];

function errCode(err: unknown): string | undefined {
  if (typeof err === "object" && err !== null && "code" in err) {
    const code = Reflect.get(err, "code");
    return typeof code === "string" ? code : undefined;
  }
  return undefined;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function renameWithRetry(src: string, dest: string): Promise<void> {
  for (let attempt = 0; ; attempt++) {
    try {
      await fs.rename(src, dest);
      return;
    } catch (err) {
      const code = errCode(err);
      const delay = RENAME_RETRY_DELAYS_MS[attempt];
      if (!code || !RENAME_RETRY_CODES.has(code) || delay === undefined) {
        throw err;
      }
      await sleep(delay);
    }
  }
}

export interface AtomicWriteOptions {
  onEinval?: (dir: string) => void;
  mode?: number;
}

export async function atomicWrite(
  file: string,
  data: string | Uint8Array,
  opts?: AtomicWriteOptions,
): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(tmp, "wx", opts?.mode);
    await fh.writeFile(data);
    await fh.sync();
    await fh.close();
    fh = undefined;
    if (opts?.mode !== undefined && process.platform !== "win32") {
      await fs.chmod(tmp, opts.mode).catch(() => undefined);
    }
    await renameWithRetry(tmp, file);
    try {
      const dfd = await fs.open(dir, "r");
      try {
        await dfd.sync();
      } finally {
        await dfd.close();
      }
    } catch (err) {
      const code = errCode(err);
      if (code === "EINVAL" || code === "ENOTSUP" || code === "EPERM") {
        opts?.onEinval?.(dir);
      } else {
        throw err;
      }
    }
  } catch (err) {
    if (fh) await fh.close().catch(() => undefined);
    await fs.rm(tmp, { force: true }).catch(() => undefined);
    throw classify(err);
  }
}
