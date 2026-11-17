/**
 * 导入选文件：只把一次性令牌交给渲染层，绝对路径留在主进程（F3 §2）。
 * 令牌 10 分钟过期、用后即删；用后由 I-01 校验与 work 的绑定。
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { dialog, type BrowserWindow } from "electron";

const TOKEN_TTL_MS = 10 * 60 * 1000;
const MAX_BYTES = 20 * 1024 * 1024;
const ALLOWED = new Set([".txt", ".md"]);

interface TokenEntry {
  path: string;
  name: string;
  bytes: number;
  expiresAt: number;
}

export interface ImportPicker {
  pick(options: { title?: string }): Promise<{ token: string; name: string; bytes: number } | null>;
  /** 取走令牌对应的绝对路径；过期或不存在报 input.invalid（token_expired）。 */
  take(token: string): string;
}

export function createImportPicker(deps: {
  window(): BrowserWindow | undefined;
  clock: Clock;
}): ImportPicker {
  const tokens = new Map<string, TokenEntry>();

  function take(token: string): string {
    const entry = tokens.get(token);
    tokens.delete(token);
    if (!entry || deps.clock.now() >= entry.expiresAt) {
      throw new AppError("input.invalid", "导入令牌无效或已过期", { reason: "token_expired" });
    }
    return entry.path;
  }

  async function pick(options: {
    title?: string;
  }): Promise<{ token: string; name: string; bytes: number } | null> {
    const win = deps.window();
    const dialogOptions = {
      title: options.title ?? "选择导入文件",
      properties: ["openFile" as const],
      filters: [{ name: "TXT/MD", extensions: ["txt", "md"] }],
    };
    const result = win
      ? await dialog.showOpenDialog(win, dialogOptions)
      : await dialog.showOpenDialog(dialogOptions);
    if (result.canceled || !result.filePaths[0]) return null;

    const file = path.resolve(result.filePaths[0]);
    if (!ALLOWED.has(path.extname(file).toLowerCase())) {
      throw new AppError("input.invalid", "只接受 .txt 与 .md 文件", { reason: "file_type" });
    }
    const stat = await fs.stat(file);
    if (stat.size > MAX_BYTES) {
      throw new AppError("input.invalid", "导入文件超过 20 MB", {
        reason: "file_too_large",
        bytes: stat.size,
      });
    }

    const token = randomUUID();
    const name = path.basename(file);
    tokens.set(token, {
      path: file,
      name,
      bytes: stat.size,
      expiresAt: deps.clock.now() + TOKEN_TTL_MS,
    });
    return { token, name, bytes: stat.size };
  }

  return { pick, take };
}
