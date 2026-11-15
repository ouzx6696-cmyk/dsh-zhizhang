import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { pathToFileURL } from "node:url";

const ROOT = process.cwd();
const CACHE_DIR = path.join(os.tmpdir(), `zhizhang-test-ts-${process.pid}`);

const PKG_MAP = {
  "@zhizhang/core": "packages/core/src",
  "@zhizhang/fanqie": "packages/fanqie/src",
  "@zhizhang/toutiao": "packages/toutiao/src",
};

function skipString(src, i, quote) {
  i++;
  while (i < src.length) {
    if (src[i] === "\\") {
      i += 2;
      continue;
    }
    if (quote === "`" && src[i] === "$" && src[i + 1] === "{") {
      i = skipBalanced(src, i + 1, "{", "}");
      continue;
    }
    if (src[i] === quote) return i + 1;
    i++;
  }
  return i;
}

function skipBalanced(src, i, open, close) {
  let depth = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i, ch);
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (ch === open) depth++;
    else if (ch === close) {
      depth--;
      if (depth === 0) return i + 1;
    }
    i++;
  }
  return i;
}

function stripTypeExpression(src, i, stopChars) {
  let paren = 0;
  let brace = 0;
  let bracket = 0;
  let angle = 0;
  while (i < src.length) {
    const ch = src[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      i = skipString(src, i, ch);
      continue;
    }
    if (ch === "/" && src[i + 1] === "/") {
      const nl = src.indexOf("\n", i);
      i = nl === -1 ? src.length : nl + 1;
      continue;
    }
    if (ch === "/" && src[i + 1] === "*") {
      const end = src.indexOf("*/", i + 2);
      i = end === -1 ? src.length : end + 2;
      continue;
    }
    if (paren === 0 && brace === 0 && bracket === 0 && angle === 0) {
      if (ch === "=" && src[i + 1] === ">") {
        if (stopChars.includes("=>")) return i;
        i += 2;
        continue;
      }
      if (ch === "{" && stopChars.includes("{")) {
        const afterObj = skipBalanced(src, i, "{", "}");
        const rest = src.slice(afterObj).trimStart();
        if (rest.startsWith("{") || rest.startsWith("=>")) {
          i = afterObj;
          continue;
        }
        return i;
      }
      if (stopChars.includes(ch)) return i;
    }
    if (ch === "(") paren++;
    else if (ch === ")" && paren > 0) paren--;
    else if (ch === "{") brace++;
    else if (ch === "}" && brace > 0) brace--;
    else if (ch === "[") bracket++;
    else if (ch === "]" && bracket > 0) bracket--;
    else if (ch === "<") angle++;
    else if (ch === ">" && angle > 0) angle--;
    else if (paren === 0 && brace === 0 && bracket === 0 && angle === 0 && ch === ")") return i;
    i++;
  }
  return i;
}

function stripParamTypes(inner) {
  let out = "";
  let i = 0;
  while (i < inner.length) {
    const ch = inner[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(inner, i, ch);
      out += inner.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "{" || ch === "[" || ch === "(") {
      const close = ch === "{" ? "}" : ch === "[" ? "]" : ")";
      const end = skipBalanced(inner, i, ch, close);
      out += inner.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "?" && inner.slice(i + 1).trimStart().startsWith(":")) {
      i++;
      continue;
    }
    if (ch === ":") {
      i = stripTypeExpression(inner, i + 1, [",", "="]);
      continue;
    }
    out += ch;
    i++;
  }
  return out;
}

