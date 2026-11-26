import type { WorkbenchCommand, WorkbenchCommandMap } from "./commands.js";

export type CommandRefreshScope = "rows" | "chapter" | "bible" | "article" | "profiles" | "library";

export interface CommandPolicy<K extends WorkbenchCommand> {
  access: WorkbenchCommandMap[K]["access"];
  /** 写命令成功后广播给渲染层的刷新范围。 */
  refresh?: CommandRefreshScope;
}

/** 读写与广播策略的唯一来源：主进程据此做只读门禁与 workspace.changed 广播。 */
export const COMMAND_POLICY: { readonly [K in WorkbenchCommand]: CommandPolicy<K> } = {
  "fanqie.snapshot": { access: "read" },
  "fanqie.chapter.list": { access: "read" },
  "fanqie.chapter.get": { access: "read" },
  "fanqie.chapter.save": { access: "write", refresh: "chapter" },
  "fanqie.chapter.finalize": { access: "write", refresh: "chapter" },
  "fanqie.candidate.list": { access: "read" },
  "fanqie.candidate.get": { access: "read" },
  "fanqie.candidate.accept": { access: "write", refresh: "chapter" },
  "fanqie.candidate.reject": { access: "write", refresh: "chapter" },
  "fanqie.work.list": { access: "read" },
  "fanqie.work.get": { access: "read" },
  "fanqie.work.create": { access: "write", refresh: "rows" },
  "fanqie.work.previewLegacy": { access: "read" },
  "fanqie.work.importLegacy": { access: "write", refresh: "rows" },
  "fanqie.work.settings": { access: "write", refresh: "rows" },
  "fanqie.book.export": { access: "read" },
  "fanqie.bible.get": { access: "read" },
  "fanqie.bible.view": { access: "read" },
  "fanqie.bible.propose": { access: "write", refresh: "bible" },
  "fanqie.bible.decide": { access: "write", refresh: "bible" },
  "fanqie.bible.audit": { access: "read" },
  "fanqie.bible.trace": { access: "read" },
  "fanqie.reference.bind": { access: "write", refresh: "rows" },
  "fanqie.reference.list": { access: "read" },
  "toutiao.articles": { access: "read" },
  "toutiao.article.create": { access: "write", refresh: "article" },
  "toutiao.article.transition": { access: "write", refresh: "article" },
  "toutiao.article.deliver": { access: "write", refresh: "article" },
  "toutiao.article.export": { access: "read" },
  "toutiao.draft.get": { access: "read" },
  "toutiao.draft.save": { access: "write", refresh: "article" },
  "toutiao.source.register": { access: "write", refresh: "article" },
  "toutiao.ledger.show": { access: "read" },
  "toutiao.ledger.add": { access: "write", refresh: "article" },
  "toutiao.ledger.status": { access: "write", refresh: "article" },
  "toutiao.metrics.import": { access: "write", refresh: "article" },
  "profiles.list": { access: "read" },
  "profiles.detail": { access: "read" },
  "profiles.method": { access: "read" },
  "profiles.use": { access: "write", refresh: "profiles" },
  "profiles.create": { access: "write", refresh: "profiles" },
  "profiles.save": { access: "write", refresh: "profiles" },
  "profiles.reset": { access: "write", refresh: "profiles" },
  "profiles.rename": { access: "write", refresh: "profiles" },
  "profiles.delete": { access: "write", refresh: "profiles" },
  "library.import": { access: "write", refresh: "library" },
  "library.list": { access: "read" },
  "library.cards": { access: "read" },
  "library.cards.save": { access: "write", refresh: "library" },
  "library.dissect": { access: "write", refresh: "library" },
};
