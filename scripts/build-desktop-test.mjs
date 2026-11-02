import { build } from "esbuild";
import path from "node:path";
const entries = [
  ["runtime-effects", "test/desktop/runtime-effects.ts"],
  ["targets", "apps/desktop/src/main/targets.ts"],
  ["session", "apps/desktop/src/session/index.ts"],
  ["pi", "apps/desktop/src/session/pi-adapter.ts"],
  ["recovery", "apps/desktop/src/recovery.ts"],
  ["settings", "apps/desktop/src/settings.ts"],
  ["network", "apps/desktop/src/network.ts"],
  ["models", "apps/desktop/src/models.ts"],
  ["exports", "apps/desktop/src/exports.ts"],
];
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
    ...(name === "runtime-effects" ? { alias: { electron: path.resolve("test/desktop/electron-fixture.mjs") } } : {}),
    outfile: `apps/desktop/out-test/${name}.mjs`,
    logLevel: "warning",
  });
