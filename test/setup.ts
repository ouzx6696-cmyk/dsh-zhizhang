/**
 * Test preload (see the "test" script in package.json).
 *
 * Tool calls register their workspace in `$DSH_HOME/zhizhang-projects.json` and
 * `$DSH_HOME/zhizhang-last-root.json`. Without isolation every `npm test` run
 * pollutes the real `~/.dsh` index with throwaway temp roots, and can also
 * repoint the panel's HTTP storage root at a directory that no longer exists.
 *
 * `store.ts` reads `DSH_HOME` lazily on each call, so setting it here (before
 * any test file imports the modules) is enough. `scripts/smoke.mjs` already
 * does the same for its own process.
 */
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

if (!(process.env.DSH_HOME ?? "").trim()) {
  process.env.DSH_HOME = mkdtempSync(path.join(tmpdir(), "zhizhang-test-home-"));
}
