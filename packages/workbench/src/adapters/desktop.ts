import type {
  CommandInput,
  CommandResult,
  WorkbenchCommand,
  WorkbenchCommandMap,
} from "../contract/commands.js";
import {
  ApiError,
  type DesktopBridge,
  type ErrorReceipt,
  type FanqieData,
  type RequestOptions,
  type ToutiaoData,
  type WorkbenchData,
} from "./types.js";

const COMMAND_ACCESS: { [K in WorkbenchCommand]: WorkbenchCommandMap[K]["access"] } = {
  "fanqie.snapshot": "read",
  "fanqie.chapter.list": "read",
  "fanqie.chapter.get": "read",
  "fanqie.chapter.save": "write",
  "fanqie.chapter.finalize": "write",
  "fanqie.candidate.list": "read",
  "fanqie.candidate.get": "read",
  "fanqie.candidate.accept": "write",
  "fanqie.candidate.reject": "write",
  "fanqie.work.list": "read",
  "fanqie.work.get": "read",
  "fanqie.work.create": "write",
  "fanqie.work.settings": "write",
  "fanqie.book.export": "read",
  "fanqie.bible.get": "read",
  "fanqie.bible.view": "read",
  "fanqie.bible.propose": "write",
  "fanqie.bible.decide": "write",
  "fanqie.bible.audit": "read",
  "fanqie.reference.bind": "write",
  "toutiao.articles": "read",
  "toutiao.article.create": "write",
  "toutiao.article.transition": "write",
  "toutiao.article.deliver": "write",
  "toutiao.article.export": "read",
  "toutiao.draft.save": "write",
  "toutiao.source.register": "write",
  "toutiao.ledger.show": "read",
  "toutiao.ledger.add": "write",
  "toutiao.ledger.status": "write",
  "toutiao.metrics.import": "write",
  "profiles.list": "read",
  "profiles.detail": "read",
  "profiles.method": "read",
  "profiles.use": "write",
  "profiles.create": "write",
  "profiles.save": "write",
  "profiles.reset": "write",
  "profiles.rename": "write",
  "profiles.delete": "write",
  "library.import": "write",
  "library.list": "read",
  "library.cards": "read",
  "library.dissect": "write",
};

function isErrorReceipt(value: unknown): value is ErrorReceipt {
  return (
    typeof value === "object" &&
    value !== null &&
    !Array.isArray(value) &&
    (value as Record<string, unknown>).ok === false
  );
}

async function callCommand<K extends WorkbenchCommand>(
  bridge: DesktopBridge,
  command: K,
  input: CommandInput<K>,
  { signal }: RequestOptions = {},
): Promise<CommandResult<K>> {
  const kind = COMMAND_ACCESS[command];
  if (signal?.aborted) throw new ApiError("aborted", { code: "aborted" });
  const result = await bridge.request(command, { kind, input });
  if (signal?.aborted) {
    throw new ApiError("aborted", { code: "aborted", uncertain: kind === "write" });
  }
  if (isErrorReceipt(result.data)) {
    const message =
      typeof result.data.error === "string" && result.data.error
        ? result.data.error
        : typeof result.data.message === "string" && result.data.message
          ? result.data.message
          : "操作失败";
    throw new ApiError(message, {
      uncertain: result.data.uncertain === true,
      code: typeof result.data.code === "string" ? result.data.code : "",
    });
  }
  return result.data;
}

function fanqie(bridge: DesktopBridge): FanqieData {
  return {
    snapshot: (input, options) => callCommand(bridge, "fanqie.snapshot", input, options),
    chapter: (input, options) => callCommand(bridge, "fanqie.chapter.get", input, options),
    saveChapter: (input, options) => callCommand(bridge, "fanqie.chapter.save", input, options),
    finalizeChapter: (input, options) =>
      callCommand(bridge, "fanqie.chapter.finalize", input, options),
    acceptCandidate: (input, options) =>
      callCommand(bridge, "fanqie.candidate.accept", input, options),
    createWork: (input, options) => callCommand(bridge, "fanqie.work.create", input, options),
    exportBook: (input, options) => callCommand(bridge, "fanqie.book.export", input, options),
  };
}

function toutiao(bridge: DesktopBridge): ToutiaoData {
  return {
    articles: (input, options) => callCommand(bridge, "toutiao.articles", input, options),
    createArticle: (input, options) =>
      callCommand(bridge, "toutiao.article.create", input, options),
    transitionArticle: (input, options) =>
      callCommand(bridge, "toutiao.article.transition", input, options),
    deliverArticle: (input, options) =>
      callCommand(bridge, "toutiao.article.deliver", input, options),
  };
}

export function createDesktopAdapter(bridge: DesktopBridge): WorkbenchData {
  return {
    call: (command, input, options) => callCommand(bridge, command, input, options),
    fanqie: fanqie(bridge),
    toutiao: toutiao(bridge),
  };
}
