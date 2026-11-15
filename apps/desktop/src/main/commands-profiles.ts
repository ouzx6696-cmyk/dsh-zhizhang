/**
 * profiles.* 命令：方法方案的查询、切换、复制、编辑与删除。
 * 内置方案只读（随包 profiles/<mode>/<id>），作者方案在状态目录 profiles/<mode>/<id>。
 */
import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { atomicWrite, readTextIfExists } from "@zhizhang/core/fs";
import {
  deleteUserAssetFile,
  forkBuiltinProfile,
  listUserProfiles,
  readUserAssetFile,
  saveUserAssetFile,
} from "@zhizhang/core/methods";
import { arr, bool, lit, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import type { CommandInput, CommandResult, WorkbenchCommand } from "@zhizhang/workbench/contract";
import type { Mode } from "../shared/views.js";

export interface ProfileDirs {
  builtin(mode: Mode): string;
  userDir: string;
}

type ProfileCommand = Extract<WorkbenchCommand, `profiles.${string}`>;
type Handler<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  dirs: ProfileDirs,
  now: () => number,
) => Promise<CommandResult<K>>;

const mode = lit("fanqie", "toutiao");
const fileId = str({ min: 1, max: 120 });

export const PROFILE_INPUTS: { [K in ProfileCommand]: Parser<CommandInput<K>> } = {
  "profiles.list": obj({ mode }),
  "profiles.detail": obj({ mode, profile: opt(str({ min: 1 })) }),
  "profiles.method": obj({ mode, profile: opt(str({ min: 1 })), id: fileId }),
  "profiles.use": obj({ mode, profile: str({ min: 1 }) }),
  "profiles.create": obj({
    mode,
    name: opt(str({ min: 1, max: 60 })),
    base: opt(str({ min: 1 })),
    note: opt(str({ max: 400 })),
    files: opt(arr(obj({ id: fileId, text: str({ max: 400_000 }) }), { max: 80 })),
  }),
  "profiles.save": obj({ mode, profile: str({ min: 1 }), id: fileId, text: str({ max: 400_000 }) }),
  "profiles.reset": obj({ mode, profile: str({ min: 1 }), id: fileId }),
  "profiles.rename": obj({
    mode,
    profile: str({ min: 1 }),
    name: str({ min: 1, max: 60 }),
    note: opt(str({ max: 400 })),
  }),
  "profiles.delete": obj({ mode, profile: str({ min: 1 }), confirm: bool }),
};

interface ProfileMeta {
  name?: string;
  base?: string;
  note?: string;
}

function safeSegment(value: string, label: string): string {
  if (!value || value === "." || value === ".." || /[\\/]/.test(value)) {
    throw new AppError("input.invalid", `${label} 无效：${value}`, { field: label });
  }
  return value;
}

async function readMeta(dir: string): Promise<ProfileMeta> {
  const raw = await readTextIfExists(path.join(dir, "profile.json"));
  if (raw === undefined) return {};
  try {
    const data: unknown = JSON.parse(raw);
    if (typeof data !== "object" || data === null) return {};
    const pick = (key: string) => (key in data ? Reflect.get(data, key) : undefined);
    const name = pick("name");
    const base = pick("base");
    const note = pick("note");
    return {
      ...(typeof name === "string" ? { name } : {}),
      ...(typeof base === "string" ? { base } : {}),
      ...(typeof note === "string" ? { note } : {}),
    };
  } catch {
    throw new AppError("storage.format_unsupported", `方案描述无法解析：${dir}`, { dir });
  }
}

async function builtinIds(dirs: ProfileDirs, m: Mode): Promise<string[]> {
  const entries = await fs.readdir(dirs.builtin(m), { withFileTypes: true }).catch(() => []);
  return entries
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort();
}

async function activeProfile(dirs: ProfileDirs, m: Mode): Promise<string> {
  const raw = await readTextIfExists(path.join(dirs.userDir, m, "active.json"));
  if (raw === undefined) return "default";
  try {
    const id: unknown = JSON.parse(raw).profile;
    return typeof id === "string" ? id : "default";
  } catch {
    return "default";
  }
}

/** 解析方案所在目录：作者方案优先，其次内置。 */
async function locate(
  dirs: ProfileDirs,
  m: Mode,
  id: string,
): Promise<{ dir: string; builtin: boolean }> {
  safeSegment(id, "profile");
  const user = path.join(dirs.userDir, m, id);
  if ((await fs.stat(user).catch(() => undefined))?.isDirectory())
    return { dir: user, builtin: false };
  const builtin = path.join(dirs.builtin(m), id);
  if ((await fs.stat(builtin).catch(() => undefined))?.isDirectory())
    return { dir: builtin, builtin: true };
  throw new AppError("input.not_found", `未找到方法方案：${id}`, { profile: id });
}

async function requireUserProfile(dirs: ProfileDirs, m: Mode, id: string): Promise<string> {
  const found = await locate(dirs, m, id);
  if (found.builtin)
    throw new AppError("gate.denied", "内置方案不能直接修改，请先复制为自己的方案", {
      profile: id,
    });
  return found.dir;
}

async function baseText(
  dirs: ProfileDirs,
  m: Mode,
  dir: string,
  file: string,
): Promise<string | undefined> {
  const meta = await readMeta(dir);
  return readTextIfExists(
    path.join(dirs.builtin(m), safeSegment(meta.base ?? "default", "base"), file),
  );
}

async function writeMeta(dir: string, meta: ProfileMeta & { id: string }): Promise<void> {
  await atomicWrite(path.join(dir, "profile.json"), `${JSON.stringify(meta, null, 2)}\n`);
}

