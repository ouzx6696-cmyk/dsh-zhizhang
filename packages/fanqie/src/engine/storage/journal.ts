import { randomUUID } from "node:crypto";
import { hostname } from "node:os";
import { lstat, readFile, unlink } from "node:fs/promises";
import path from "node:path";
import { atomicWrite, isMissingFileError, nowIso, sha256 } from "../../../../core/src/fsx.js";
import { isRecord } from "../../../../core/src/parse.js";
import { NovelError } from "../errors.js";
import { createExclusive } from "./primitives.js";
import { withResourceLock } from "./process-lock.js";

export type InputWrite = {
  file: string;
  before: string | null;
  content?: string;
  target?: "work" | "inspiration";
};
type Confirmation = { id: string; fingerprint: string };
type Write = InputWrite & { after: string | null };
type Owner = { pid: number; host: string };
export type Target = {
  file: string;
  root?: string;
  target?: "work" | "inspiration";
  source?: string;
  absent?: boolean;
  present?: boolean;
  remove?: boolean;
};
type Guard = { file: string; before: string; missingAfter?: string };
type Decoded<M> = {
  details: M;
  targets: Target[];
  writes?: unknown;
  guards?: Guard[];
  marker?: string;
  cleanup?: string[];
  lock?: string;
};
type Spec<M, C> = {
  file: string;
  label: string;
  scope?: "library" | "inspiration";
  root: (context: C) => string;
  decode: (raw: Record<string, unknown>, context: C) => Decoded<M>;
  legacy?: boolean;
  completed?: string;
  pending?: string;
};
type Intent<M> = Decoded<M> & {
  id: string;
  owner: Owner;
  createdAt: string;
  writes: Write[];
  fingerprint: string;
};

export function object(value: unknown): Record<string, unknown> {
  if (!isRecord(value)) throw Error("应为对象");
  return value;
}
export function text(value: unknown): string {
  if (typeof value !== "string") throw Error("应为字符串");
  return value;
}
export function requireValid(condition: unknown): asserts condition {
  if (!condition) throw Error("恢复记录格式不正确");
}
export function validHash(value: unknown): value is string {
  return typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
}
export async function snapshotFile(file: string): Promise<string | null> {
  try {
    const info = await lstat(file);
    if (!info.isFile() || info.isSymbolicLink())
      throw new NovelError(
        "recovery_unsupported_file",
        `不能通过恢复流程覆盖非普通文件或符号链接：${file}`,
      );
    return sha256(await readFile(file));
  } catch (error) {
    if (isMissingFileError(error)) return null;
    throw error;
  }
}
export function ensureRecoveryOwnerInactive(owner: Owner) {
  if (owner.host !== hostname())
    throw new NovelError(
      "recovery_owner_unknown",
      "恢复记录来自另一台主机，无法确认原进程已停止；请先由管理员核对，暂不自动恢复。",
    );
  if (owner.pid === process.pid) return; // The caller holds the operation's resource locks.
  try {
    process.kill(owner.pid, 0);
  } catch (error) {
    if (error instanceof Error && "code" in error && error.code === "ESRCH") return;
    throw new NovelError("recovery_owner_unknown", "无法确认原进程是否停止，暂不自动恢复。");
  }
  throw new NovelError(
    "recovery_owner_active",
    "原进程仍存在（或进程号已复用），暂不自动恢复；请先核对原进程状态。",
  );
}
async function applyRecordedWrites(writes: Write[], code: string) {
  const current = await Promise.all(writes.map((w) => snapshotFile(w.file)));
  if (writes.some((w, i) => current[i] !== w.before && current[i] !== w.after))
    throw new NovelError(code, "文件与记录基线冲突，未继续写入；请保留现有文件与恢复记录。");
  for (const w of writes) {
    const now = await snapshotFile(w.file);
    if (now === w.after) continue;
    if (now !== w.before) throw new NovelError(code, `${w.file} 在恢复期间变化，已停止。`);
    if (w.after === null) await unlink(w.file);
    else {
      if (typeof w.content !== "string" || sha256(w.content) !== w.after)
        throw new NovelError(code, "恢复内容校验不正确。");
      await atomicWrite(w.file, w.content);
    }
  }
  if (
    (await Promise.all(writes.map((w) => snapshotFile(w.file)))).some(
      (v, i) => v !== writes[i].after,
    )
  )
    throw new NovelError(code, "写入后的文件变化，恢复记录已保留。");
}
async function removeIfMissingAllowed(file: string) {
  try {
    await unlink(file);
  } catch (error) {
    if (!isMissingFileError(error)) throw error;
  }
}
async function ensureMarker(file: string, id: string, code: string) {
  try {
    await createExclusive(file, JSON.stringify({ id }, null, 2) + "\n");
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error;
    await snapshotFile(file);
    if (object(JSON.parse(await readFile(file, "utf8"))).id !== id)
      throw new NovelError(code, "作品有另一份恢复标记，请保留并核对。");
  }
}

