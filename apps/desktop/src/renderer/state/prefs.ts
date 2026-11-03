import type { Focus, Target } from "../../context";
import {
  PREF,
  readPref,
  writePref,
} from "../../../../../packages/workbench/src/client/shared/prefs.js";

export function remember(target: Target, focus: Focus = {}, preserve = false) {
  if (target.mode === "fanqie") {
    writePref(PREF.project, "");
    writePref(PREF.work, target.work || "");
    if (!preserve) {
      writePref(PREF.chapter, focus.chapter || "");
      writePref(PREF.candidate, focus.candidate || "");
      writePref(PREF.readerView, focus.candidate ? "candidate" : "official");
    }
    if (focus.chapter) writePref(PREF.view, "chapters");
  } else {
    writePref(PREF.ttRoot, target.root);
    if (!preserve) writePref(PREF.ttArticle, focus.article || "");
  }
}
