/**
 * 方法方案：模型读取的方法论按"方案"组织，每种写作模式各有一套。
 *   default  默认    客户端自带的精炼版（推荐）
 *   original 原版    上游原件，保留作参考与兜底
 *   user-N   用户方案N 作者提交的版本：以某个内置方案为底，逐份覆盖或新增
 * 读取顺序：用户方案的覆盖 → 它的底（默认或原版）；默认里没有的 id 回落到原版。
 * 当前方案存在 <方案目录>/active.json；配置 <mode>.profile 可以钉死。
 */
import { rm } from "node:fs/promises";
import { stateRoot } from "./paths.js";
import path from "node:path";
import { WriterError } from "./tool.js";
import { errorText } from "./errors.js";
import { isRecord } from "./parse.js";
import {
  exists,
  nowIso,
  listDir,
  atomicWrite,
  readJson,
  readText,
  resolveInside,
  serialize,
} from "./fsx.js";

export type ProfileMode = "toutiao" | "fanqie";
export type BuiltinProfile = "default" | "original";
const BUILTIN_NAMES: Record<BuiltinProfile, string> = { default: "默认", original: "原版" };
const BUILTIN_NOTES: Record<BuiltinProfile, string> = {
  default: "内置精炼版：去重、去空话、对齐质检规则与工具（推荐）",
  original: "上游原件，未改动；作参考与兜底",
};
export const PROFILE_LIMITS = {
  textBytes: 256 * 1024,
  methodsPerProfile: 300,
  profilesPerMode: 20,
  nameChars: 24,
} as const;

export interface MethodText {
  id: string;
  text: string;
  file: string;
  title?: string;
}
export interface MethodEntry {
  id: string;
  title?: string;
}

/** 每种模式提供：两个内置方案的目录与读取 */
export interface MethodLibrary {
  mode: ProfileMode;
  defaultIds(): Promise<MethodEntry[]>;
  originalIds(): Promise<string[]>;
  /** id 已规范化；读不到返回 undefined */
  readDefault(id: string): Promise<MethodText | undefined>;
  readOriginal(id: string): Promise<MethodText | undefined>;
  /** 原版 id 或别名 → 默认方案 id（找不到原样返回） */
  canonical(id: string): string;
}

export interface ProfileMeta {
  id: string;
  name: string;
  mode: ProfileMode;
  kind: "builtin" | "user";
  base?: BuiltinProfile;
  note?: string;
  created_at?: string;
  updated_at?: string;
}

export interface ResolvedMethod extends MethodText {
  profile: string;
  profile_name: string;
  /** 这份内容实际来自哪里 */
  from: "user" | BuiltinProfile;
}

let configuredRoot: string | undefined;
export function setProfilesRoot(dir: string | undefined) {
  configuredRoot = dir?.trim() || undefined;
}
function profilesRoot(): string {
  if (configuredRoot) return path.resolve(configuredRoot);
  if (process.env.WRITER_PROFILES_DIR?.trim())
    return path.resolve(process.env.WRITER_PROFILES_DIR.trim());
  return path.join(stateRoot(), "writer", "profiles");
}

const modeDir = (mode: ProfileMode) => path.join(profilesRoot(), mode);
const isBuiltin = (id: string): id is BuiltinProfile => id === "default" || id === "original";
const USER_ID = /^user-(\d{1,3})$/;
/** user-N → N（id 均已通过 USER_ID 校验，不必再 match） */
const userSeq = (id: string) => Number(id.slice("user-".length));

const DIGITS = "零一二三四五六七八九";
/** 1 → 一，10 → 十，12 → 十二，25 → 二十五 */
function chineseNumber(n: number): string {
  if (n < 10) return DIGITS[n];
  if (n < 20) return "十" + (n % 10 ? DIGITS[n % 10] : "");
  if (n < 100) return DIGITS[Math.floor(n / 10)] + "十" + (n % 10 ? DIGITS[n % 10] : "");
  return String(n);
}

