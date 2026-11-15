import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { transformSync } from "esbuild";

const ROOT = process.cwd();
const CACHE = path.join(os.tmpdir(), `zhizhang-test-ts-${process.pid}`);
const compiled = new Map();

function resolveSource(specifier, from) {
  if (specifier.startsWith("@zhizhang/")) {
    const [name, ...parts] = specifier.slice("@zhizhang/".length).split("/");
    const entry = path.join(ROOT, "packages", name, "src", ...parts);
    if (fs.existsSync(`${entry}.ts`)) return `${entry}.ts`;
    return path.join(entry, "index.ts");
  }
  return path.resolve(path.dirname(from), specifier).replace(/\.js$/, ".ts");
}

function compile(source) {
  if (compiled.has(source)) return compiled.get(source);
  const output = path.join(CACHE, path.relative(ROOT, source).replace(/\.ts$/, ".mjs"));
  compiled.set(source, output);
  const { code } = transformSync(fs.readFileSync(source, "utf8"), {
    loader: "ts",
    format: "esm",
    target: "node24",
  });
  const rewritten = code.replace(
    /(from\s+["'])([^"']+)(["'])/g,
    (match, prefix, specifier, suffix) => {
      if (specifier.startsWith("node:")) return match;
      return `${prefix}${pathToFileURL(compile(resolveSource(specifier, source))).href}${suffix}`;
    },
  );
  fs.mkdirSync(path.dirname(output), { recursive: true });
  fs.writeFileSync(output, rewritten);
  return output;
}

export function importTs(relativePath) {
  return import(pathToFileURL(compile(path.resolve(ROOT, relativePath))).href);
}
