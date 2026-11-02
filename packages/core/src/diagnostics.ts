import { appendFile, mkdir, readdir, readFile, unlink } from "node:fs/promises";
import path from "node:path";
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
    await mkdir(path.join(this.home, "logs"), { recursive: true });
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
