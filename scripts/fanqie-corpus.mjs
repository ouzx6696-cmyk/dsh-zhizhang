import { readFile } from "node:fs/promises";
import { spawnSync } from "node:child_process";
import { parseArgs } from "node:util";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { chapterIndex } from "../build/fanqie/src/engine/services/analysis/chapters.js";
import { sha256 } from "../build/core/src/fsx.js";

const root = fileURLToPath(new URL("../", import.meta.url));
const { values } = parseArgs({
  options: { manifest: { type: "string" }, limit: { type: "string", default: "30" } },
});
if (!values.manifest)
  throw new Error("用法：npm run corpus:fanqie -- --manifest /绝对路径/corpus.json [--limit 30]");
const limit = Number(values.limit);
if (!Number.isSafeInteger(limit) || limit < 1) throw new Error("limit 必须是正整数");
const manifestFile = path.resolve(values.manifest);
const manifest = JSON.parse(await readFile(manifestFile, "utf8"));
if (!manifest || !Array.isArray(manifest.books) || !manifest.books.length)
  throw new Error("manifest.books 必须是非空数组");
const ids = new Set();
const books = [];
for (const row of manifest.books) {
  if (!row || typeof row.id !== "string" || !row.id.trim() || ids.has(row.id))
    throw new Error("每本书须有唯一的非空 id");
  if (!["human", "ai"].includes(row.kind) || typeof row.file !== "string" || !row.file.trim())
    throw new Error(`${row.id} 需要 kind=human/ai 和 file`);
  ids.add(row.id);
  const bytes = await readFile(path.resolve(path.dirname(manifestFile), row.file));
  const source = new TextDecoder("utf-8", { fatal: true }).decode(bytes);
  const index = chapterIndex(source).filter((chapter) => chapter.n > 0);
  if (!index.length || new Set(index.map((chapter) => chapter.n)).size !== index.length)
    throw new Error(`${row.id} 缺少章节标题或章号重复，请先整理书源`);
  const chapters = index.slice(0, limit).map((chapter) => {
    const raw = source.slice(chapter.start, chapter.end);
    const newline = raw.indexOf("\n");
    const body = newline < 0 ? "" : raw.slice(newline + 1).trim();
    if (!body) throw new Error(`${row.id} 第${chapter.n}章为空，不能计为有效样本`);
    return { number: chapter.n, body };
  });
  books.push({
    id: row.id,
    kind: row.kind,
    sourceHash: sha256(bytes),
    availableChapters: index.length,
    chapters,
  });
}
const result = spawnSync(
  process.env.WRITER_PYTHON || (process.platform === "win32" ? "python" : "python3"),
  [path.join(root, "scripts/fanqie-corpus.py")],
  {
    env: { ...process.env, PYTHONUTF8: "1", PYTHONIOENCODING: "utf-8" },
    input: JSON.stringify({ limit, books }),
    encoding: "utf8",
    maxBuffer: 32 * 1024 * 1024,
  },
);
if (result.error) throw result.error;
if (result.stderr) process.stderr.write(result.stderr);
if (result.stdout) process.stdout.write(result.stdout);
if (result.status !== 0 || result.signal) process.exit(result.status || 1);
