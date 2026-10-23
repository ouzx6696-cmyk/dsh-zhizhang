/**
 * Version used by tests. Never hardcode a version string in a test file:
 * PLUGIN_VERSION is the single source of truth (scripts/smoke.mjs asserts it matches package.json).
 */
export { PLUGIN_VERSION } from "../src/lib/version.ts";
