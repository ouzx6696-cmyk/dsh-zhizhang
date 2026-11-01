import { build } from "esbuild";
for (const name of [
  "session",
  "settings",
  "network",
  "models",
  "pi",
  "exports",
])
  await build({
    entryPoints: [`apps/desktop/src/${name}.ts`],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `apps/desktop/out-test/${name}.mjs`,
    logLevel: "warning",
  });

await build({
  entryPoints: ["packages/core/src/workspace-lock.ts"],
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  outfile: "apps/desktop/out-test/lease.mjs",
});

for (const [name, entry] of [
  ["work-store", "packages/fanqie/src/engine/work-store.ts"],
  ["review", "packages/fanqie/src/review.ts"],
  ["article-store", "packages/toutiao/src/store.ts"],
])
  await build({
    entryPoints: [entry],
    bundle: true,
    platform: "node",
    format: "esm",
    packages: "external",
    outfile: `apps/desktop/out-test/${name}.mjs`,
    logLevel: "warning",
  });
