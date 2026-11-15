/**
 * 去敏诊断：滚动日志 logs/main.log（JSON 行）与诊断导出。
 * 只记事件名、错误码、计数与路径；不记正文、提示词、密钥与作者偏好。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { atomicWrite, readTextIfExists } from "@zhizhang/core/fs";

const MAX_LOG_BYTES = 1024 * 1024;
const SECRET_KEYS = /key|token|secret|password|authorization/i;
const TEXT_KEYS = /^(text|body|content|prompt|system|user|preferences|summary)$/i;

export type DiagnosticFields = Record<string, string | number | boolean | null | undefined>;

function scrub(fields: DiagnosticFields): DiagnosticFields {
  const out: DiagnosticFields = {};
  for (const [key, value] of Object.entries(fields)) {
    if (SECRET_KEYS.test(key) || TEXT_KEYS.test(key)) continue;
    out[key] = typeof value === "string" ? value.slice(0, 400) : value;
  }
  return out;
}

export function createDiagnostics(logDir: string, clock: Clock) {
  const file = path.join(logDir, "main.log");
  let queue = Promise.resolve();

  async function append(line: string): Promise<void> {
    await fs.mkdir(logDir, { recursive: true });
    const size = (await fs.stat(file).catch(() => undefined))?.size ?? 0;
    if (size > MAX_LOG_BYTES) await fs.rename(file, `${file}.1`).catch(() => undefined);
    await fs.appendFile(file, line, "utf8");
  }

  return {
    write(event: string, fields: DiagnosticFields = {}): void {
      const line = `${JSON.stringify({ at: clock.iso(), event, ...scrub(fields) })}\n`;
      queue = queue.then(() => append(line)).catch(() => undefined);
    },
    async export(target: string, summary: Record<string, unknown>): Promise<void> {
      await queue;
      const tail = ((await readTextIfExists(file)) ?? "").split("\n").filter(Boolean).slice(-400);
      await atomicWrite(
        target,
        JSON.stringify({ format: "zhizhang/1.3", exportedAt: clock.iso(), ...summary, log: tail }, null, 2),
      );
    },
  };
}

export type Diagnostics = ReturnType<typeof createDiagnostics>;
