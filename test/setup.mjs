/** 测试状态与数据位置指向临时目录。 */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";
const home = mkdtempSync(path.join(tmpdir(), "writer-test-home-"));
process.env.WRITER_STATE_ROOT = home;
for (const key of [
  "WRITER_NOVEL_ROOT",
  "WRITER_NOVEL_WORKS",
  "WRITER_NOVEL_LIBRARY",
  "WRITER_NOVEL_SOURCE_ROOT",
  "WRITER_NOVEL_MULTI_DRAFT",
  "WRITER_TOUTIAO_ROOT",
])
  delete process.env[key];
process.once("exit", () => rmSync(home, { recursive: true, force: true }));

const repository = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
process.env.WRITER_TOUTIAO_SKILL_DIR = path.join(repository, "packages/toutiao/skill");
process.env.WRITER_TOUTIAO_DEFAULT_DIR = path.join(repository, "packages/toutiao/profiles/default");
