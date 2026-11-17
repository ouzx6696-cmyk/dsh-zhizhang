import { arr, bool, int, lit, obj, opt, str, type Parser } from "@zhizhang/core/schema";
import type { CommandInput, WorkbenchCommand } from "@zhizhang/workbench/contract";
import { BIBLE_INPUTS, PENDING_INPUTS } from "./commands-bible.js";
import { IMPORT_INPUTS } from "./commands-import.js";
import { CHECK_INPUTS } from "./commands-ledger.js";
import { OUTLINE_INPUTS } from "./commands-outline.js";
import { PROFILE_INPUTS } from "./commands-profiles.js";
const id = str({ min: 1, max: 200 });
const grade = lit("economy", "standard", "premium");

export const INPUTS: { [K in WorkbenchCommand]: Parser<CommandInput<K>> } = {
  "fanqie.snapshot": obj({ work: id, since: opt(str()) }),
  "fanqie.chapter.list": obj({ work: id }),
  "fanqie.chapter.get": obj({ work: id, chapter: id }),
  "fanqie.chapter.save": obj({
    work: id,
    chapter: id,
    base: str(),
    body: str({ max: 2_000_000 }),
    title: opt(str({ max: 100, trim: true })),
  }),
  "fanqie.chapter.finalize": obj({ work: id, chapter: id }),
  "fanqie.candidate.list": obj({ work: id, chapter: opt(id) }),
  "fanqie.candidate.get": obj({ work: id, chapter: id, candidateId: id }),
  "fanqie.candidate.accept": obj({ work: id, chapter: id, candidateId: id, base: str() }),
  "fanqie.candidate.reject": obj({
    work: id,
    chapter: id,
    candidateId: id,
    reason: opt(str({ max: 2000 })),
  }),
  "fanqie.work.list": obj({ root: id }),
  "fanqie.work.get": obj({ work: id }),
  "fanqie.work.create": obj({
    root: id,
    title: str({ min: 1, max: 100, trim: true }),
    premise: str({ max: 20000 }),
    grade,
  }),
  "fanqie.work.settings": obj({
    work: id,
    grade: opt(grade),
    profile: opt(id),
    requireEditorPass: opt(bool),
    targetWords: opt(int({ min: 500, max: 20000 })),
    previousTextMode: opt(lit("auto", "full", "tail")),
    ledger: opt(lit("auto", "ask", "off")),
    threadForgetAfter: opt(int({ min: 1, max: 100 })),
    recentFactsWindow: opt(int({ min: 0, max: 20 })),
    contextBudget: opt(int({ min: 4000, max: 200000 })),
    terminalStates: opt(arr(str({ max: 60 }), { max: 20 })),
  }),
  "fanqie.book.export": obj({ work: id, format: lit("txt", "docx"), finalOnly: bool, outPath: id }),
  "fanqie.reference.bind": obj({ work: id, sourceId: id, cardIds: opt(arr(id, { max: 200 })) }),
  ...OUTLINE_INPUTS,
  ...BIBLE_INPUTS,
  ...PENDING_INPUTS,
  ...IMPORT_INPUTS,
  ...CHECK_INPUTS,
  "toutiao.articles": obj({ root: id }),
  "toutiao.article.create": obj({ root: id, genre: id, driver: id }),
  "toutiao.article.transition": obj({ articleDir: id, to: id }),
  "toutiao.article.deliver": obj({
    articleDir: id,
    title: str({ min: 1, max: 200 }),
    body: str({ min: 1, max: 400_000 }),
  }),
  "toutiao.article.export": obj({
    articleDir: id,
    outPath: id,
    format: opt(lit("md", "txt")),
    includeDelivery: opt(bool),
  }),
  "toutiao.draft.get": obj({ articleDir: id }),
  "toutiao.draft.save": obj({
    articleDir: id,
    title: opt(str({ max: 200 })),
    body: str({ min: 1, max: 400_000 }),
    revision: opt(str()),
  }),
  "toutiao.source.register": obj({
    articleDir: id,
    sourceId: id,
    kind: lit("paste", "file", "classic"),
    content: str({ min: 1, max: 2_000_000 }),
  }),
  "toutiao.ledger.show": obj({ ledgerPath: id, last: opt(int({ min: 1, max: 200 })) }),
  "toutiao.ledger.add": obj({
    cardPath: id,
    ledgerPath: id,
    articleId: opt(id),
    status: opt(id),
    date: opt(id),
  }),
  "toutiao.ledger.status": obj({ title: id, to: id, ledgerPath: id, articleId: opt(id) }),
  "toutiao.metrics.import": obj({
    articleId: id,
    metricsJson: str({ min: 1, max: 400_000 }),
    ledgerPath: id,
    url: opt(str()),
  }),
  ...PROFILE_INPUTS,
  "library.import": obj({
    libraryRoot: id,
    id: str({ min: 1, max: 80 }),
    title: str({ min: 1, max: 200 }),
    content: str({ min: 1, max: 20_000_000 }),
  }),
  "library.list": obj({ libraryRoot: id }),
  "library.cards": obj({ libraryRoot: id, sourceId: id }),
  "library.dissect": obj({
    libraryRoot: id,
    sourceId: id,
    title: str({ min: 1, max: 200 }),
    sourcePath: opt(id),
  }),
};
