export type { TextHighlightRange, TextSurface } from "./TextSurface.js";
export { TextareaSurface, type TextareaSurfaceOptions } from "./TextareaSurface.js";
export { findMatches, matchFrom, matchesToHighlights, type TextMatchRange } from "./find.js";
export {
  DRAFTS_DIR,
  articleDraftKey,
  chapterDraftKey,
  clearDraftFile,
  createNodeDraftBackend,
  draftFileName,
  draftFilePath,
  readDraftFile,
  writeDraftFile,
  type DraftEntry,
  type DraftFileBackend,
} from "./drafts.js";
