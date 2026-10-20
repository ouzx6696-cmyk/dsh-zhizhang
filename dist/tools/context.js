/**
 * Shared tool context: plugin config, session last-work, openWork helpers.
 */
import { ZhizhangError } from "../lib/errors.js";
import { ensureStorage, listWorks, readWorkMeta, resolveWorkDir, } from "../lib/store.js";
export let config = {};
const lastWorkBySession = new Map();
const MAX_SESSIONS = 500;
export function setPluginConfig(next) {
    config = { ...next };
}
export function sessionKey(exec) {
    return (exec?.agent?.session?.id ?? "default");
}
export function rememberWork(exec, key) {
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
export function fail(message, code = "bad_args") {
    throw new ZhizhangError(code, message);
}
export function asString(args, key, opts = {}) {
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
export async function openWork(exec, args) {
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
            fail(`本会话未指定作品，且目录中有 ${all.length} 部：${all.map((w) => `${w.key}（${w.title}）`).join("、")}。请传 work 或先 zhizhang_project_open`);
        }
        key = all[0].key;
    }
    const dir = await resolveWorkDir(paths, key);
    const meta = await readWorkMeta(dir);
    rememberWork(exec, meta.key);
    return { paths, dir, key: meta.key };
}
