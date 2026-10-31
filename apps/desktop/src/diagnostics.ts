import { appendFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
export function explainError(error: unknown) {
  const text = String(error instanceof Error ? error.message : error);
  if (/401|invalid.*key|authentication|unauthorized/i.test(text))
    return "模型认证失败：请检查服务商、接口地址和 API Key。";
  if (/402|quota|insufficient|balance|credit/i.test(text))
    return "模型额度不足：请检查服务商账户余额和额度。";
  if (/429|rate.?limit|too many requests/i.test(text))
    return "请求过于频繁：请稍后重试，或在服务商调整限额。";
  if (/ENOTFOUND|ECONN|fetch failed|network|timeout|timed out/i.test(text))
    return "网络连接失败或超时：请检查接口地址、网络和代理后重试。";
  if (/abort/i.test(text)) return "任务已停止，已经保存的结果保留。";
  return text;
}
export class Diagnostics {
  constructor(private home: string) {}
  async init() {
    await mkdir(path.join(this.home, "logs"), { recursive: true });
    const files = (await readdir(path.join(this.home, "logs")))
      .filter((name) => name.endsWith(".jsonl"))
      .sort();
    for (const file of files.slice(0, -7))
      await unlink(path.join(this.home, "logs", file));
  }
  async write(
    event: string,
    fields: Record<string, string | number | boolean | undefined> = {},
  ) {
    await appendFile(
      path.join(
        this.home,
        "logs",
        new Date().toISOString().slice(0, 10) + ".jsonl",
      ),
      JSON.stringify({ at: new Date().toISOString(), event, ...fields }) + "\n",
    );
  }
  async bundle(config: unknown) {
    const logs = [];
    for (const name of (await readdir(path.join(this.home, "logs")))
      .sort()
      .slice(-3))
      logs.push({
        name,
        entries: (
          await readFile(path.join(this.home, "logs", name), "utf8")
        ).slice(-512000),
      });
    return {
      createdAt: new Date().toISOString(),
      platform: process.platform,
      node: process.versions.node,
      config: JSON.parse(
        JSON.stringify(config, (key, value) =>
          /key|token|secret|password/i.test(key) ? "[已移除]" : value,
        ),
      ),
      logs,
    };
  }
}