export const PROFILE_HANDLERS: { [K in ProfileCommand]: Handler<K> } = {
  async "profiles.list"(input, dirs) {
    const profiles = [];
    for (const id of await builtinIds(dirs, input.mode)) {
      const meta = await readMeta(path.join(dirs.builtin(input.mode), id));
      profiles.push({
        id,
        name: meta.name ?? id,
        builtin: true,
        ...(meta.note ? { note: meta.note } : {}),
      });
    }
    for (const info of await listUserProfiles(dirs.userDir, input.mode)) {
      const meta = await readMeta(info.dir);
      profiles.push({
        id: info.id,
        name: info.name,
        builtin: false,
        ...(meta.base ? { base: meta.base } : {}),
        ...(meta.note ? { note: meta.note } : {}),
      });
    }
    return { mode: input.mode, active: await activeProfile(dirs, input.mode), profiles };
  },

  async "profiles.detail"(input, dirs) {
    const id = input.profile ?? (await activeProfile(dirs, input.mode));
    const found = await locate(dirs, input.mode, id);
    const meta = await readMeta(found.dir);
    const entries = await fs.readdir(found.dir, { withFileTypes: true });
    const files = [];
    for (const entry of entries) {
      if (!entry.isFile() || !/\.(md|json)$/.test(entry.name) || entry.name === "profile.json")
        continue;
      const text = await fs.readFile(path.join(found.dir, entry.name), "utf8");
      const original = found.builtin
        ? text
        : await baseText(dirs, input.mode, found.dir, entry.name);
      files.push({
        id: entry.name,
        size: text.length,
        ...(found.builtin ? {} : { modified: original !== text }),
      });
    }
    files.sort((a, b) => a.id.localeCompare(b.id));
    return { id, name: meta.name ?? id, files };
  },

  async "profiles.method"(input, dirs) {
    const id = input.profile ?? (await activeProfile(dirs, input.mode));
    const found = await locate(dirs, input.mode, id);
    const file = safeSegment(input.id, "id");
    const text = found.builtin
      ? await readTextIfExists(path.join(found.dir, file))
      : await readUserAssetFile(dirs.userDir, input.mode, id, file);
    if (text === undefined)
      throw new AppError("input.not_found", `方案中没有文件：${file}`, { id: file });
    if (found.builtin) return { method: { id: file, text, from: "builtin" } };
    const original = await baseText(dirs, input.mode, found.dir, file);
    return {
      method: { id: file, text, from: "user" },
      ...(original !== undefined && original !== text ? { base_text: original } : {}),
    };
  },

  async "profiles.use"(input, dirs) {
    await locate(dirs, input.mode, input.profile);
    await atomicWrite(
      path.join(dirs.userDir, input.mode, "active.json"),
      JSON.stringify({ profile: input.profile }),
    );
    return { profile: input.profile };
  },

  async "profiles.create"(input, dirs, now) {
    const base = input.base ?? "default";
    const builtin = await locate(dirs, input.mode, base);
    if (!builtin.builtin)
      throw new AppError("input.invalid", "只能以内置方案为底复制", { field: "base" });
    const id = `p-${now().toString(36)}`;
    const name = input.name ?? `${base} 副本`;
    const info = await forkBuiltinProfile(
      { builtinDir: dirs.builtin(input.mode), userDir: dirs.userDir },
      input.mode,
      base,
      id,
      name,
    );
    await writeMeta(info.dir, { id, name, base, ...(input.note ? { note: input.note } : {}) });
    for (const file of input.files ?? []) {
      await saveUserAssetFile(dirs.userDir, input.mode, id, safeSegment(file.id, "id"), file.text);
    }
    return { profile: id };
  },

  async "profiles.save"(input, dirs) {
    await requireUserProfile(dirs, input.mode, input.profile);
    if (input.id === "profile.json")
      throw new AppError("input.invalid", "方案描述请用重命名修改", { field: "id" });
    await saveUserAssetFile(
      dirs.userDir,
      input.mode,
      input.profile,
      safeSegment(input.id, "id"),
      input.text,
    );
    return { saved: true };
  },

  async "profiles.reset"(input, dirs) {
    const dir = await requireUserProfile(dirs, input.mode, input.profile);
    const file = safeSegment(input.id, "id");
    const original = await baseText(dirs, input.mode, dir, file);
    if (original === undefined) {
      return { reset: await deleteUserAssetFile(dirs.userDir, input.mode, input.profile, file) };
    }
    await saveUserAssetFile(dirs.userDir, input.mode, input.profile, file, original);
    return { reset: true };
  },

  async "profiles.rename"(input, dirs) {
    const dir = await requireUserProfile(dirs, input.mode, input.profile);
    const meta = await readMeta(dir);
    await writeMeta(dir, {
      ...meta,
      id: input.profile,
      name: input.name,
      ...(input.note !== undefined ? { note: input.note } : {}),
    });
    return { profile: input.profile };
  },

  async "profiles.delete"(input, dirs) {
    if (!input.confirm)
      throw new AppError("gate.denied", "删除方案需要作者确认", { field: "confirm" });
    const dir = await requireUserProfile(dirs, input.mode, input.profile);
    await fs.rm(dir, { recursive: true, force: true });
    if ((await activeProfile(dirs, input.mode)) === input.profile) {
      await atomicWrite(
        path.join(dirs.userDir, input.mode, "active.json"),
        JSON.stringify({ profile: "default" }),
      );
    }
    return { deleted: true };
  },
};
