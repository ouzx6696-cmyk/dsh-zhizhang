import fs from "node:fs";
import path from "node:path";

const ROOT = process.cwd();
const errors = [];
const warnings = [];

function walk(dir, exts, out = []) {
  if (!fs.existsSync(dir)) return out;
  for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === "node_modules" || entry.name === "dist" || entry.name === "out") continue;
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) walk(full, exts, out);
    else if (exts.some((ext) => entry.name.endsWith(ext))) out.push(full);
  }
  return out;
}

function toPosix(p) {
  return p.split(path.sep).join("/");
}

function stripCommentsAndStrings(src) {
  return src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/\/\/.*$/gm, "")
    .replace(/(["'`])(?:\\.|(?!\1)[^\\\r\n])*\1/g, '""');
}

function stripCommentsOnly(src) {
  return src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
}

// 1. G-core: packages/core only imports node: and contains zero mode business terms
const coreFiles = walk(path.join(ROOT, "packages/core/src"), [".ts"]);
for (const file of coreFiles) {
  const txt = fs.readFileSync(file, "utf8");
  const rel = toPosix(path.relative(ROOT, file));
  if (/from\s+["'](?!(?:node:|\.))[^"']+["']/.test(txt)) {
    errors.push(`[G-core] Forbidden non-node import in ${rel}`);
  }
  if (/\b(fanqie|toutiao)\b/.test(txt)) {
    errors.push(`[G-core] Business term found in ${rel}`);
  }
}

// 2. G-layer & G-facade & G-app & G-pi & G-type & G-size & G-copy
const allTs = [
  ...walk(path.join(ROOT, "packages"), [".ts", ".tsx"]),
  ...walk(path.join(ROOT, "apps/desktop/src"), [".ts", ".tsx"]),
];

let anyCount = 0;
let nonNullCount = 0;
let defAssignCount = 0;
let asCount = 0;

for (const file of allTs) {
  const txt = fs.readFileSync(file, "utf8");
  const rel = toPosix(path.relative(ROOT, file));
  const noComments = stripCommentsOnly(txt);
  const codeOnly = stripCommentsAndStrings(txt);

  if (/packages\/[^/]+\/src\//.test(noComments)) {
    errors.push(`[G-facade] Deep src import in ${rel}`);
  }
  if (rel.startsWith("packages/fanqie/") && /@zhizhang\/toutiao/.test(noComments)) {
    errors.push(`[G-layer] fanqie imports toutiao in ${rel}`);
  }
  if (rel.startsWith("packages/toutiao/") && /@zhizhang\/fanqie/.test(noComments)) {
    errors.push(`[G-layer] toutiao imports fanqie in ${rel}`);
  }

  // G-app: session/renderer must not import main/
  if (
    rel.startsWith("apps/desktop/src/session/") ||
    rel.startsWith("apps/desktop/src/renderer/")
  ) {
    if (/(?:from|import\s*\()\s*["'][^"']*(?:^|\/)main(?:\/|["'])/.test(noComments)) {
      errors.push(`[G-app] session/renderer imports main/ in ${rel}`);
    }
  }

  // G-pi: @earendil-works/pi-* only allowed in apps/desktop/src/session/pi-adapter.ts
  if (
    /(?:from|import\s*\()\s*["']@earendil-works\/pi-/.test(noComments) &&
    rel !== "apps/desktop/src/session/pi-adapter.ts"
  ) {
    errors.push(`[G-pi] @earendil-works/pi-* only allowed in session/pi-adapter.ts (found in ${rel})`);
  }

  // G-copy: forbid Chinese text in JSX (strict for desktop/renderer and ui; hint for workbench/client)
  if (file.endsWith(".tsx")) {
    const jsxChinese = noComments.match(/>[^<>{}]*[\u4e00-\u9fff][^<>{}]*</g) || [];
    if (jsxChinese.length > 0) {
      if (rel.startsWith("apps/desktop/src/renderer/") || rel.startsWith("packages/ui/src/")) {
        errors.push(`[G-copy] Chinese literal in JSX in ${rel} (${jsxChinese.length} occurrence(s))`);
      } else {
        warnings.push(`[G-copy] Chinese literal in JSX in ${rel} (${jsxChinese.length} occurrence(s))`);
      }
    }
  }

  // G-copy: forbid duplicating PASS_SCORE = 84, TITLE_MAX = 34, or toutiao status constants in TS
  if (/(?:PASS_SCORE|passScore|TITLE_MAX|titleMax)\s*=\s*(?:84|34)\b/.test(noComments)) {
    errors.push(`[G-copy] Hardcoded business constant (84/34) in ${rel}; read from rules.py bridge`);
  }
  if (
    rel !== "packages/toutiao/src/domain/status.ts" &&
    /(?:ARTICLE_STATUSES|FIXED_DELIVERY_ENDING)\s*=/.test(noComments)
  ) {
    errors.push(`[G-copy] Duplicate status/ending definition in ${rel}`);
  }

  // G-type: count any, !, !:, and as assertions
  anyCount += (codeOnly.match(/:\s*any\b|<any>|as\s+any\b|\bany\[\]/g) || []).length;
  defAssignCount += (codeOnly.match(/\w+!\s*:/g) || []).length;
  nonNullCount += (codeOnly.match(/[\w)\]]!\s*(?:[.;,)\]]|\?\.)/g) || []).length;
  asCount += (codeOnly.match(/\bas\s+(?!const\b)[A-Za-z_({\[]/g) || []).length;

  // G-size: >400 lines hint
  const lines = txt.split(/\r?\n/).length;
  if (lines > 400) {
    warnings.push(`[G-size] ${rel} has ${lines} lines (> 400)`);
  }
}

const baselinePath = path.join(ROOT, "scripts/any-baseline.json");
const baseline = fs.existsSync(baselinePath)
  ? JSON.parse(fs.readFileSync(baselinePath, "utf8"))
  : {};

if (typeof baseline.any === "number" && anyCount > baseline.any) {
  errors.push(`[G-type] any count ${anyCount} exceeds baseline ${baseline.any}`);
}
if (typeof baseline.nonNull === "number" && nonNullCount > baseline.nonNull) {
  errors.push(`[G-type] non-null (!) count ${nonNullCount} exceeds baseline ${baseline.nonNull}`);
}
if (defAssignCount > 0) {
  errors.push(`[G-type] definite assignment (!:) count ${defAssignCount} must be 0`);
}
if (typeof baseline.as === "number" && asCount > baseline.as) {
  errors.push(`[G-type] 'as' assertion count ${asCount} exceeds baseline ${baseline.as}`);
}

// 3. G-error: no throw new Error( in packages/*/src/ and baseline-capped in apps/desktop/src/main/
for (const file of walk(path.join(ROOT, "packages"), [".ts", ".tsx"])) {
  const txt = fs.readFileSync(file, "utf8");
  const rel = toPosix(path.relative(ROOT, file));
  if (/throw\s+new\s+Error\(/.test(txt)) {
    errors.push(`[G-error] Raw throw new Error() in ${rel}`);
  }
}

let mainRawErrorCount = 0;
for (const file of walk(path.join(ROOT, "apps/desktop/src/main"), [".ts", ".tsx"])) {
  const txt = fs.readFileSync(file, "utf8");
  const rel = toPosix(path.relative(ROOT, file));
  const matches = txt.match(/throw\s+new\s+Error\(/g) || [];
  if (matches.length > 0) {
    mainRawErrorCount += matches.length;
    warnings.push(`[G-error] Raw throw new Error() in ${rel} (${matches.length})`);
  }
}
if (typeof baseline.mainRawError === "number" && mainRawErrorCount > baseline.mainRawError) {
  errors.push(
    `[G-error] main/ raw throw new Error() count ${mainRawErrorCount} exceeds baseline ${baseline.mainRawError}`,
  );
}

// 4. G-exports: verify package.json exports targets & track unreferenced non-barrel exports
for (const pkgDir of fs.readdirSync(path.join(ROOT, "packages"), { withFileTypes: true })) {
  if (!pkgDir.isDirectory()) continue;
  const pkgJsonPath = path.join(ROOT, "packages", pkgDir.name, "package.json");
  if (!fs.existsSync(pkgJsonPath)) continue;
  const pkgJson = JSON.parse(fs.readFileSync(pkgJsonPath, "utf8"));
  if (pkgJson.exports && typeof pkgJson.exports === "object") {
    for (const [subpath, target] of Object.entries(pkgJson.exports)) {
      const targetStr =
        typeof target === "string"
          ? target
          : (target?.default ?? target?.import ?? target?.types ?? "");
      if (!targetStr || targetStr.endsWith(".css")) {
        if (targetStr && !fs.existsSync(path.join(ROOT, "packages", pkgDir.name, targetStr))) {
          errors.push(`[G-exports] Missing export target ${targetStr} for ${pkgJson.name} (${subpath})`);
        }
        continue;
      }
      const srcCandidate = targetStr
        .replace(/^\.\/dist\//, "./src/")
        .replace(/\.js$/, ".ts");
      const tsxCandidate = srcCandidate.replace(/\.ts$/, ".tsx");
      const fullBase = path.join(ROOT, "packages", pkgDir.name);
      if (
        !fs.existsSync(path.join(fullBase, srcCandidate)) &&
        !fs.existsSync(path.join(fullBase, tsxCandidate)) &&
        !fs.existsSync(path.join(fullBase, targetStr))
      ) {
        errors.push(`[G-exports] Missing export source for ${pkgJson.name} (${subpath}): ${targetStr}`);
      }
    }
  }
}

const testFiles = walk(path.join(ROOT, "test"), [".mjs", ".ts"]);
const combinedCorpus = [...allTs, ...testFiles].map((f) => fs.readFileSync(f, "utf8")).join("\n");
const reexportedFiles = new Set();
for (const file of allTs) {
  const txt = fs.readFileSync(file, "utf8");
  for (const m of txt.matchAll(/export\s+\*\s+from\s+["']([^"']+)["']/g)) {
    const resolved = path.normalize(path.join(path.dirname(file), m[1].replace(/\.js$/, ".ts")));
    reexportedFiles.add(resolved);
    reexportedFiles.add(resolved.replace(/\.ts$/, `${path.sep}index.ts`));
  }
}
const unusedExports = [];
for (const file of allTs) {
  const norm = path.normalize(file);
  if (file.endsWith("index.ts") || file.endsWith("index.tsx") || file.endsWith(".d.ts")) continue;
  if (reexportedFiles.has(norm)) continue;
  const txt = fs.readFileSync(file, "utf8");
  for (const m of txt.matchAll(
    /^\s*export\s+(?:async\s+)?(?:function|const|let|class|type|interface|enum)\s+([A-Za-z_]\w*)/gm,
  )) {
    const name = m[1];
    const count = (combinedCorpus.match(new RegExp(`\\b${name}\\b`, "g")) || []).length;
    if (count <= 1) {
      unusedExports.push(`${toPosix(path.relative(ROOT, file))}:${name}`);
    }
  }
}
if (typeof baseline.unusedExports === "number" && unusedExports.length > baseline.unusedExports) {
  errors.push(
    `[G-exports] Unused export count ${unusedExports.length} exceeds baseline ${baseline.unusedExports}: ${unusedExports.slice(0, 5).join(", ")}`,
  );
}

// 5. G-brand: no legacy brand tokens in v1.3 manifests & new modules
const brandFiles = [
  path.join(ROOT, "package.json"),
  path.join(ROOT, "apps/desktop/package.json"),
  path.join(ROOT, "apps/desktop/electron-builder.yml"),
];
for (const file of brandFiles) {
  const txt = fs.readFileSync(file, "utf8");
  const rel = toPosix(path.relative(ROOT, file));
  if (/writer-agent|local\.writer\.agent|写作 Agent|dsh-zhizhang|@writer\//.test(txt)) {
    errors.push(`[G-brand] Legacy brand reference in ${rel}`);
  }
}

// 6. G-docs: docs/ directory + root docs limited to 8 target docs
const docFiles = [
  ...walk(path.join(ROOT, "docs"), [".md"]),
  path.join(ROOT, "README.md"),
  path.join(ROOT, "AGENTS.md"),
  path.join(ROOT, "CHANGELOG.md"),
];
if (docFiles.length > 8) {
  errors.push(`[G-docs] Expected <= 8 docs, found ${docFiles.length}`);
}

// 7. G-rules: rules.py single source PASS_SCORE = 84 & TITLE_MAX = 34
const rulesPy = fs.readFileSync(path.join(ROOT, "packages/toutiao/skill/scripts/rules.py"), "utf8");
if (!/PASS_SCORE\s*=\s*84/.test(rulesPy) || !/TITLE_MAX\s*=\s*34/.test(rulesPy)) {
  errors.push("[G-rules] rules.py missing PASS_SCORE = 84 or TITLE_MAX = 34");
}

// 8. G-css: forbid --ui-/--wb- and hex colors in non-token CSS files
const allCss = [
  ...walk(path.join(ROOT, "packages"), [".css"]),
  ...walk(path.join(ROOT, "apps/desktop/src"), [".css"]),
];
for (const file of allCss) {
  const raw = fs.readFileSync(file, "utf8");
  const txt = raw.replace(/\/\*[\s\S]*?\*\//g, "");
  const rel = toPosix(path.relative(ROOT, file));
  if (/--(?:ui|wb)-/.test(txt)) {
    errors.push(`[G-css] Forbidden --ui-/--wb- variable in ${rel}`);
  }
  const isTokenFile = rel.endsWith("tokens.css") || rel.includes("/tokens/");
  const withoutUrls = txt.replace(/url\([^)]*\)/gi, "");
  if (!isTokenFile && /#[0-9a-fA-F]{3,8}\b/.test(withoutUrls)) {
    errors.push(`[G-css] Raw hex color outside token file in ${rel}`);
  }
  const lines = raw.split(/\r?\n/).length;
  if (lines > 400) {
    warnings.push(`[G-size] ${rel} has ${lines} lines (> 400)`);
  }
}

console.log(
  `[G-type] any=${anyCount}, !=${nonNullCount}, !=:${defAssignCount}, as=${asCount} | [G-error] main=${mainRawErrorCount} | [G-exports] unused=${unusedExports.length}`,
);

if (warnings.length > 0) {
  console.warn("Guard hints:\n" + warnings.map((w) => "  - " + w).join("\n"));
}

if (errors.length > 0) {
  console.error("Guard failed:\n" + errors.map((e) => "  - " + e).join("\n"));
  process.exit(1);
}
console.log(
  `Guard passed (${allTs.length} TS/TSX files, ${allCss.length} CSS files, ${docFiles.length} docs checked).`,
);
