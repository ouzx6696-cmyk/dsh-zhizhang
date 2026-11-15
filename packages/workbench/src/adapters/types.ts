import type { CommandInput, CommandResult, WorkbenchCommand } from "../contract/commands.js";

export interface RequestOptions {
  signal?: AbortSignal;
}

/**
 * 写作区命令的传输：渲染层用 `createDesktopApi(() => window.zhizhangBridge).workbench`
 * 注入（经 preload 的 "zhizhang:workbench.call" 通道），失败时抛 AppError（码 + 消息 + 数据）。
 */
export interface WorkbenchTransport {
  call<K extends WorkbenchCommand>(command: K, input: CommandInput<K>): Promise<CommandResult<K>>;
}

type Call<K extends WorkbenchCommand> = (
  input: CommandInput<K>,
  options?: RequestOptions,
) => Promise<CommandResult<K>>;

export interface FanqieData {
  snapshot: Call<"fanqie.snapshot">;
  chapter: Call<"fanqie.chapter.get">;
  saveChapter: Call<"fanqie.chapter.save">;
  finalizeChapter: Call<"fanqie.chapter.finalize">;
  acceptCandidate: Call<"fanqie.candidate.accept">;
  createWork: Call<"fanqie.work.create">;
  exportBook: Call<"fanqie.book.export">;
}

export interface ToutiaoData {
  articles: Call<"toutiao.articles">;
  createArticle: Call<"toutiao.article.create">;
  transitionArticle: Call<"toutiao.article.transition">;
  deliverArticle: Call<"toutiao.article.deliver">;
}

export interface WorkbenchData {
  call<K extends WorkbenchCommand>(
    command: K,
    input: CommandInput<K>,
    options?: RequestOptions,
  ): Promise<CommandResult<K>>;
  fanqie: FanqieData;
  toutiao: ToutiaoData;
}
