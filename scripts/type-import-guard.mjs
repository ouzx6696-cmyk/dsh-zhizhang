/**
 * 运行时护栏：类型不能当值 import。
 *
 * Node 的类型剥离只删类型注解，不删 import。所以
 *   import { defineTool, ExecContext } from "./types.js";
 * 在运行时会真的去拿 ExecContext 这个值 → SyntaxError: does not provide an export named 'ExecContext'。
 * tsc 不管（它认为类型 import 合法），只有真加载该模块才会炸。
 *
 * 这里收集 src 里所有 interface/type 声明名，再扫描非 type 的 import 是否引用了它们。
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

export function findTypeValueImports(srcDir) {
  const files = walk(srcDir);
  const typeNames = new Set();
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    for (const m of text.matchAll(/^export (?:interface|type) ([A-Za-z0-9_]+)/gm)) typeNames.add(m[1]);
    for (const m of text.matchAll(/^(?:interface|type) ([A-Za-z0-9_]+)/gm)) typeNames.add(m[1]);
  }

  const violations = [];
  for (const f of files) {
    const text = fs.readFileSync(f, "utf8");
    const re = /^import \{([^}]*)\} from ("[^"]+");$/gm;
    let m;
    while ((m = re.exec(text))) {
      const names = m[1].split(",").map((s) => s.trim().split(/\s+as\s+/)[0].trim()).filter(Boolean);
      for (const n of names) {
        if (typeNames.has(n)) {
          violations.push({ file: path.relative(process.cwd(), f).split(path.sep).join("/"), name: n, from: m[2] });
        }
      }
    }
  }
  return violations;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const violations = findTypeValueImports(path.join(process.cwd(), "src"));
  if (!violations.length) {
    console.log("类型 import 护栏：OK（没有把类型当值 import）");
  } else {
    console.log("把类型当值 import（运行时会 SyntaxError），请改成 import type：");
    for (const v of violations) console.log(`  ${v.file}: ${v.name} ← ${v.from}`);
  }
  process.exit(violations.length ? 1 : 0);
}
