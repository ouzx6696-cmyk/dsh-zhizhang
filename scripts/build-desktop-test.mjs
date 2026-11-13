import { build } from "esbuild";
import path from "node:path";
const entries = [
  ["runtime-effects", "test/desktop/runtime-effects.ts"],
  ["targets", "apps/desktop/src/main/targets.ts"],
  ["usage", "apps/desktop/src/session/usage.ts"],
  ["session", "apps/desktop/src/session/index.ts"],
  ["pi", "apps/desktop/src/session/pi-adapter.ts"],
  ["recovery", "apps/desktop/src/recovery.ts"],
  ["ipc-contract", "apps/desktop/src/main/ipc/contract.ts"],
  ["diagnostics", "packages/core/src/diagnostics.ts"],
  ["settings", "apps/desktop/src/settings.ts"],
  ["network", "apps/desktop/src/network.ts"],
  ["context-settings", "apps/desktop/src/context-settings.ts"],
  ["models", "apps/desktop/src/models.ts"],
  ["exports", "apps/desktop/src/exports.ts"],
];
entries.push(
  ["article-facts", "apps/desktop/src/workflow/article-facts.ts"],
  ["task-pool", "apps/desktop/src/session/task-pool.ts"],
  ["workflow-run", "apps/desktop/src/workflow/run.ts"],
  ["workflow-recovery", "apps/desktop/src/workflow/recovery.ts"],
  ["workflow-methods", "apps/desktop/src/workflow/methods.ts"],
  ["lease", "packages/core/src/workspace-lock.ts"],
  ["work-store", "packages/fanqie/src/engine/work-store.ts"],
  ["review", "packages/fanqie/src/review.ts"],
  ["article-store", "packages/toutiao/src/store.ts"],
  ["workflow-schema", "apps/desktop/src/workflow/schema.ts"],
  ["workflow-editor", "apps/desktop/src/workflow/editor.ts"],
  ["stage-model", "apps/desktop/src/workflow/stage-model.ts"],
  ["workflow-config", "packages/core/src/workflow-config.ts"],
  ["zoom", "apps/desktop/src/main/zoom.ts"],
);
const options = {
  bundle: true,
  platform: "node",
  format: "esm",
  packages: "external",
  logLevel: "warning",
};
await Promise.all([
  build({
    ...options,
    entryPoints: Object.fromEntries(entries.filter(([name]) => name !== "runtime-effects")),
    outdir: "apps/desktop/out-test",
    outExtension: { ".js": ".mjs" },
  }),
  build({
    ...options,
    entryPoints: ["test/desktop/runtime-effects.ts"],
    alias: { electron: path.resolve("test/desktop/electron-fixture.mjs") },
    outfile: "apps/desktop/out-test/runtime-effects.mjs",
  }),
]);
