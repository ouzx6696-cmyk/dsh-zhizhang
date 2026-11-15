/**
 * 流水线运行记录落盘：<状态目录>/runs/<目标哈希>/<run-id>.json（RunRecord + 失败原因）。
 * 重启后据此列出历史，并把仍处于 running 的记录识别为中断。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AppError, type ErrorCode } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists, shortHash } from "@zhizhang/core/fs";
import { FORMAT_VERSION } from "@zhizhang/core/paths";
import type { RunRecord } from "@zhizhang/core/pipeline";
import type { RunDetail, RunSummary, Target } from "../../shared/views.js";
import { isMode } from "../modes.js";

export interface RunStore {
  save(detail: RunDetail): Promise<void>;
  get(target: Target, runId: string): Promise<RunDetail | undefined>;
  list(target: Target): Promise<RunDetail[]>;
  listAll(): Promise<RunDetail[]>;
}

const RUN_STATES = new Set(["running", "paused", "failed", "awaiting-author", "applied", "discarded", "cancelled"]);

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRunDetail(data: unknown): data is RunDetail {
  return (
    isRecord(data) &&
    data.format === FORMAT_VERSION &&
    typeof data.id === "string" &&
    typeof data.kind === "string" &&
    typeof data.state === "string" &&
    RUN_STATES.has(data.state) &&
    isRecord(data.target) &&
    Array.isArray(data.steps) &&
    Array.isArray(data.stateHistory)
  );
}

function parseRun(raw: string, file: string): RunDetail {
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    throw new AppError("storage.format_unsupported", `运行记录无法解析：${file}`, { file });
  }
  if (!isRunDetail(data)) {
    throw new AppError("storage.format_unsupported", `不支持的运行记录格式：${file}`, { file });
  }
  return data;
}
export function targetOfRun(record: RunRecord): Target {
  const mode = isMode(record.target.mode) ? record.target.mode : "fanqie";
  return {
    mode,
    path: record.target.path,
    ...(record.target.subId ? { subId: record.target.subId } : {}),
  };
}

export function summarizeRun(detail: RunDetail): RunSummary {
  const last = detail.stateHistory[detail.stateHistory.length - 1];
  return {
    id: detail.id,
    kind: detail.kind,
    target: targetOfRun(detail),
    state: detail.state,
    ...(last ? { reason: last.reason } : {}),
    stages: detail.steps.filter((s) => s.status === "done").map((s) => s.id),
    usage: detail.usage,
    ...(detail.error ? { error: detail.error } : {}),
    created: detail.created,
    updated: detail.updated,
  };
}

export function withError(record: RunRecord, error?: { code: ErrorCode; message: string }): RunDetail {
  return error ? { ...record, error } : { ...record };
}

export function createRunStore(root: string): RunStore {
  const dirOf = (target: { mode: string; path: string }) =>
    path.join(root, `${target.mode}-${shortHash(path.resolve(target.path))}`);

  async function readDir(dir: string): Promise<RunDetail[]> {
    const names = await fs.readdir(dir).catch(() => []);
    const out: RunDetail[] = [];
    for (const name of names) {
      if (!name.endsWith(".json")) continue;
      const file = path.join(dir, name);
      const raw = await readTextIfExists(file);
      if (raw !== undefined) out.push(parseRun(raw, file));
    }
    return out.sort((a, b) => b.created.localeCompare(a.created) || b.id.localeCompare(a.id));
  }

  return {
    async save(detail) {
      if (!/^[\w.-]+$/.test(detail.id)) throw new AppError("input.invalid", `运行 id 无效：${detail.id}`);
      await atomicWrite(path.join(dirOf(detail.target), `${detail.id}.json`), JSON.stringify(detail, null, 2));
    },
    async get(target, runId) {
      if (!/^[\w.-]+$/.test(runId)) throw new AppError("input.invalid", `运行 id 无效：${runId}`);
      const file = path.join(dirOf(target), `${runId}.json`);
      const raw = await readTextIfExists(file);
      return raw === undefined ? undefined : parseRun(raw, file);
    },
    list: (target) => readDir(dirOf(target)),
    async listAll() {
      const dirs = await fs.readdir(root, { withFileTypes: true }).catch(() => []);
      const all: RunDetail[] = [];
      for (const dir of dirs) {
        if (dir.isDirectory()) all.push(...(await readDir(path.join(root, dir.name))));
      }
      return all;
    },
  };
}
