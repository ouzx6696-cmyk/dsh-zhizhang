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

async function call(
  bridge: DesktopBridge,
  path: string,
  { method = "GET", query, body, signal }: RequestOptions = {},
): Promise<Json> {
  if (signal?.aborted) throw new ApiError("aborted", { code: "aborted" });
  const result = await bridge.request(path, { method, query, body });
  if (signal?.aborted) throw new ApiError("aborted", { code: "aborted" });
  if (result.status >= 400 || result.data?.ok === false)
    throw new ApiError(result.data?.error || result.data?.message || "操作失败", {
      status: result.status,
      code: result.data?.code,
    });
  return result.data;
}

function fanqie(bridge: DesktopBridge): FanqieData {
  return {
    projects: (refresh, signal) =>
      call(bridge, "/projects", { query: { refresh: refresh ? 1 : "" }, signal }),
    snapshot: (base, work, signal, scope = "all") =>
      call(bridge, "/snapshot", { query: { base, work, scope }, signal }),
    chapter: (base, work, id, signal) => call(bridge, "/chapter", { query: { base, work, id }, signal }),
    saveChapter: (payload) => call(bridge, "/chapter/save", { method: "POST", body: payload }),
    candidate: (base, work, id, signal) =>
      call(bridge, "/candidate", { query: { base, work, id }, signal }),
    diagnose: (payload, signal) =>
      call(bridge, "/diagnostics/scan", { method: "POST", body: payload, signal }),
    stageRevision: (payload) =>
      call(bridge, "/diagnostics/stage", { method: "POST", body: payload }),
    accept: (payload) => call(bridge, "/candidate/accept", { method: "POST", body: payload }),
    chapterAction: (action, payload) =>
      call(bridge, action === "acknowledge" ? "/revision/acknowledge" : "/chapter/" + action, {
        method: "POST",
        body: payload,
      }),
    unifyPrepare: (payload) => call(bridge, "/unify/prepare", { method: "POST", body: payload }),
    capabilities: (base, signal) =>
      call(bridge, "/diagnostics/capabilities", { query: { base }, signal }),
    deliver: (payload) => call(bridge, "/agent/deliver", { method: "POST", body: payload }),
  };
}

function toutiao(bridge: DesktopBridge): ToutiaoData {
  return {
    articles: (signal) => call(bridge, "/toutiao/articles", { signal }),
    article: (root, id, signal) =>
      call(bridge, "/toutiao/article", { query: { root, id }, signal }),
    adopt: (article) =>
      call(bridge, "/toutiao/adopt", {
        method: "POST",
        body: {
          root: article.root,
          id: article.id,
          expectedRev: article.rev,
          expectedSha256: article.draft.sha256,
          confirm: true,
        },
      }),
    saveDraft: (payload) => call(bridge, "/toutiao/draft", { method: "POST", body: payload }),
    deliver: (payload) =>
      call(bridge, "/toutiao/agent/deliver", { method: "POST", body: { ...payload, confirm: true } }),
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
    reset: (profile, id) => call(bridge, base + "/reset", { method: "POST", body: { profile, id } }),
    rename: (profile, name, note) =>
      call(bridge, base + "/rename", { method: "POST", body: { profile, name, note } }),
    remove: (profile) =>
      call(bridge, base + "/delete", { method: "POST", body: { profile, confirm: true } }),
  };
}

export function createDesktopAdapter(bridge: DesktopBridge): WorkbenchData {
  return {
    host: "desktop",
    fanqie: fanqie(bridge),
    toutiao: toutiao(bridge),
    profiles: (mode) => profiles(bridge, mode),
  };
}
