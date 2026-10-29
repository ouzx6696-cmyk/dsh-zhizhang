/** Stable public facade. Internal persistence and queries have one-way dependencies. */
export * from "./work-store.js";
export { buildPanelSnapshot, buildPanelHints, listChapterLensRows } from "./panel-query.js";
