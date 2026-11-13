import { COMMANDS } from "../commands.js";
import {
  ApiError,
  type DesktopBridge,
  type FanqieData,
  type Json,
  type ProfilesData,
  type RequestOptions,
  type ToutiaoData,
  type WorkbenchData,
} from "./types.js";

/** 回执对象判型；非对象回执按空对象处理，错误文案走默认值。 */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

async function call(
  bridge: DesktopBridge,
  path: string,
  { kind = "read", input, signal }: RequestOptions = {},
): Promise<Json> {
  if (signal?.aborted) throw new ApiError("aborted", { code: "aborted" });
  const result = await bridge.request(path, { kind, input });
  if (signal?.aborted)
    throw new ApiError("aborted", { code: "aborted", uncertain: kind === "write" });
  const data = isJsonObject(result.data) ? result.data : {};
  const message =
    typeof data.error === "string" && data.error
      ? data.error
      : typeof data.message === "string" && data.message
        ? data.message
        : "操作失败";
  if (data.ok === false)
    throw new ApiError(message, {
      uncertain: data.uncertain === true,
      code: typeof data.code === "string" ? data.code : undefined,
    });
  return result.data;
}

function fanqie(bridge: DesktopBridge): FanqieData {
  return {
    projects: (refresh, signal) =>
      call(bridge, COMMANDS.projects, { input: { refresh: refresh ? 1 : "" }, signal }),
    snapshot: (base, work, signal, scope = "all") =>
      call(bridge, COMMANDS.snapshot, { input: { base, work, scope }, signal }),
    chapter: (base, work, id, signal) =>
      call(bridge, COMMANDS.chapter, { input: { base, work, id }, signal }),
    saveChapter: (payload) => call(bridge, COMMANDS.saveChapter, { kind: "write", input: payload }),
    candidate: (base, work, id, signal) =>
      call(bridge, COMMANDS.candidate, { input: { base, work, id }, signal }),
    diagnose: (payload, signal) =>
      call(bridge, COMMANDS.diagnose, { kind: "write", input: payload, signal }),
    stageRevision: (payload) =>
      call(bridge, COMMANDS.stageRevision, { kind: "write", input: payload }),
    accept: (payload) => call(bridge, COMMANDS.accept, { kind: "write", input: payload }),
    chapterAction: (action, payload) =>
      call(
        bridge,
        action === "acknowledge"
          ? COMMANDS.acknowledge
          : action === "review"
            ? COMMANDS.reviewChapter
            : COMMANDS.finalizeChapter,
        {
          kind: "write",
          input: payload,
        },
      ),
    unifyPrepare: (payload) =>
      call(bridge, COMMANDS.unifyPrepare, { kind: "write", input: payload }),
    capabilities: (base, signal) =>
      call(bridge, COMMANDS.capabilities, { input: { base }, signal }),
    deliver: (payload) => call(bridge, COMMANDS.deliver, { kind: "write", input: payload }),
  };
}

function toutiao(bridge: DesktopBridge): ToutiaoData {
  return {
    articles: (signal) => call(bridge, COMMANDS.articles, { signal }),
    article: (root, id, signal) => call(bridge, COMMANDS.article, { input: { root, id }, signal }),
    adopt: (article) =>
      call(bridge, COMMANDS.adoptArticle, {
        kind: "write",
        input: {
          root: article.root,
          id: article.id,
          expectedRev: article.rev,
          expectedSha256: article.draft.sha256,
          confirm: true,
        },
      }),
    saveDraft: (payload) => call(bridge, COMMANDS.saveArticle, { kind: "write", input: payload }),
    deliver: (payload) =>
      call(bridge, COMMANDS.deliverArticle, {
        kind: "write",
        input: { ...payload, confirm: true },
      }),
  };
}

function profiles(bridge: DesktopBridge, mode: string): ProfilesData {
  const base = "/" + mode + "/profiles";
  return {
    list: (signal) => call(bridge, base, { signal }),
    detail: (profile, signal) => call(bridge, base + "/detail", { input: { profile }, signal }),
    method: (profile, id, signal) =>
      call(bridge, base + "/method", { input: { profile, id }, signal }),
    use: (profile) => call(bridge, base + "/use", { kind: "write", input: { profile } }),
    create: (payload) => call(bridge, base + "/create", { kind: "write", input: payload }),
    save: (profile, id, text) =>
      call(bridge, base + "/save", { kind: "write", input: { profile, id, text } }),
    reset: (profile, id) =>
      call(bridge, base + "/reset", { kind: "write", input: { profile, id } }),
    rename: (profile, name, note) =>
      call(bridge, base + "/rename", { kind: "write", input: { profile, name, note } }),
    remove: (profile) =>
      call(bridge, base + "/delete", { kind: "write", input: { profile, confirm: true } }),
  };
}

export function createDesktopAdapter(bridge: DesktopBridge): WorkbenchData {
  return {
    fanqie: fanqie(bridge),
    toutiao: toutiao(bridge),
    profiles: (mode) => profiles(bridge, mode),
  };
}
