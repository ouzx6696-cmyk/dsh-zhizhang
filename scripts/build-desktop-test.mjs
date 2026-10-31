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
