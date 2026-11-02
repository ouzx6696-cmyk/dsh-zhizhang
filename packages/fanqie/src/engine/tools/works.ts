import { projectCreate } from "./works/project-create.js";
import { projectOpen } from "./works/project-open.js";
import { projectList } from "./works/project-list.js";
import { status } from "./works/status.js";
import { foundationGet } from "./works/foundation-get.js";
import { foundationSet } from "./works/foundation-set.js";
import { foundationAppendHappened } from "./works/foundation-append-happened.js";
import { outlineGet } from "./works/outline-get.js";
import { outlineSet } from "./works/outline-set.js";
import { chapterList } from "./works/chapter-list.js";
import { chapterRead } from "./works/chapter-read.js";
import { chapterSave } from "./works/chapter-save.js";
export function worksTools() {
  return [
    projectCreate,
    projectOpen,
    projectList,
    status,
    foundationGet,
    foundationSet,
    foundationAppendHappened,
    outlineGet,
    outlineSet,
    chapterList,
    chapterRead,
    chapterSave,
  ];
}
