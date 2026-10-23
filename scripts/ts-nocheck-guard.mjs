/**
 * 类型安全护栏：`// @ts-nocheck` 只许减少，不许新增。
 *
 * 背景：0.17.0 全仓 74 个源文件都带 @ts-nocheck，tsc --noEmit 恒为 0，
 * 实际藏着上千个类型错误。迁移是渐进的，所以用基线锁定现状：
 *   - 出现基线外的 @ts-nocheck → 失败（不许回退）
 *   - 基线里的文件已清干净     → 失败（提示从基线删除，保持列表同步）
 */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";

function walk(dir, out = []) {
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    const p = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(p, out);
    else if (p.endsWith(".ts")) out.push(p);
  }
  return out;
}

export function checkTsNocheck(srcDir, baselinePath) {
  const baseline = JSON.parse(fs.readFileSync(baselinePath, "utf8"));
  const allowed = new Set(baseline.files);
  const current = walk(srcDir)
    .filter((f) => fs.readFileSync(f, "utf8").includes("@ts-nocheck"))
    .map((f) => path.relative(process.cwd(), f).split(path.sep).join("/"));

  const currentSet = new Set(current);
  const newViolations = current.filter((f) => !allowed.has(f));
  const staleEntries = [...allowed].filter((f) => !currentSet.has(f));
  return { current, allowed: [...allowed], newViolations, staleEntries };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const root = process.cwd();
  const { current, allowed, newViolations, staleEntries } = checkTsNocheck(
    path.join(root, "src"),
    path.join(root, "scripts/ts-nocheck-baseline.json"),
  );
  const lines = [];
  lines.push(`@ts-nocheck：当前 ${current.length} 个文件（基线 ${allowed.length}）`);
  if (newViolations.length) {
    lines.push("新增（不允许）：");
    for (const f of newViolations) lines.push("  + " + f);
  }
  if (staleEntries.length) {
    lines.push("基线已过期（这些文件不再有 @ts-nocheck，请从基线删除）：");
    for (const f of staleEntries) lines.push("  - " + f);
  }
  console.log(lines.join("\n"));
  process.exit(newViolations.length || staleEntries.length ? 1 : 0);
}
