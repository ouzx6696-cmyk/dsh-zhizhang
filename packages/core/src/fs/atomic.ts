import crypto from "node:crypto";
import fsSync from "node:fs";
import fs from "node:fs/promises";
import path from "node:path";
import { systemClock, type Clock } from "../clock.js";
import { AppError } from "../errors/app-error.js";
import { classify } from "../errors/classify.js";

export interface AtomicWriteOptions {
  onEinval?: (dir: string) => void;
  /** storage.locked（EPERM/EBUSY/EAGAIN）的最大重试次数；码表声明其为 transient/retry，默认 10。 */
  retries?: number;
  clock?: Clock;
}

/**
 * 同一目录（甚至同一目标文件）上的并发原子写在 Windows 上会瞬时 EPERM/EBUSY；
 * 安全软件对高频“临时文件 + 重命名”也可能短暂禁止建文件。重试按指数退避，
 * 总时长约 10 秒，足以吸收这两类瞬时封锁；若封锁持续更久（如安全软件长时拦截），
 * 会以 storage.locked 报错交给界面提示，由作者处理环境。
 */
const RETRY_BACKOFF_MS = [10, 20, 40, 80, 160, 320, 640, 1280, 2560, 5120];

export async function atomicWrite(
  file: string,
  data: string | Uint8Array,
  opts?: AtomicWriteOptions,
): Promise<void> {
  const maxRetries = opts?.retries ?? RETRY_BACKOFF_MS.length;
  const clock = opts?.clock ?? systemClock;
  for (let attempt = 0; ; attempt++) {
    try {
      await atomicWriteOnce(file, data, opts);
      return;
    } catch (err) {
      if (process.env.ZZ_ATOMIC_DEBUG && err instanceof Error) {
        // 临时调试：交付前移除。同目录不同文件名各建一个探针，确认拦截是否按文件名区分。
        try {
          const dir = path.dirname(file);
          const probe = (base: string) => {
            const p = path.join(dir, base);
            const fh = fsSync.openSync(p, "wx");
            fsSync.closeSync(fh);
            fsSync.rmSync(p, { force: true });
            return "OK";
          };
          const r1 = probe(`zzprobe-alpha.${process.pid}.${crypto.randomUUID()}.tmp`);
          const r2 = probe(`.zzprobe-dot.${process.pid}.${crypto.randomUUID()}.tmp`);
          const r3 = probe(`recent.json.${process.pid}.${crypto.randomUUID()}.tmp`);
          err.message = `[nodot=${r1} dot=${r2} recentNoDot=${r3}] ${err.message}`;
        } catch (probeErr) {
          err.message = `[probe-fail:${(probeErr as { code?: string }).code}] ${err.message}`;
        }
      }
      if (attempt >= maxRetries || !(err instanceof AppError) || err.code !== "storage.locked") {
        throw err;
      }
      await clock.sleep(RETRY_BACKOFF_MS[Math.min(attempt, RETRY_BACKOFF_MS.length - 1)]);
    }
  }
}

async function atomicWriteOnce(
  file: string,
  data: string | Uint8Array,
  opts?: AtomicWriteOptions,
): Promise<void> {
  const dir = path.dirname(file);
  await fs.mkdir(dir, { recursive: true });
  const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
  let fh: fs.FileHandle | undefined;
  try {
    fh = await fs.open(tmp, "wx");
    await fh.writeFile(data);
    await fh.sync();
    await fh.close();
    fh = undefined;
    await fs.rename(tmp, file);
    try {
      const dfd = await fs.open(dir, "r");
      try {
        await dfd.sync();
      } finally {
        await dfd.close();
      }
    } catch (err) {
      const code = (err as { code?: string }).code;
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
