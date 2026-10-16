/**
 * store.js —— 写作项目的磁盘存储层。
 *
 * 纯 Node 内置模块实现，不依赖 harness 包，方便独立单元测试。
 * 存储布局（默认 <会话工作目录>/.writing-studio/）：
 *   projects/    每个写作项目一个 JSON 文件
 *   manuscripts/ 汇编后的成稿 markdown
 */
import { mkdir, open, readdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const SCHEMA_VERSION = 1;

/** 章节状态，按写作流程单向推进。 */
export const SECTION_STATUSES = Object.freeze(["planned", "drafting", "drafted", "reviewed", "done"]);
const STATUS_RANK = new Map(SECTION_STATUSES.map((status, index) => [status, index]));

/**
 * 只进不退的状态推进。
 *
 * 保存草稿、记录批注、汇编成稿都不该让 reviewed/done 退回 drafting/planned——
 * 否则一条无关操作就能让成稿少掉一节。需要显式回退（如审校判 revise）时
 * 直接赋值，不要走这里。
 */
export function promoteStatus(current, next) {
  const from = STATUS_RANK.get(current) ?? 0;
  const to = STATUS_RANK.get(next) ?? 0;
  return to > from ? next : current;
}

/** 每项目文件一把进程内互斥锁，避免并发工具调用互相覆盖。 */
const locks = new Map();

/** 临时文件名计数器：同一毫秒内的并发写入不能撞同一个临时文件名。 */
let tmpSeq = 0;

export async function withLock(key, fn) {
  const previous = locks.get(key) ?? Promise.resolve();
  let release;
  const gate = new Promise((resolve) => {
    release = resolve;
  });
  const current = previous.then(() => gate);
  locks.set(key, current);
  await previous;
  try {
    return await fn();
  } finally {
    release();
    if (locks.get(key) === current) locks.delete(key);
  }
}

/** 统计字数：CJK 字符按字计，拉丁/数字串按词计，二者相加。 */
export function countWords(text) {
  if (typeof text !== "string" || text.length === 0) return 0;
  const cjk =
    text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0;
  const latin = text.match(/[A-Za-z0-9]+(?:['’-][A-Za-z0-9]+)*/g)?.length ?? 0;
  return cjk + latin;
}

/** Windows 设备名，不能直接当文件名。 */
const RESERVED_NAME = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;

/**
 * 把标题变成安全的文件主名；中文标题原样保留，去掉非法字符。
 * 截断按码点进行，避免把代理对（emoji）劈成半个字符。
 */
export function slugify(title) {
  const cleaned = Array.from(
    String(title ?? "")
      .trim()
      .replace(/[<>:"/\\|?*\u0000-\u001f]/g, " ")
      .replace(/\s+/g, "-")
      .replace(/-+/g, "-")
      .replace(/^-|-$/g, ""),
  )
    .slice(0, 60)
    .join("");
  if (cleaned.length === 0) return `project-${Date.now().toString(36)}`;
  return RESERVED_NAME.test(cleaned) ? `_${cleaned}` : cleaned;
}

/** 当前会话工作目录（工具执行上下文中由 exec 提供）。 */
export function sessionCwd(exec) {
  const cwd = exec?.agent?.session?.header?.cwd;
  return typeof cwd === "string" && cwd.length > 0 ? cwd : process.cwd();
}

/**
 * 解析存储根目录。
 * 优先级：本次调用显式 working_dir > 插件配置 storageRoot > 会话 cwd 下的 rootDir。
 */
export function storagePaths(exec, config, workingDir) {
  const cwd = sessionCwd(exec);
  let base;
  if (workingDir !== undefined && workingDir !== "") {
    base = path.isAbsolute(workingDir) ? workingDir : path.resolve(cwd, workingDir);
  } else if (config?.storageRoot) {
    base = path.resolve(config.storageRoot);
  } else {
    base = path.resolve(cwd, config?.rootDir ?? ".writing-studio");
  }
  return {
    base,
    projects: path.join(base, "projects"),
    manuscripts: path.join(base, "manuscripts"),
  };
}

/** 确保目录存在。 */
export async function ensureStorage(exec, config, workingDir) {
  const paths = storagePaths(exec, config, workingDir);
  await mkdir(paths.projects, { recursive: true });
  await mkdir(paths.manuscripts, { recursive: true });
  return paths;
}

/**