function stripTypeScript(src) {
  let out = src.replace(/^\s*import\s+type\s+[\s\S]*?from\s+["'][^"']+["'];?\s*$/gm, "");
  out = out.replace(/^\s*export\s+type\s+\{[^}]*\}(?:\s*from\s+["'][^"']+["'])?;?\s*$/gm, "");

  out = out.replace(/\b(import|export)\s*\{([^}]+)\}\s*from/g, (_, kw, inner) => {
    const kept = inner
      .split(",")
      .map((s) => s.trim())
      .filter((s) => s && !s.startsWith("type "));
    return kept.length ? `${kw} { ${kept.join(", ")} } from` : `// empty ${kw} from`;
  });
  out = out.replace(/^\/\/ empty (?:import|export) from\s+["'][^"']+["'];?\s*$/gm, "");

  let res = "";
  let i = 0;
  while (i < out.length) {
    const ch = out[i];
    if (ch === '"' || ch === "'" || ch === "`") {
      const end = skipString(out, i, ch);
      res += out.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && out[i + 1] === "/") {
      const nl = out.indexOf("\n", i);
      const end = nl === -1 ? out.length : nl + 1;
      res += out.slice(i, end);
      i = end;
      continue;
    }
    if (ch === "/" && out[i + 1] === "*") {
      const end = out.indexOf("*/", i + 2);
      const stop = end === -1 ? out.length : end + 2;
      res += out.slice(i, stop);
      i = stop;
      continue;
    }

    const lineStart = i === 0 || out[i - 1] === "\n";
    if (lineStart) {
      const slice = out.slice(i);
      if (/^(?:export\s+)?interface\s+\w+/.test(slice)) {
        const braceIdx = out.indexOf("{", i);
        if (braceIdx !== -1) {
          i = skipBalanced(out, braceIdx, "{", "}");
          continue;
        }
      }
      if (/^(?:export\s+)?type\s+\w+(?:\s*<[^>]+>)?\s*=/.test(slice)) {
        const eqIdx = out.indexOf("=", i);
        let j = eqIdx + 1;
        let brace = 0;
        let paren = 0;
        while (j < out.length) {
          const c = out[j];
          if (c === '"' || c === "'" || c === "`") {
            j = skipString(out, j, c);
            continue;
          }
          if (c === "{") brace++;
          else if (c === "}") brace--;
          else if (c === "(") paren++;
          else if (c === ")") paren--;
          else if (c === ";" && brace === 0 && paren === 0) {
            j++;
            break;
          }
          j++;
        }
        i = j;
        continue;
      }
      const fieldMatch = slice.match(/^(\s+)(?:readonly\s+)?(\w+)\??\s*:\s*[^;\n]+;/);
      if (fieldMatch && !slice.trimStart().startsWith("case ") && !slice.trimStart().startsWith("default:")) {
        res += `${fieldMatch[1]}${fieldMatch[2]};`;
        i += fieldMatch[0].length;
        continue;
      }
    }

    if (
      (out.startsWith("function ", i) && (i === 0 || /\s/.test(out[i - 1]))) ||
      (out.startsWith("class ", i) && (i === 0 || /\s/.test(out[i - 1])))
    ) {
      const m = out.slice(i).match(/^(?:function|class)\s+\w+\s*(?=<)/);
      if (m) {
        res += m[0];
        i = skipBalanced(out, i + m[0].length, "<", ">");
        continue;
      }
    }

    const genCall = out.slice(i).match(/^([A-Za-z_]\w*)\s*(?=<)/);
    if (genCall && (i === 0 || !/\w/.test(out[i - 1]))) {
      const afterAngle = skipBalanced(out, i + genCall[0].length, "<", ">");
      if (out[afterAngle] === "(") {
        res += genCall[1];
        i = afterAngle;
        continue;
      }
    }

    if (out.startsWith(" as ", i)) {
      const afterAs = out.slice(i + 4);
      if (
        /^(?:const|unknown|any|never|string|number|boolean|[A-Z]\w*)\b/.test(
          afterAs,
        ) ||
        /^\{/.test(afterAs)
      ) {
        if (afterAs.startsWith("const satisfies ")) {
          i = stripTypeExpression(out, i + 4 + "const satisfies ".length, [";", "\n", ",", ")", "]"]);
          continue;
        }
        if (afterAs.startsWith("const") && !/\w/.test(afterAs[5] ?? "")) {
          i += 9;
          continue;
        }
        i = stripTypeExpression(out, i + 4, [";", "\n", ",", ")", "]", "}", "."]);
        continue;
      }
    }

    if (ch === "(") {
      const endParen = skipBalanced(out, i, "(", ")");
      const after = out.slice(endParen).trimStart();
      if (after.startsWith(":")) {
        const colonIdx = out.indexOf(":", endParen);
        const endType = stripTypeExpression(out, colonIdx + 1, ["{", "=>", ";", "\n"]);
        if (out[endType] === "{" || out.startsWith("=>", endType)) {
          const inner = out.slice(i + 1, endParen - 1);
          res += "(" + stripParamTypes(inner) + ") ";
          i = endType;
          continue;
        }
      }
      const beforeKw = res.trimEnd().match(/\b(if|for|while|switch|catch|with)$/); if (!beforeKw && (after.startsWith("{") || after.startsWith("=>"))) {
        const inner = out.slice(i + 1, endParen - 1);
        res += "(" + stripParamTypes(inner) + ")";
        i = endParen;
        continue;
      }
    }

    if (/^(?:const|let|var)\s+\w+\s*:/.test(out.slice(i)) && (i === 0 || /\s/.test(out[i - 1]))) {
      const m = out.slice(i).match(/^(?:const|let|var)\s+\w+/);
      res += m[0];
      const colonIdx = out.indexOf(":", i + m[0].length);
      i = stripTypeExpression(out, colonIdx + 1, ["=", ";", "\n"]);
      continue;
    }

    res += ch;
    i++;
  }
  return res;
}

function resolveTsFile(specifier, fromDir) {
  for (const [pkg, base] of Object.entries(PKG_MAP)) {
    if (specifier === pkg) return path.join(ROOT, base, "index.ts");
    if (specifier.startsWith(`${pkg}/`)) {
      const sub = specifier.slice(pkg.length + 1);
      const direct = path.join(ROOT, base, `${sub}.ts`);
      if (fs.existsSync(direct)) return direct;
      return path.join(ROOT, base, sub, "index.ts");
    }
  }
  const raw = path.resolve(fromDir, specifier);
  const tsPath = raw.replace(/\.js$/, ".ts");
  if (fs.existsSync(tsPath)) return tsPath;
  if (fs.existsSync(path.join(raw, "index.ts"))) return path.join(raw, "index.ts");
  return raw;
}

function compileFile(absTsPath) {
  const rel = path.relative(ROOT, absTsPath);
  const outPath = path.join(CACHE_DIR, rel.replace(/\.ts$/, ".mjs"));
  if (fs.existsSync(outPath)) return outPath;

  const src = fs.readFileSync(absTsPath, "utf8");
  const fromDir = path.dirname(absTsPath);
  let js = stripTypeScript(src);

  js = js.replace(/(from\s+["'])([^"']+)(["'])/g, (_, pre, spec, post) => {
    if (spec.startsWith("node:")) return `${pre}${spec}${post}`;
    const targetTs = resolveTsFile(spec, fromDir);
    const targetMjs = compileFile(targetTs);
    return `${pre}${pathToFileURL(targetMjs).href}${post}`;
  });

  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, js, "utf8");
  return outPath;
}

export async function importTs(relPath) {
  const abs = path.resolve(ROOT, relPath);
  const outPath = compileFile(abs);
  return import(pathToFileURL(outPath).href);
}
