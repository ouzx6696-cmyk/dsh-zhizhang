import { config } from "../runtime-config.js";
export { config, withPluginConfig } from "../runtime-config.js";
import { asString } from "../parse.js";
export { asObject, asString, asStringArray, boolArg } from "../parse.js";
/**
 * Shared tool context: plugin config, session last-work, openWork helpers.
 */
import { claimWorkspace } from "../../../../core/src/workspace-lock.js";
import { NovelError } from "../errors.js";
import type { OpenWorkContext } from "../types.js";
import { ensureStorage } from "../storage/paths.js";
import { listWorks } from "../storage/projects.js";
import { readWorkMeta } from "../storage/work-meta.js";
import { resolveWorkDir } from "../work-store.js";
const lastWorkBySession = new Map<string, string>();
const MAX_SESSIONS = 500;
function sessionKey(exec: OpenWorkContext) {
  return exec.sessionId ?? "default";
}
export function rememberWork(exec: OpenWorkContext, key: string) {
  const sk = `${sessionKey(exec)}:${JSON.stringify(config)}`;
  lastWorkBySession.delete(sk);
  lastWorkBySession.set(sk, key);
  while (lastWorkBySession.size > MAX_SESSIONS) {
    const oldest = lastWorkBySession.keys().next().value;
    if (oldest === undefined) break;
    lastWorkBySession.delete(oldest);
  }
}
export function fail(message: string, code: string = "bad_args"): never {
  throw new NovelError(code, message);
}
/**
 * 字符串数组参数（如 card_ids / source_ids / tags）。
 *
 * 与 asString 保持同一口径：类型不对就硬拒，绝不静默降级成空数组——
 * 静默降级会让调用方拿到"没卡/没结果"的正常回执，排查成本极高。
 */
export function asArray(
  args: Record<string, unknown>,
  key: string,
  opts: { required?: boolean; kind?: string } = {},
) {
  const value = args[key];
  if (value === undefined || value === null) {
    if (opts.required) fail(`参数 ${key} 必填`);
    return undefined;
  }
  if (!Array.isArray(value)) fail(`参数 ${key} 必须是${opts.kind ?? "数组"}，收到 ${typeof value}`);
  return value;
}

export async function openWork(exec: OpenWorkContext, args: Record<string, unknown>) {
  const paths = await ensureStorage(exec, config, asString(args, "working_dir"));
  let key = asString(args, "work");
  if (!key) {
    key = lastWorkBySession.get(`${sessionKey(exec)}:${JSON.stringify(config)}`);
  }
  if (!key) {
    const all = await listWorks(paths);
    // 领域码而非文案：status 这类仪表盘要据此给出起步指引，不能让调用方去匹配中文。
    if (all.length === 0) fail("还没有作品，先用 fanqie_project_create 创建", "no_work");
    if (all.length > 1) {
      fail(
        `本会话未指定作品，且目录中有 ${all.length} 部：${all.map((w) => `${w.key}（${w.title}）`).join("、")}。请传 work 或先 fanqie_project_open`,
      );
    }
    key = all[0].key;
  }
  const dir = await resolveWorkDir(paths, key);
  const meta = await readWorkMeta(dir);
  await claimWorkspace(dir);
  rememberWork(exec, meta.key);
  return { paths, dir, key: meta.key };
}
