/** Keep test writes away from any real DSH home or configured asset roots. */
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
const testHome = mkdtempSync(path.join(tmpdir(), "zhizhang-test-home-"));
process.env.DSH_HOME = testHome;
for (const key of ["DSH_ZHIZHANG_ROOT", "DSH_ZHIZHANG_WORKS", "DSH_ZHIZHANG_LIBRARY", "DSH_ZHIZHANG_SOURCE_ROOT", "DSH_ZHIZHANG_MULTI_DRAFT"])
    delete process.env[key];
process.once("exit", () => rmSync(testHome, { recursive: true, force: true }));