/** 方法 id：中文、字母、数字、- _ . /，不能越级 */
function checkMethodId(id: string): string {
  const clean = id
    .trim()
    .replace(/\\/g, "/")
    .replace(/^\.?\//, "")
    .replace(/\.md$/i, "");
  if (
    !clean ||
    clean.length > 120 ||
    /[\u0000-\u001f<>:"|?*]/.test(clean) ||
    clean.split("/").some((s) => s === ".." || s === "." || !s.trim())
  ) {
    throw new WriterError(
      "INVALID_ARGS",
      `方法 id 不合法：${id}（不能含 < > : " | ? * 或越级路径）`,
    );
  }
  return clean;
}

/** 与方案 id 同形的名称会让"按名称找"命中别的方案，一律保留给 id。 */
const isReservedName = (name: string) => /^(default|original|user-\d+)$/i.test(name);

function checkName(name: string): string {
  const n = name.trim();
  if (!n || [...n].length > PROFILE_LIMITS.nameChars || /[\r\n\t]/.test(n))
    throw new WriterError("INVALID_ARGS", `方案名须为 1–${PROFILE_LIMITS.nameChars} 个字`);
  if (isReservedName(n))
    throw new WriterError("INVALID_ARGS", `方案名不能用 default、original 或 user-数字：${n}`);
  return n;
}

function checkText(text: unknown): string {
  if (typeof text !== "string" || !text.trim())
    throw new WriterError("INVALID_ARGS", "方法内容不能为空");
  if (Buffer.byteLength(text) > PROFILE_LIMITS.textBytes)
    throw new WriterError("INVALID_ARGS", `单份方法不能超过 ${PROFILE_LIMITS.textBytes / 1024}KB`);
  return text.replace(/\r\n/g, "\n");
}

async function userDirs(mode: ProfileMode): Promise<string[]> {
  return (await listDir(modeDir(mode)))
    .filter((e) => e.isDirectory() && USER_ID.test(e.name))
    .map((e) => e.name);
}

/** 读不出来的用户方案：按目录名占位，保留原因与文件位置，不让一份坏文件拖垮整个列表。 */
export interface BrokenProfile {
  id: string;
  broken: string;
}
type UserProfile = ProfileMeta | BrokenProfile;
const isBroken = (row: UserProfile): row is BrokenProfile => "broken" in row;
const optionalText = (value: unknown) => (typeof value === "string" ? value : undefined);

/** profile.json 是磁盘上的作者数据，在读文件边界解析成 ProfileMeta，只取已知字段；不合格的按损坏行返回。 */
function parseProfileMeta(
  mode: ProfileMode,
  dir: string,
  file: string,
  value: unknown,
): UserProfile {
  const broken = (reason: string): BrokenProfile => ({ id: dir, broken: `${reason}：${file}` });
  if (!isRecord(value)) return broken("内容不是对象");
  if (value.id !== dir) return broken(`id 与目录不符（文件里是 ${String(value.id)}）`);
  if (typeof value.name !== "string" || !value.name.trim()) return broken("缺少方案名");
  if (value.base !== undefined && value.base !== "default" && value.base !== "original")
    return broken(`底稿方案无效：${String(value.base)}`);
  return {
    id: dir,
    name: value.name,
    mode,
    kind: "user",
    base: value.base ?? "default",
    note: optionalText(value.note),
    created_at: optionalText(value.created_at),
    updated_at: optionalText(value.updated_at),
  };
}

async function userMetas(mode: ProfileMode): Promise<UserProfile[]> {
  const entries = await userDirs(mode);
  const loaded = await Promise.all(
    entries.map(async (name): Promise<UserProfile | undefined> => {
      const file = path.join(modeDir(mode), name, "profile.json");
      let raw: unknown;
      try {
        raw = await readJson<unknown>(file);
      } catch (error) {
        if (!(error instanceof WriterError && error.code === "CONFLICT")) throw error;
        return { id: name, broken: errorText(error) };
      }
      // 没有 profile.json 的目录是新建中途失败的残留（只占编号），不是方案。
      return raw === undefined ? undefined : parseProfileMeta(mode, name, file, raw);
    }),
  );
  return loaded
    .filter((m): m is UserProfile => m !== undefined)
    .sort((a, b) => userSeq(a.id) - userSeq(b.id));
}

const healthy = (rows: UserProfile[]) => rows.filter((row): row is ProfileMeta => !isBroken(row));

function builtinMeta(mode: ProfileMode, id: BuiltinProfile): ProfileMeta {
  return { id, name: BUILTIN_NAMES[id], mode, kind: "builtin", note: BUILTIN_NOTES[id] };
}

/** 按 id 或名称找方案（"用户方案一"、"默认" 都行） */
export async function findProfile(mode: ProfileMode, key: string): Promise<ProfileMeta> {
  const k = key.trim();
  if (isBuiltin(k)) return builtinMeta(mode, k);
  for (const b of ["default", "original"] as const)
    if (BUILTIN_NAMES[b] === k) return builtinMeta(mode, b);
  const rows = await userMetas(mode);
  const users = healthy(rows);
  // id 优先：名称与别的方案 id 撞上时，按 id 找到的才是作者指的那一个。
  const byId = rows.find((u) => u.id === k);
  if (byId && isBroken(byId))
    throw new WriterError("CONFLICT", `方案 ${byId.id} 已损坏：${byId.broken}`);
  const hit = byId ?? users.find((u) => u.name === k);
  if (!hit)
    throw new WriterError(
      "NOT_FOUND",
      `没有这个方案：${key}。可选：默认、原版${users.length ? "、" + users.map((u) => u.name).join("、") : ""}`,
    );
  return hit;
}

async function overrideIds(mode: ProfileMode, id: string): Promise<string[]> {
  const root = path.join(modeDir(mode), id, "methods");
  const out: string[] = [];
  const walk = async (d: string) => {
    const entries = await listDir(d);
    await Promise.all(
      entries.map(async (e) => {
        const p = path.join(d, e.name);
        if (e.isDirectory()) await walk(p);
        else if (e.isFile() && e.name.endsWith(".md"))
          out.push(path.relative(root, p).split(path.sep).join("/").replace(/\.md$/, ""));
      }),
    );
  };
  await walk(root);
  return out.sort();
}

/* ---------------- 当前方案 ---------------- */

const activeFile = () => path.join(profilesRoot(), "active.json");

/** 当前方案的键：配置钉死的优先，其次 active.json 里存的，都没有就是默认。 */
async function activeKey(mode: ProfileMode, pinned?: string) {
  if (pinned) return { key: pinned, pinned: true };
  const raw = await readJson<unknown>(activeFile());
  const saved = isRecord(raw) && typeof raw[mode] === "string" ? raw[mode] : "";
  return { key: saved || "default", pinned: false };
}

export async function activeProfile(
  mode: ProfileMode,
  pinned?: string,
): Promise<ProfileMeta & { pinned: boolean }> {
  const active = await activeKey(mode, pinned);
  return { ...(await findProfile(mode, active.key)), pinned: active.pinned };
}

export async function activateProfile(
  mode: ProfileMode,
  key: string,
  pinned?: string,
): Promise<ProfileMeta> {
  const m = await findProfile(mode, key);
  if (pinned) {
    throw new WriterError(
      "CONFLICT",
      `配置里 ${mode}.profile 已固定为「${pinned}」，要切换请先改配置`,
    );
  }
  await serialize(activeFile(), async () => {
    const cur = (await readJson<Record<string, string>>(activeFile())) ?? {};
    cur[mode] = m.id;
    await atomicWrite(activeFile(), JSON.stringify(cur, null, 2) + "\n");
  });
  return m;
}

/* ---------------- 读方法 ---------------- */

/** 前缀 原版: / original: 强制读原件；默认: / default: 强制读默认 */
function forced(id: string): { force?: BuiltinProfile; id: string } {
  const m = id.match(/^(原版|original|默认|default)[:：](.+)$/);
  if (!m) return { id };
  return { force: m[1] === "原版" || m[1] === "original" ? "original" : "default", id: m[2] };
}

async function readBuiltin(
  lib: MethodLibrary,
  which: BuiltinProfile,
  id: string,
): Promise<{ hit: MethodText; from: BuiltinProfile } | undefined> {
  if (which === "default") {
    const d = await lib.readDefault(lib.canonical(id));
    if (d) return { hit: d, from: "default" };
  }
  const o = await lib.readOriginal(id);
  return o ? { hit: o, from: "original" } : undefined;
}

export async function readMethod(
  lib: MethodLibrary,
  profileKey: string | undefined,
  rawId: string,
  pinned?: string,
): Promise<ResolvedMethod> {
  const meta = profileKey
    ? await findProfile(lib.mode, profileKey)
    : await activeProfile(lib.mode, pinned);
  const { force, id: idPart } = forced(rawId.trim());
  const id = checkMethodId(idPart);
  if (force) {
    const r = await readBuiltin(lib, force, id);
    if (!r || (force === "default" && r.from !== "default"))
      throw new WriterError("NOT_FOUND", `${BUILTIN_NAMES[force]}方案里没有：${id}`);
    return { ...r.hit, profile: force, profile_name: BUILTIN_NAMES[force], from: r.from };
  }
  if (meta.kind === "user") {
    const dir = path.join(modeDir(lib.mode), meta.id, "methods");
    for (const cand of [id, lib.canonical(id)]) {
      const text = await readText(resolveInside(dir, `${cand}.md`));
      if (text !== undefined)
        return {
          id: cand,
          text,
          file: `${meta.name}/${cand}.md`,
          profile: meta.id,
          profile_name: meta.name,
          from: "user",
        };
    }
  }
  const base: BuiltinProfile =
    meta.kind === "user" ? (meta.base ?? "default") : (meta.id as BuiltinProfile);
  const r = await readBuiltin(lib, base, id);
  if (!r) throw new WriterError("NOT_FOUND", `「${meta.name}」方案里没有这份方法：${id}`);
  return { ...r.hit, profile: meta.id, profile_name: meta.name, from: r.from };
}

/* ---------------- 列表与详情 ---------------- */

export interface ProfileSummary extends ProfileMeta {
  active: boolean;
  pinned: boolean;
  methods: number;
  overrides?: number;
  /** 方案读不出来的原因与文件位置；有它的行不能激活或打开。 */
  broken?: string;
  /** 名称与保留的方案 id 同形（旧数据）：照常可用，提示作者改名。 */
  nameConflict?: boolean;
}

export async function listProfiles(
  lib: MethodLibrary,
  pinned?: string,
): Promise<{ active: string; activeName: string; pinned: boolean; profiles: ProfileSummary[] }> {
  const [key, def, orig, users] = await Promise.all([
    activeKey(lib.mode, pinned),
    lib.defaultIds(),
    lib.originalIds(),
    userMetas(lib.mode),
  ]);
  // 当前方案本身损坏时列表照常给出，损坏行标为当前；读方法时 findProfile 会如实报错。
  const brokenActive = users.find((u) => isBroken(u) && u.id === key.key);
  const act = brokenActive
    ? { id: brokenActive.id, name: brokenActive.id, pinned: key.pinned }
    : { ...(await findProfile(lib.mode, key.key)), pinned: key.pinned };
  const defIds = def.map((d) => d.id);
  const userRows = await Promise.all(
    users.map(async (u): Promise<ProfileSummary> => {
      if (isBroken(u))
        return {
          id: u.id,
          name: u.id,
          mode: lib.mode,
          kind: "user",
          broken: u.broken,
          active: act.id === u.id,
          pinned: act.pinned && act.id === u.id,
          methods: 0,
        };
      const ov = await overrideIds(lib.mode, u.id);
      const baseIds = u.base === "original" ? orig : defIds;
      return {
        ...u,
        active: act.id === u.id,
        pinned: act.pinned && act.id === u.id,
        methods: new Set([...baseIds, ...ov]).size,
        overrides: ov.length,
        ...(isReservedName(u.name) ? { nameConflict: true } : {}),
      };
    }),
  );
  const out: ProfileSummary[] = [
    {
      ...builtinMeta(lib.mode, "default"),
      active: act.id === "default",
      pinned: act.pinned && act.id === "default",
      methods: def.length,
    },
    {
      ...builtinMeta(lib.mode, "original"),
      active: act.id === "original",
      pinned: act.pinned && act.id === "original",
      methods: orig.length,
    },
    ...userRows,
  ];
  return { active: act.id, activeName: act.name, pinned: act.pinned, profiles: out };
}

export interface ProfileMethodRow {
  id: string;
  title?: string;
  from: "user" | BuiltinProfile;
  overridden: boolean;
  added?: boolean;
}

export async function profileDetail(
  lib: MethodLibrary,
  key: string,
  pinned?: string,
): Promise<{ profile: ProfileSummary; methods: ProfileMethodRow[] }> {
  const [meta, list, def] = await Promise.all([
    findProfile(lib.mode, key),
    listProfiles(lib, pinned),
    lib.defaultIds(),
  ]);
  // meta 来自 findProfile、list 来自 listProfiles，两次目录读取之间方案可能被并发删除。
  const summary = list.profiles.find((p) => p.id === meta.id);
  if (!summary) throw new WriterError("NOT_FOUND", `没有这个方案：${meta.name}`);
  const titles = new Map(def.map((d) => [d.id, d.title]));
  if (meta.id === "default")
    return {
      profile: summary,
      methods: def.map((d) => ({ id: d.id, title: d.title, from: "default", overridden: false })),
    };
  if (meta.id === "original")
    return {
      profile: summary,
      methods: (await lib.originalIds()).map((id) => ({ id, from: "original", overridden: false })),
    };
  const [ovList, origIds] = await Promise.all([
    overrideIds(lib.mode, meta.id),
    meta.base === "original" ? lib.originalIds() : Promise.resolve(def.map((d) => d.id)),
  ]);
  const ov = new Set(ovList);
  const baseIds = origIds;
  const rows: ProfileMethodRow[] = baseIds.map((id) => ({
    id,
    title: titles.get(id),
    from: ov.has(id) ? "user" : (meta.base ?? "default"),
    overridden: ov.has(id),
  }));
  for (const id of ov)
    if (!baseIds.includes(id)) rows.push({ id, from: "user", overridden: true, added: true });
  return { profile: summary, methods: rows };
}

/* ---------------- 用户方案：新建、保存、恢复、改名、删除 ---------------- */

export interface CreateProfileInput {
  name?: string;
  /** default / original，或已有用户方案（复制它的覆盖与底） */
  base?: string;
  note?: string;
  files?: { id: string; text: string }[];
}

/**
 * 同一模式下所有用户方案的写操作整体互斥：并发新建会分到同一编号；
 * 改名与保存各自读改写 profile.json 会互相覆盖；删除与保存交错会把已删方案写回来。
 */
function mutateProfiles<T>(mode: ProfileMode, fn: () => Promise<T>): Promise<T> {
  return serialize(path.join(profilesRoot(), mode), fn);
}

export async function createProfile(
  lib: MethodLibrary,
  input: CreateProfileInput = {},
): Promise<ProfileMeta> {
  return mutateProfiles(lib.mode, () => createProfileUnlocked(lib, input));
}

async function createProfileUnlocked(
  lib: MethodLibrary,
  input: CreateProfileInput,
): Promise<ProfileMeta> {
  const users = await userMetas(lib.mode);
  if (users.length >= PROFILE_LIMITS.profilesPerMode)
    throw new WriterError(
      "CONFLICT",
      `每种模式最多 ${PROFILE_LIMITS.profilesPerMode} 个用户方案，先删掉不用的`,
    );
  // 编号按目录取最大值：上次新建中途失败留下的无 profile.json 目录也占号，新方案不会继承它的残留文件。
  const n = (await userDirs(lib.mode)).reduce((mx, id) => Math.max(mx, userSeq(id)), 0) + 1;
  const id = `user-${n}`;
  const name = input.name?.trim() ? checkName(input.name) : `用户方案${chineseNumber(n)}`;
  if ([...healthy(users).map((u) => u.name), ...Object.values(BUILTIN_NAMES)].includes(name))
    throw new WriterError("CONFLICT", `已有同名方案：${name}`);
  let base: BuiltinProfile = "default";
  let copyFrom: ProfileMeta | undefined;
  if (input.base) {
    const b = await findProfile(lib.mode, input.base);
    if (b.kind === "user") {
      copyFrom = b;
      base = b.base ?? "default";
    } else base = b.id as BuiltinProfile;
  }
  const files = input.files ?? [];
  if (files.length > PROFILE_LIMITS.methodsPerProfile)
    throw new WriterError("INVALID_ARGS", `一次最多 ${PROFILE_LIMITS.methodsPerProfile} 份`);
  const checked = files.map((f) => ({
    id: lib.canonical(checkMethodId(f.id)),
    text: checkText(f.text),
  }));
  const dir = path.join(modeDir(lib.mode), id);
  const at = nowIso();
  const meta: ProfileMeta = {
    id,
    name,
    mode: lib.mode,
    kind: "user",
    base,
    note: input.note?.trim().slice(0, 200) || undefined,
    created_at: at,
    updated_at: at,
  };
  if (copyFrom) {
    const copyIds = await overrideIds(lib.mode, copyFrom.id);
    await Promise.all(
      copyIds.map(async (mid) => {
        const text = await readText(
          resolveInside(path.join(modeDir(lib.mode), copyFrom.id, "methods"), `${mid}.md`),
        );
        if (text !== undefined) await atomicWrite(resolveInside(dir, "methods", `${mid}.md`), text);
      }),
    );
  }
  for (const f of checked) await atomicWrite(resolveInside(dir, "methods", `${f.id}.md`), f.text);
  await atomicWrite(path.join(dir, "profile.json"), JSON.stringify(meta, null, 2) + "\n");
  return meta;
}

async function touch(mode: ProfileMode, meta: ProfileMeta, patch: Partial<ProfileMeta> = {}) {
  const next = { ...meta, ...patch, updated_at: nowIso() };
  await atomicWrite(
    path.join(modeDir(mode), meta.id, "profile.json"),
    JSON.stringify(next, null, 2) + "\n",
  );
  return next;
}

async function editable(mode: ProfileMode, key: string): Promise<ProfileMeta> {
  const meta = await findProfile(mode, key);
  if (meta.kind !== "user")
    throw new WriterError("CONFLICT", `「${meta.name}」是内置方案，不能修改；新建一个用户方案再改`);
  return meta;
}

export async function saveMethod(
  lib: MethodLibrary,
  key: string,
  id: string,
  text: unknown,
): Promise<{ profile: ProfileMeta; id: string; bytes: number }> {
  return mutateProfiles(lib.mode, () => saveMethodUnlocked(lib, key, id, text));
}

async function saveMethodUnlocked(
  lib: MethodLibrary,
  key: string,
  id: string,
  text: unknown,
): Promise<{ profile: ProfileMeta; id: string; bytes: number }> {
  const meta = await editable(lib.mode, key);
  const mid = lib.canonical(checkMethodId(id));
  const body = checkText(text);
  const existing = await overrideIds(lib.mode, meta.id);
  if (!existing.includes(mid) && existing.length >= PROFILE_LIMITS.methodsPerProfile)
    throw new WriterError("CONFLICT", `一个方案最多 ${PROFILE_LIMITS.methodsPerProfile} 份覆盖`);
  await atomicWrite(
    resolveInside(path.join(modeDir(lib.mode), meta.id, "methods"), `${mid}.md`),
    body,
  );
  return { profile: await touch(lib.mode, meta), id: mid, bytes: Buffer.byteLength(body) };
}

export async function resetMethod(
  lib: MethodLibrary,
  key: string,
  id: string,
): Promise<{ profile: ProfileMeta; id: string; removed: boolean }> {
  return mutateProfiles(lib.mode, async () => {
    const meta = await editable(lib.mode, key);
    const mid = lib.canonical(checkMethodId(id));
    const file = resolveInside(path.join(modeDir(lib.mode), meta.id, "methods"), `${mid}.md`);
    const had = await exists(file);
    if (had) await rm(file, { force: true });
    return { profile: await touch(lib.mode, meta), id: mid, removed: had };
  });
}

export async function renameProfile(
  mode: ProfileMode,
  key: string,
  name: string,
  note?: string,
): Promise<ProfileMeta> {
  return mutateProfiles(mode, async () => {
    const meta = await editable(mode, key);
    const n = checkName(name);
    const others = healthy(await userMetas(mode))
      .filter((u) => u.id !== meta.id)
      .map((u) => u.name);
    if ([...others, ...Object.values(BUILTIN_NAMES)].includes(n))
      throw new WriterError("CONFLICT", `已有同名方案：${n}`);
    return touch(mode, meta, {
      name: n,
      ...(note !== undefined ? { note: note.trim().slice(0, 200) || undefined } : {}),
    });
  });
}

export async function deleteProfile(
  mode: ProfileMode,
  key: string,
): Promise<{ id: string; was_active: boolean }> {
  return mutateProfiles(mode, () => deleteProfileUnlocked(mode, key));
}

async function deleteProfileUnlocked(
  mode: ProfileMode,
  key: string,
): Promise<{ id: string; was_active: boolean }> {
  const meta = await editable(mode, key);
  const was_active = await serialize(activeFile(), async () => {
    const cur = (await readJson<Record<string, string>>(activeFile())) ?? {};
    const wasActive = cur[mode] === meta.id;
    if (wasActive) {
      delete cur[mode];
      await atomicWrite(activeFile(), JSON.stringify(cur, null, 2) + "\n");
    }
    return wasActive;
  });
  await rm(path.join(modeDir(mode), meta.id), { recursive: true, force: true });
  return { id: meta.id, was_active };
}
