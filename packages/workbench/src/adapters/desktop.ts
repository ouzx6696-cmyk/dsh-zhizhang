import { ROUTES } from "../routes.js";
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
  { method = "GET", query, body, signal }: RequestOptions = {},
): Promise<Json> {
  if (signal?.aborted) throw new ApiError("aborted", { code: "aborted" });
  const result = await bridge.request(path, { method, query, body });
  if (signal?.aborted) throw new ApiError("aborted", { code: "aborted" });
  const data = isJsonObject(result.data) ? result.data : {};
  const message =
    typeof data.error === "string" && data.error
      ? data.error
      : typeof data.message === "string" && data.message
        ? data.message
        : "操作失败";
  if (result.status >= 400 || data.ok === false)
    throw new ApiError(message, {
      status: result.status,
      code: typeof data.code === "string" ? data.code : undefined,
    });
  return result.data;
}

function fanqie(bridge: DesktopBridge): FanqieData {
  return {
    projects: (refresh, signal) =>
      call(bridge, ROUTES.projects, { query: { refresh: refresh ? 1 : "" }, signal }),
    snapshot: (base, work, signal, scope = "all") =>
      call(bridge, ROUTES.snapshot, { query: { base, work, scope }, signal }),
    chapter: (base, work, id, signal) =>
      call(bridge, ROUTES.chapter, { query: { base, work, id }, signal }),
    saveChapter: (payload) => call(bridge, ROUTES.saveChapter, { method: "POST", body: payload }),
    candidate: (base, work, id, signal) =>
      call(bridge, ROUTES.candidate, { query: { base, work, id }, signal }),
    diagnose: (payload, signal) =>
      call(bridge, ROUTES.diagnose, { method: "POST", body: payload, signal }),
    stageRevision: (payload) =>
      call(bridge, ROUTES.stageRevision, { method: "POST", body: payload }),
    accept: (payload) => call(bridge, ROUTES.accept, { method: "POST", body: payload }),
    chapterAction: (action, payload) =>
      call(
        bridge,
        action === "acknowledge"
          ? ROUTES.acknowledge
          : action === "review"
            ? ROUTES.reviewChapter
            : ROUTES.finalizeChapter,
        {
          method: "POST",
          body: payload,
        },
      ),
    unifyPrepare: (payload) => call(bridge, ROUTES.unifyPrepare, { method: "POST", body: payload }),
    capabilities: (base, signal) => call(bridge, ROUTES.capabilities, { query: { base }, signal }),
    deliver: (payload) => call(bridge, ROUTES.deliver, { method: "POST", body: payload }),
  };
}

function toutiao(bridge: DesktopBridge): ToutiaoData {
  return {
    articles: (signal) => call(bridge, ROUTES.articles, { signal }),
    article: (root, id, signal) => call(bridge, ROUTES.article, { query: { root, id }, signal }),
    adopt: (article) =>
      call(bridge, ROUTES.adoptArticle, {
        method: "POST",
        body: {
          root: article.root,
          id: article.id,
          expectedRev: article.rev,
          expectedSha256: article.draft.sha256,
          confirm: true,
        },
      }),
    saveDraft: (payload) => call(bridge, ROUTES.saveArticle, { method: "POST", body: payload }),
    deliver: (payload) =>
      call(bridge, ROUTES.deliverArticle, { method: "POST", body: { ...payload, confirm: true } }),
  };
}

function profiles(bridge: DesktopBridge, mode: string): ProfilesData {
  const base = "/" + mode + "/profiles";
  return {
    list: (signal) => call(bridge, base, { signal }),
    detail: (profile, signal) => call(bridge, base + "/detail", { query: { profile }, signal }),
    method: (profile, id, signal) =>
      call(bridge, base + "/method", { query: { profile, id }, signal }),
    use: (profile) => call(bridge, base + "/use", { method: "POST", body: { profile } }),
    create: (payload) => call(bridge, base + "/create", { method: "POST", body: payload }),
    save: (profile, id, text) =>
      call(bridge, base + "/save", { method: "POST", body: { profile, id, text } }),
    reset: (profile, id) =>
      call(bridge, base + "/reset", { method: "POST", body: { profile, id } }),
    rename: (profile, name, note) =>
      call(bridge, base + "/rename", { method: "POST", body: { profile, name, note } }),
    remove: (profile) =>
      call(bridge, base + "/delete", { method: "POST", body: { profile, confirm: true } }),
  };
}

export function createDesktopAdapter(bridge: DesktopBridge): WorkbenchData {
  return {
    fanqie: fanqie(bridge),
    toutiao: toutiao(bridge),
    profiles: (mode) => profiles(bridge, mode),
  };
}
