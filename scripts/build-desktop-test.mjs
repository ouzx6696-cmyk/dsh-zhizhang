import { build } from "esbuild";
const entries = [
  "session",
  "recovery",
  "settings",
  "network",
  "models",
  "pi",
  "exports",
].map(name => [name, `apps/desktop/src/${name}.ts`]);
entries.push(["lease", "packages/core/src/workspace-lock.ts"],
  ["work-store", "packages/fanqie/src/engine/work-store.ts"],
  ["review", "packages/fanqie/src/review.ts"],
  ["article-store", "packages/toutiao/src/store.ts"]);
for (const [name, entry] of entries)
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `apps/desktop/out-test/${name}.mjs`,
    logLevel: "warning",
  });
