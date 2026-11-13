// Test-only entry: production components are imported without production test exports.
export { Manuscript } from "../../packages/workbench/src/client/shared/Manuscript.jsx";
export { WriterAgent } from "../../packages/workbench/src/client/fanqie/Inspector.jsx";
export {
  ToutiaoSide,
  ArticleList,
} from "../../packages/workbench/src/client/toutiao/ToutiaoApp.jsx";
export { ProfilesDialog } from "../../packages/workbench/src/client/shared/Profiles.jsx";
export { ActionButton } from "../../packages/workbench/src/client/shared/ui.js";
export { Pipeline } from "../../packages/workbench/src/client/fanqie/Pipeline.jsx";
export { initialState, reducer } from "../../packages/workbench/src/client/fanqie/state.js";
export { notify, dismissNotice, dismissNotices, NoticeStack } from "@writer/ui/notify";
export { TabList, tabPanelProps } from "@writer/ui/tabs";
export { shortcutLabel } from "@writer/ui/keys";
export {
  chapterDraftKey,
  articleDraftKey,
  readDraft,
  writeDraft,
  clearDraft,
  otherDraftKeys,
} from "../../packages/workbench/src/client/shared/drafts.js";
export { SourceEditor } from "../../packages/workbench/src/client/shared/SourceEditor.jsx";
export { setConfirm } from "../../packages/workbench/src/client/shared/confirm.js";
export { findMatches, matchFrom } from "../../packages/workbench/src/client/shared/find.js";
export { useDraftStash } from "../../packages/workbench/src/client/shared/useDraftStash.js";
export {
  readScrollRatio,
  applyScrollRatio,
} from "../../packages/workbench/src/client/shared/reading-position.js";
