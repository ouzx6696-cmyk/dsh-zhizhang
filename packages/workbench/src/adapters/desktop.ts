import { AppError } from "@zhizhang/core/errors";
import {
  COMMAND_POLICY,
  type CommandInput,
  type CommandResult,
  type WorkbenchCommand,
} from "../contract/commands.js";
import type {
  FanqieData,
  RequestOptions,
  ToutiaoData,
  WorkbenchData,
  WorkbenchTransport,
} from "./types.js";

function aborted(command: WorkbenchCommand): AppError {
  // 写命令在途中被取消时，主进程可能已经落盘：标记 uncertain，界面据此提示作者刷新核对。
  return new AppError("run.stopped", "请求已取消", {
    command,
    uncertain: COMMAND_POLICY[command].access === "write",
  });
}

export function createDesktopAdapter(transport: () => WorkbenchTransport): WorkbenchData {
  async function call<K extends WorkbenchCommand>(
    command: K,
    input: CommandInput<K>,
    { signal }: RequestOptions = {},
  ): Promise<CommandResult<K>> {
    if (signal?.aborted) throw aborted(command);
    const result = await transport().call(command, input);
    if (signal?.aborted) throw aborted(command);
    return result;
  }
  const fanqie: FanqieData = {
    snapshot: (input, options) => call("fanqie.snapshot", input, options),
    chapter: (input, options) => call("fanqie.chapter.get", input, options),
    saveChapter: (input, options) => call("fanqie.chapter.save", input, options),
    finalizeChapter: (input, options) => call("fanqie.chapter.finalize", input, options),
    acceptCandidate: (input, options) => call("fanqie.candidate.accept", input, options),
    createWork: (input, options) => call("fanqie.work.create", input, options),
    exportBook: (input, options) => call("fanqie.book.export", input, options),
  };
  const toutiao: ToutiaoData = {
    articles: (input, options) => call("toutiao.articles", input, options),
    createArticle: (input, options) => call("toutiao.article.create", input, options),
    transitionArticle: (input, options) => call("toutiao.article.transition", input, options),
    deliverArticle: (input, options) => call("toutiao.article.deliver", input, options),
  };
  return { call, fanqie, toutiao };
}
