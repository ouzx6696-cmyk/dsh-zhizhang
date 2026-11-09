import { appendFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
export type DiagnosticFields = Record<string, string | number | boolean | undefined | string[]>;

const REMOVED = "[已移除]";
const LOG_CHARS = 512000;
/**
 * 键名先归一（小写、去掉 - 和 _）再精确比对：maxTokens、keyless 这类含 token/key 字样的
 * 容量与开关字段必须保留，所以不能按子串匹配。
 */
const SECRET_KEYS = new Set([
  "apikey",
  "xapikey",
  "accesstoken",
  "refreshtoken",
  "idtoken",
  "token",
  "secret",
  "clientsecret",
  "password",
  "passwd",
  "authorization",
  "proxyauthorization",
  "cookie",
  "setcookie",
  "privatekey",
]);
const isSecretKey = (key: string) => SECRET_KEYS.has(key.toLowerCase().replace(/[-_]/g, ""));

/** 正文里的凭据：URL 中的 user:pass@ 与 Authorization 头的值。 */
function cleanText(text: string): string {
  return text
    .replace(/\b([a-z][a-z0-9+.-]*:\/\/)[^\s/?#@]+@/gi, `$1${REMOVED}@`)
    .replace(/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, `$1 ${REMOVED}`);
}

/** JSON.stringify 的替换函数：诊断里所有字段与配置共用这一处脱敏。 */
function redact(key: string, value: unknown) {
  if (isSecretKey(key)) return REMOVED;
  return typeof value === "string" ? cleanText(value) : value;
}

/** 已落盘的一行日志：本身是 JSON 就逐字段脱敏，不是（被截断或旧格式）就只清洗正文。 */
function redactLine(line: string): string {
  let value: unknown;
  try {
    value = JSON.parse(line);
  } catch (error) {
    if (!(error instanceof SyntaxError)) throw error;
    return cleanText(line);
  }
  return JSON.stringify(value, redact);
}

/** 取末尾不超过 limit 字符的整行，不在一行中间截断。 */
function tailLines(text: string, limit: number): string[] {
  const lines = text.split("\n").filter(Boolean);
  const kept: string[] = [];
  let size = 0;
  for (let index = lines.length - 1; index >= 0; index--) {
    size += lines[index].length + 1;
    if (size > limit) break;
    kept.unshift(lines[index]);
  }
  return kept;
}

export class Diagnostics {
  constructor(private home: string) {}
  async init() {
    await mkdir(path.join(this.home, "logs"), { recursive: true });
    const files = (await readdir(path.join(this.home, "logs")))
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    for (const file of files.slice(0, -7)) await unlink(path.join(this.home, "logs", file));
  }
  async write(event: string, fields: DiagnosticFields = {}) {
    await mkdir(path.join(this.home, "logs"), { recursive: true });
    await appendFile(
      path.join(this.home, "logs", new Date().toISOString().slice(0, 10) + ".jsonl"),
      JSON.stringify({ at: new Date().toISOString(), event, ...fields }, redact) + "\n",
    );
  }
  async bundle(config: unknown) {
    const logs = [];
    for (const name of (await readdir(path.join(this.home, "logs"))).sort().slice(-3)) {
      const text = await readFile(path.join(this.home, "logs", name), "utf8");
      logs.push({
        name,
        entries: tailLines(text, LOG_CHARS).map(redactLine).join("\n") + "\n",
      });
    }
    return {
      createdAt: new Date().toISOString(),
      platform: process.platform,
      node: process.versions.node,
      config: JSON.parse(JSON.stringify(config, redact)),
      logs,
    };
  }
}