export function journal<M extends object, C>(spec: Spec<M, C>) {
  const prefix = spec.scope ? `${spec.scope}_` : "";
  const code = (suffix: string) => `${prefix}recovery_${suffix}`;
  const journalPath = (context: C) => path.join(spec.root(context), spec.file);
  const absolute = (context: C, target: Target) =>
    path.join(target.root ?? spec.root(context), target.file);
  const problem = (suffix: string, message: string) => new NovelError(code(suffix), message);
  async function has(context: C) {
    try {
      await lstat(journalPath(context));
      return true;
    } catch (error) {
      if (isMissingFileError(error)) return false;
      throw error;
    }
  }
  async function assertNone(context: C) {
    if (await has(context))
      throw problem(
        "required",
        `${spec.label}尚未完成，请先检查恢复记录，再决定是否恢复；不要重复操作。`,
      );
  }
  function decode(raw: string, context: C): Intent<M> {
    try {
      const r = object(JSON.parse(raw)),
        owner = object(r.owner);
      requireValid(
        (spec.legacy || r.version === 1) &&
          /^[a-f0-9-]{36}$/.test(text(r.id)) &&
          Number.isSafeInteger(owner.pid) &&
          Number(owner.pid) > 0,
      );
      const decoded = spec.decode(r, context),
        values = decoded.writes ?? r.writes;
      requireValid(Array.isArray(values) && values.length === decoded.targets.length);
      const writes = values.map((value: unknown, i: number): Write => {
        const w = object(value),
          target = decoded.targets[i];
        requireValid(
          w.file === target.file &&
            w.target === target.target &&
            (w.before === null || validHash(w.before)),
        );
        if (target.absent) requireValid(w.before === null);
        if (target.present) requireValid(validHash(w.before));
        if (target.remove) requireValid(w.after === null && w.content === undefined);
        else {
          requireValid(validHash(w.after));
          if (target.source) requireValid(w.content === undefined);
          else requireValid(typeof w.content === "string" && sha256(w.content) === w.after);
        }
        return {
          file: target.file,
          ...(target.target ? { target: target.target } : {}),
          before: w.before as string | null,
          after: w.after as string | null,
          ...(typeof w.content === "string" ? { content: w.content } : {}),
        };
      });
      return {
        ...decoded,
        id: text(r.id),
        owner: { pid: Number(owner.pid), host: text(owner.host) },
        createdAt: text(r.createdAt),
        writes,
        fingerprint: sha256(raw),
      };
    } catch {
      throw problem("invalid", `${spec.label}恢复记录格式或校验不正确，请保留原文件并人工核对。`);
    }
  }
  async function read(context: C) {
    const file = journalPath(context);
    try {
      await snapshotFile(file);
      return decode(await readFile(file, "utf8"), context);
    } catch (error) {
      if (isMissingFileError(error))
        throw new NovelError(
          `no_pending_${spec.file.split("-")[1]}`,
          `没有待恢复的${spec.label}。`,
        );
      throw error;
    }
  }
  async function classify(context: C, j: Intent<M>) {
    const hashes = await Promise.all(j.targets.map((t) => snapshotFile(absolute(context, t))));
    const writes = j.writes.map((w, i) => ({
      ...(w.target ? { target: w.target } : {}),
      file: w.file,
      state:
        hashes[i] === w.after
          ? w.after === null
            ? "已删除"
            : (spec.completed ?? "已写入")
          : hashes[i] === w.before
            ? w.after === null
              ? "待删除"
              : (spec.pending ?? "待写入")
            : "冲突",
    }));
    const guards = await Promise.all(
      (j.guards ?? []).map(async (g) => {
        const current = await snapshotFile(path.join(spec.root(context), g.file));
        const removed =
          current === null &&
          g.missingAfter !== undefined &&
          writes.some((w) => w.file === g.missingAfter && w.state === (spec.completed ?? "已写入"));
        return {
          file: g.file,
          state: current === g.before ? "未变化" : removed ? "已移除" : "冲突",
        };
      }),
    );
    return { writes, guards, conflict: [...writes, ...guards].some((w) => w.state === "冲突") };
  }
  async function create(context: C, fields: Record<string, unknown>) {
    const writes = fields.writes;
    const r = {
      version: 1,
      id: randomUUID(),
      owner: { pid: process.pid, host: hostname() },
      createdAt: nowIso(),
      ...fields,
      ...(Array.isArray(writes)
        ? {
            writes: writes.map((value: unknown) => {
              const w = object(value);
              return {
                ...w,
                after: typeof w.content === "string" ? sha256(w.content) : (w.after ?? null),
              };
            }),
          }
        : {}),
    };
    const j = decode(JSON.stringify(r), context);
    try {
      await createExclusive(journalPath(context), JSON.stringify(r, null, 2) + "\n");
    } catch (error) {
      if (error instanceof Error && "code" in error && error.code === "EEXIST")
        throw problem("required", `已有待恢复的${spec.label}，请先检查。`);
      throw error;
    }
    if (j.marker) await ensureMarker(j.marker, j.id, code("conflict"));
    return j.id;
  }
  async function apply(context: C, j: Intent<M>) {
    if (j.marker) await ensureMarker(j.marker, j.id, code("conflict"));
    const state = await classify(context, j);
    if (state.conflict)
      throw problem(
        "conflict",
        `以下文件已变化，未覆盖：${[...state.writes, ...state.guards]
          .filter((w) => w.state === "冲突")
          .map((w) => w.file)
          .join("、")}。请保留记录并核对。`,
      );
    const writes = await Promise.all(
      j.writes.map(async (w, i) => ({
        ...w,
        file: absolute(context, j.targets[i]),
        ...(j.targets[i].source && (await snapshotFile(absolute(context, j.targets[i]))) !== w.after
          ? { content: await readFile(text(j.targets[i].source), "utf8") }
          : {}),
      })),
    );
    await applyRecordedWrites(writes, code("conflict"));
    const verified = await classify(context, j);
    if (
      verified.conflict ||
      verified.writes.some((w) => !["已写入", "已完成", "已删除"].includes(w.state)) ||
      (await snapshotFile(journalPath(context))) !== j.fingerprint
    )
      throw problem("conflict", "文件或恢复记录在处理期间变化，未清除记录。");
    if (j.marker) {
      await snapshotFile(j.marker);
      if (object(JSON.parse(await readFile(j.marker, "utf8"))).id !== j.id)
        throw problem("conflict", "作品恢复标记已变化，未清除。");
      await unlink(j.marker);
    }
    for (const file of j.cleanup ?? []) await removeIfMissingAllowed(file);
    await unlink(journalPath(context));
  }
  async function finish(context: C, id: string) {
    try {
      const j = await read(context);
      if (j.id !== id) throw problem("conflict", "恢复记录已变化，未继续写入。");
      await apply(context, j);
    } catch (error) {
      if (error instanceof NovelError) throw error;
      throw problem(
        "required",
        `${spec.label}未完成（${error instanceof Error ? error.message : String(error)}），请先检查恢复记录。`,
      );
    }
  }
  async function inspect(context: C) {
    const j = await read(context);
    return {
      id: j.id,
      owner: j.owner,
      createdAt: j.createdAt,
      fingerprint: j.fingerprint,
      ...j.details,
      ...(await classify(context, j)),
    };
  }
  async function resume(context: C, expected?: Confirmation) {
    return withResourceLock(spec.root(context), async () => {
      const j = await read(context);
      const run = async () => {
        if (
          (expected && (j.id !== expected.id || j.fingerprint !== expected.fingerprint)) ||
          (await snapshotFile(journalPath(context))) !== j.fingerprint
        )
          throw problem("conflict", "恢复记录已变化，请重新检查并确认。");
        ensureRecoveryOwnerInactive(j.owner);
        await apply(context, j);
        return j.details;
      };
      return j.lock ? withResourceLock(j.lock, run) : run();
    });
  }
  return { has, assertNone, create, finish, inspect, resume };
}
