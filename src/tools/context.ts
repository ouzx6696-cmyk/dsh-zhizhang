/**
 * Shared tool context: plugin config, session last-work, openWork helpers.
 */
import { ZhizhangError } from "../lib/errors.js";
import type { ExecContext } from "../lib/types.js";
import { ensureStorage, listWorks, readWorkMeta, resolveWorkDir, } from "../lib/store.js";
export let config = {};
const lastWorkBySession = new Map();
const MAX_SESSIONS = 500;
export function setPluginConfig(next: any) {
    config = { ...next };
}
export function sessionKey(exec: ExecContext) {
    return (exec?.agent?.session?.id ?? "default");
}
export function rememberWork(exec: ExecContext, key: string) {
    const sk = sessionKey(exec);
    lastWorkBySession.delete(sk);
    lastWorkBySession.set(sk, key);
    while (lastWorkBySession.size > MAX_SESSIONS) {
        const oldest = lastWorkBySession.keys().next().value;
        if (oldest === undefined)
            break;
        lastWorkBySession.delete(oldest);
    }
}
export function fail(message: string, code: any = "bad_args") {
    throw new ZhizhangError(code, message);
}
export function asString(args: any, key: string, opts: any = {}) {
    const value = args?.[key];
    if (value === undefined || value === null) {
        if (opts.required)
            fail(`参数 ${key} 必填`);
        return undefined;
    }
    if (typeof value !== "string")
        fail(`参数 ${key} 必须是字符串`);
    if (opts.required && opts.trim !== false && value.trim().length === 0)
        fail(`参数 ${key} 不能为空`);
    return opts.trim === false ? value : value.trim();
}
/**
 * 字符串数组参数（如 card_ids / source_ids / tags）。
 *
 * 与 asString 保持同一口径：类型不对就硬拒，绝不静默降级成空数组——
 * 静默降级会让调用方拿到"没卡/没结果"的正常回执，排查成本极高。
 */
export function asArray(args: any, key: string, opts: any = {}) {
    const value = args?.[key];
    if (value === undefined || value === null) {
        if (opts.required)
            fail(`参数 ${key} 必填`);
        return undefined;
    }
    if (!Array.isArray(value))
        fail(`参数 ${key} 必须是${opts.kind ?? "数组"}，收到 ${typeof value}`);
    return value;
}

export function asStringArray(args: any, key: string, opts: any = {}) {
    const value = asArray(args, key, { ...opts, kind: "字符串数组" });
    if (value === undefined)
        return undefined;
    const out = value.map((x: any) => String(x).trim()).filter(Boolean);
    if (opts.required && out.length === 0)
        fail(`参数 ${key} 不能为空`);
    return out;
}

export async function openWork(exec: ExecContext, args: any) {
    const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
    let key = asString(args, "work");
    if (!key) {
        key = lastWorkBySession.get(sessionKey(exec));
    }
    if (!key) {
        const all = await listWorks(paths);
        if (all.length === 0)
            fail("还没有作品，先用 zhizhang_project_create 创建");
        if (all.length > 1) {
            fail(`本会话未指定作品，且目录中有 ${all.length} 部：${all.map((w: any) => `${w.key}（${w.title}）`).join("、")}。请传 work 或先 zhizhang_project_open`);
        }
        key = all[0].key;
    }
    const dir = await resolveWorkDir(paths, key);
    const meta = await readWorkMeta(dir);
    rememberWork(exec, meta.key);
    return { paths, dir, key: meta.key };
}
