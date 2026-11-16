/**
 * 草稿落盘服务（M0-2 D4）：正文与助手输入草稿的唯一写者，落在写作文件夹
 * `.zhizhang/drafts/<draftFileName(key)>.json`。同 key 串行（最后一次生效）；
 * 单条 ≤2 MB；未配置写作文件夹报 `input.invalid`（reason `no_workspace`），
 * 渲染层据此退化为内存暂存。草稿不是作品数据，只读实例下仍可写。
 * 本模块不触达 electron，便于引擎测试直接打包验证。
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { Clock } from "@zhizhang/core/clock";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite } from "@zhizhang/core/fs";
import {
  DRAFTS_DIR,
  draftFilePath,
  readDraftFile,
  type DraftEntry,
} from "@zhizhang/workbench/editor";

export const DRAFT_MAX_BYTES = 2 * 1024 * 1024;

export interface DraftListItem {
  key: string;
  savedAt: number;
  bytes: number;
}

export interface DraftService {
  read(key: string): Promise<DraftEntry | null>;
  write(key: string, text: string, baseRevision: string): Promise<{ savedAt: number }>;
  clear(key: string): Promise<void>;
  list(prefix?: string): Promise<DraftListItem[]>;
}

export interface DraftServiceOptions {
  /** 当前写作文件夹根目录；未配置时返回 undefined。 */
  root(): string | undefined;
  clock: Clock;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

export function createDraftService({ root, clock }: DraftServiceOptions): DraftService {
  const chains = new Map<string, Promise<unknown>>();
  const serialize = <T>(key: string, op: () => Promise<T>): Promise<T> => {
    const next = (chains.get(key) ?? Promise.resolve()).then(op, op);
    const tail = next.catch(() => undefined);
    chains.set(key, tail);
    void tail.then(() => {
      if (chains.get(key) === tail) chains.delete(key);
    });
    return next;
  };

  function requireRoot(): string {
    const dir = root();
    if (!dir) {
      throw new AppError("input.invalid", "未配置写作文件夹，草稿无法落盘", {
        reason: "no_workspace",
      });
    }
    return dir;
  }

  return {
    async read(key: string): Promise<DraftEntry | null> {
      return readDraftFile(requireRoot(), key);
    },

    async write(key: string, text: string, baseRevision: string): Promise<{ savedAt: number }> {
      const dir = requireRoot();
      if (Buffer.byteLength(text, "utf8") > DRAFT_MAX_BYTES) {
        throw new AppError("input.invalid", "草稿超过 2 MB，无法暂存", {
          reason: "draft_too_large",
          field: "text",
        });
      }
      return serialize(key, async () => {
        const savedAt = clock.now();
        // key 随载荷落盘，drafts.list 才能把文件名还原成草稿键。
        const payload = JSON.stringify({ key, text, savedAt, baseRevision });
        await atomicWrite(draftFilePath(dir, key), payload);
        return { savedAt };
      });
    },

    async clear(key: string): Promise<void> {
      const dir = requireRoot();
      await serialize(key, async () => {
        await fs.rm(draftFilePath(dir, key), { force: true });
      });
    },

    async list(prefix?: string): Promise<DraftListItem[]> {
      const dir = requireRoot();
      const dirPath = path.join(dir, ...DRAFTS_DIR.split("/"));
      let names: string[];
      try {
        names = await fs.readdir(dirPath);
      } catch (error) {
        if (isRecord(error) && error.code === "ENOENT") return [];
        throw error;
      }
      const items: DraftListItem[] = [];
      for (const name of names) {
        if (!name.endsWith(".json")) continue;
        const filePath = path.join(dirPath, name);
        try {
          const [raw, stat] = await Promise.all([fs.readFile(filePath, "utf8"), fs.stat(filePath)]);
          const parsed: unknown = JSON.parse(raw);
          if (!isRecord(parsed)) continue;
          if (typeof parsed.key !== "string" || typeof parsed.savedAt !== "number") continue;
          if (prefix && !parsed.key.startsWith(prefix)) continue;
          items.push({ key: parsed.key, savedAt: parsed.savedAt, bytes: stat.size });
        } catch {
          // 损坏的草稿文件不阻塞列表；读取时会自动清理。
        }
      }
      items.sort((a, b) => b.savedAt - a.savedAt);
      return items;
    },
  };
}
