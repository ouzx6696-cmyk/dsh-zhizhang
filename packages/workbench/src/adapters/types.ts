import type {
  CommandInput,
  CommandResult,
  WorkbenchCommand,
  WorkbenchCommandMap,
} from "../contract/commands.js";

export class ApiError extends Error {
  uncertain: boolean;
  code: string;
  constructor(message: string, { uncertain = false, code = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.uncertain = uncertain;
    this.code = code;
  }
}

export interface RequestOptions {
  signal?: AbortSignal;
}

export interface ErrorReceipt {
  ok: false;
  error?: string;
  message?: string;
  uncertain?: boolean;
  code?: string;
}

export type DesktopBridge = {
  request: <K extends WorkbenchCommand>(
    command: K,
    options: { kind: WorkbenchCommandMap[K]["access"]; input: CommandInput<K> },
  ) => Promise<{ data: CommandResult<K> | ErrorReceipt }>;
};

export interface FanqieData {
  snapshot(
    input: CommandInput<"fanqie.snapshot">,
    options?: RequestOptions,
  ): Promise<CommandResult<"fanqie.snapshot">>;
  chapter(
    input: CommandInput<"fanqie.chapter.get">,
    options?: RequestOptions,
  ): Promise<CommandResult<"fanqie.chapter.get">>;
  saveChapter(
    input: CommandInput<"fanqie.chapter.save">,
    options?: RequestOptions,
  ): Promise<CommandResult<"fanqie.chapter.save">>;
  finalizeChapter(
    input: CommandInput<"fanqie.chapter.finalize">,
    options?: RequestOptions,
  ): Promise<CommandResult<"fanqie.chapter.finalize">>;
  acceptCandidate(
    input: CommandInput<"fanqie.candidate.accept">,
    options?: RequestOptions,
  ): Promise<CommandResult<"fanqie.candidate.accept">>;
  createWork(
    input: CommandInput<"fanqie.work.create">,
    options?: RequestOptions,
  ): Promise<CommandResult<"fanqie.work.create">>;
  exportBook(
    input: CommandInput<"fanqie.book.export">,
    options?: RequestOptions,
  ): Promise<CommandResult<"fanqie.book.export">>;
}

export interface ToutiaoData {
  articles(
    input: CommandInput<"toutiao.articles">,
    options?: RequestOptions,
  ): Promise<CommandResult<"toutiao.articles">>;
  createArticle(
    input: CommandInput<"toutiao.article.create">,
    options?: RequestOptions,
  ): Promise<CommandResult<"toutiao.article.create">>;
  transitionArticle(
    input: CommandInput<"toutiao.article.transition">,
    options?: RequestOptions,
  ): Promise<CommandResult<"toutiao.article.transition">>;
  deliverArticle(
    input: CommandInput<"toutiao.article.deliver">,
    options?: RequestOptions,
  ): Promise<CommandResult<"toutiao.article.deliver">>;
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
