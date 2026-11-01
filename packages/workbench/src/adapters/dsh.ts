import {
  ApiError,
  type FanqieData,
  type Json,
  type ProfilesData,
  type RequestOptions,
  type ToutiaoData,
  type WorkbenchData,
} from "./types.js";

const API_ROUTE = "api/writer";
export const TOKEN_KEY = "writer.panelToken";

export function readToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

export function writeToken(value: string) {
  try {
    if (value) window.sessionStorage.setItem(TOKEN_KEY, value);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the token simply is not remembered */
  }
}

function routeUrl(path: string, query?: Record<string, unknown>) {
  const base =
    typeof document !== "undefined" && document.baseURI ? document.baseURI : "http://localhost/";
  const url = new URL(API_ROUTE + path, base);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.href;
}

export async function request(
  path: string,
  { method = "GET", query, body, timeoutMs = 10000, signal }: RequestOptions = {},
): Promise<Json> {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const headers: Record<string, string> = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = readToken();
  if (token) headers["x-writer-token"] = token;
  try {
    const response = await fetch(routeUrl(path, query), {
      method,
      headers,
      body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal,
      credentials: "same-origin",
    });
    let data: Json;
    try {
      data = await response.json();
    } catch (err) {
      if (ctrl.signal.aborted) throw err;
      throw new ApiError("HTTP " + response.status + "（非 JSON 响应）", {
        status: response.status,
        code: "bad_response",
      });
    }
    if (ctrl.signal.aborted) throw new Error("aborted");
    if (!response.ok || !data || data.ok === false) {
      const code =
        data?.code ||
        (response.status === 403 ? "forbidden" : response.status === 429 ? "rate_limited" : "");
      throw new ApiError(data?.error || "HTTP " + response.status, {
        status: response.status,
        code,
      });
    }
    return data;
  } catch (err) {
    if (ctrl.signal.aborted) {
      const external = signal?.aborted;
      throw new ApiError(external ? "aborted" : "请求超时", {
        code: external ? "aborted" : "timeout",
      });
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError((err as Error)?.message || "网络错误", { code: "network" });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

function fanqie(): FanqieData {
  return {
    projects: (refresh, signal) =>
      request("/projects", { query: { refresh: refresh ? 1 : "" }, timeoutMs: 8000, signal }),
    snapshot: (base, work, signal, scope = "all") =>
      request("/snapshot", { query: { base, work, scope }, timeoutMs: 10000, signal }),
    chapter: (base, work, id, signal) =>
      request("/chapter", { query: { base, work, id }, timeoutMs: 15000, signal }),
    saveChapter: (payload) =>
      request("/chapter/save", { method: "POST", body: payload, timeoutMs: 20000 }),
    candidate: (base, work, id, signal) =>
      request("/candidate", { query: { base, work, id }, timeoutMs: 15000, signal }),
    diagnose: (payload, signal) =>
      request("/diagnostics/scan", { method: "POST", body: payload, signal, timeoutMs: 20000 }),
    stageRevision: (payload) =>
      request("/diagnostics/stage", { method: "POST", body: payload, timeoutMs: 20000 }),
    accept: (payload) =>
      request("/candidate/accept", { method: "POST", body: payload, timeoutMs: 20000 }),
    chapterAction: (action, payload) =>
      request(action === "acknowledge" ? "/revision/acknowledge" : "/chapter/" + action, {
        method: "POST",
        body: payload,
        timeoutMs: 15000,
      }),
    unifyPrepare: (payload) =>
      request("/unify/prepare", { method: "POST", body: payload, timeoutMs: 15000 }),
    capabilities: (base, signal) =>
      request("/diagnostics/capabilities", { query: { base }, timeoutMs: 8000, signal }),
    deliver: (payload) =>
      request("/agent/deliver", { method: "POST", body: payload, timeoutMs: 20000 }),
  };
}

function toutiao(): ToutiaoData {
  return {
    articles: (signal) => request("/toutiao/articles", { timeoutMs: 10000, signal }),
    article: (root, id, signal) =>
      request("/toutiao/article", { query: { root, id }, timeoutMs: 10000, signal }),
    adopt: (article) =>
      request("/toutiao/adopt", {
        method: "POST",
        body: {
          root: article.root,
          id: article.id,
          expectedRev: article.rev,
          expectedSha256: article.draft.sha256,
          confirm: true,
        },
        timeoutMs: 15000,
      }),
    saveDraft: (payload) =>
      request("/toutiao/draft", { method: "POST", body: payload, timeoutMs: 20000 }),
    deliver: (payload) =>
      request("/toutiao/deliver", {
        method: "POST",
        body: { ...payload, confirm: true },
        timeoutMs: 20000,
      }),
  };
}

function profiles(mode: string): ProfilesData {
  const base = "/" + mode + "/profiles";
  return {
    list: (signal) => request(base, { timeoutMs: 10000, signal }),
    detail: (profile, signal) =>
      request(base + "/detail", { query: { profile }, timeoutMs: 10000, signal }),
    method: (profile, id, signal) =>
      request(base + "/method", { query: { profile, id }, timeoutMs: 10000, signal }),
    use: (profile) => request(base + "/use", { method: "POST", body: { profile }, timeoutMs: 10000 }),
    create: (payload) =>
      request(base + "/create", { method: "POST", body: payload, timeoutMs: 30000 }),
    save: (profile, id, text) =>
      request(base + "/save", { method: "POST", body: { profile, id, text }, timeoutMs: 15000 }),
    reset: (profile, id) =>
      request(base + "/reset", { method: "POST", body: { profile, id }, timeoutMs: 10000 }),
    rename: (profile, name, note) =>
      request(base + "/rename", { method: "POST", body: { profile, name, note }, timeoutMs: 10000 }),
    remove: (profile) =>
      request(base + "/delete", { method: "POST", body: { profile, confirm: true }, timeoutMs: 10000 }),
  };
}

export function createDshAdapter(): WorkbenchData {
  return { host: "dsh", fanqie: fanqie(), toutiao: toutiao(), profiles };
}
