/**
 * Panel HTTP client. Routes resolve against `document.baseURI` (the DSH
 * application base), the same way first-party client packages reach Host
 * routes, so a mounted or proxied document still lands on the right path.
 * Every failure becomes an ApiError carrying the server's `code`.
 */
export const API_ROUTE = "api/dsh-zhizhang";
export const TOKEN_KEY = "zhizhang.panelToken";

export class ApiError extends Error {
  constructor(message, { status = 0, code = "" } = {}) {
    super(message);
    this.name = "ApiError";
    this.status = status;
    this.code = code;
  }
}

/** Read the per-session panel token; never throws (storage may be blocked). */
export function readToken() {
  try {
    return window.sessionStorage.getItem(TOKEN_KEY) || "";
  } catch {
    return "";
  }
}

/** Store or clear the per-session panel token. */
export function writeToken(value) {
  try {
    if (value) window.sessionStorage.setItem(TOKEN_KEY, value);
    else window.sessionStorage.removeItem(TOKEN_KEY);
  } catch {
    /* storage unavailable: the token simply is not remembered */
  }
}

/** Absolute URL for a panel route plus a query, skipping empty values. */
export function routeUrl(path, query) {
  const base = typeof document !== "undefined" && document.baseURI ? document.baseURI : "http://localhost/";
  const url = new URL(API_ROUTE + path, base);
  for (const [key, value] of Object.entries(query || {})) {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, String(value));
  }
  return url.href;
}

/**
 * Send one request. Resolves with the parsed body when the server reports
 * success; rejects with ApiError otherwise (including timeouts and aborts).
 */
export async function request(path, { method = "GET", query, body, timeoutMs = 10000, signal } = {}) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  if (signal) {
    if (signal.aborted) ctrl.abort();
    else signal.addEventListener("abort", onAbort, { once: true });
  }
  const timer = timeoutMs ? setTimeout(() => ctrl.abort(), timeoutMs) : null;
  const headers = { accept: "application/json" };
  if (body !== undefined) headers["content-type"] = "application/json";
  const token = readToken();
  if (token) headers["x-zhizhang-token"] = token;
  try {
    const response = await fetch(routeUrl(path, query), {
      method, headers, body: body === undefined ? undefined : JSON.stringify(body),
      signal: ctrl.signal, credentials: "same-origin",
    });
    let data;
    try { data = await response.json(); }
    catch (err) {
      if (ctrl.signal.aborted) throw err;
      throw new ApiError("HTTP " + response.status + "（非 JSON 响应）", { status: response.status, code: "bad_response" });
    }
    if (ctrl.signal.aborted) throw new Error("aborted");
    if (!response.ok || !data || data.ok === false) {
      const code = data?.code || (response.status === 403 ? "forbidden" : response.status === 429 ? "rate_limited" : "");
      throw new ApiError(data?.error || "HTTP " + response.status, { status: response.status, code });
    }
    return data;
  } catch (err) {
    if (ctrl.signal.aborted) {
      const external = signal?.aborted;
      throw new ApiError(external ? "aborted" : "请求超时", { code: external ? "aborted" : "timeout" });
    }
    if (err instanceof ApiError) throw err;
    throw new ApiError(err?.message || "网络错误", { code: "network" });
  } finally {
    if (timer) clearTimeout(timer);
    if (signal) signal.removeEventListener("abort", onAbort);
  }
}

/** Endpoint helpers; `base` is the selected project id (optional). */
export const api = {
  projects: (refresh, signal) => request("/projects", { query: { refresh: refresh ? 1 : "" }, timeoutMs: 8000, signal }),
  snapshot: (base, work, signal) => request("/snapshot", { query: { base, work }, timeoutMs: 10000, signal }),
  chapter: (base, work, id, signal) => request("/chapter", { query: { base, work, id }, timeoutMs: 15000, signal }),
  candidate: (base, work, id, signal) => request("/candidate", { query: { base, work, id }, timeoutMs: 15000, signal }),
  accept: (payload) => request("/candidate/accept", { method: "POST", body: payload, timeoutMs: 20000 }),
  chapterAction: (action, payload) =>
    request(action === "acknowledge" ? "/revision/acknowledge" : "/chapter/" + action, { method: "POST", body: payload, timeoutMs: 15000 }),
  unifyPrepare: (payload) => request("/unify/prepare", { method: "POST", body: payload, timeoutMs: 15000 }),
};
