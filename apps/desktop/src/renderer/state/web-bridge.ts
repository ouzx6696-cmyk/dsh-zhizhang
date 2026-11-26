/**
 * Web 预览传输桥（DesktopBridge 的浏览器实现）：
 * 当 Electron preload（window.zhizhangBridge）不存在时，通过 HTTP RPC + SSE 连接同源 Node 服务。
 * 令牌仅保存在模块内存中，绝不写入 localStorage / sessionStorage。
 */
import type { DesktopEvent } from "../../shared/events.js";
import type { DesktopBridge, IpcArgs, IpcChannel, IpcResult, Reply } from "../../shared/ipc.js";
import type { OpenedText } from "../../shared/views.js";

const LONG_CHANNELS = new Set<IpcChannel>(["workbench.call", "models.test", "backup.start"]);

let authToken = "";

export function withWebAuthUrl(url: string): string {
  if (!authToken) return url;
  const sep = url.includes("?") ? "&" : "?";
  return `${url}${sep}token=${encodeURIComponent(authToken)}`;
}

export function triggerWebDownload(url: string, fileName?: string): void {
  const link = document.createElement("a");
  link.href = withWebAuthUrl(url);
  if (fileName) link.download = fileName;
  link.rel = "noopener";
  document.body.appendChild(link);
  link.click();
  link.remove();
}

function authHeaders(extra?: Record<string, string>): Record<string, string> {
  return {
    "X-Requested-With": "zhizhang",
    ...(authToken ? { Authorization: `Bearer ${authToken}` } : {}),
    ...extra,
  };
}

export async function checkWebAuthStatus(): Promise<{
  required: boolean;
  authenticated: boolean;
}> {
  const res = await fetch("/api/auth/status", { headers: authHeaders() });
  if (!res.ok) return { required: false, authenticated: true };
  const parsed: unknown = await res.json();
  if (typeof parsed !== "object" || parsed === null) {
    return { required: false, authenticated: true };
  }
  return {
    required: Reflect.get(parsed, "required") === true,
    authenticated: Reflect.get(parsed, "authenticated") === true,
  };
}

export async function loginWebPasscode(
  passcode: string,
): Promise<{ ok: true } | { ok: false; message: string }> {
  const res = await fetch("/api/auth/login", {
    method: "POST",
    headers: authHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({ passcode }),
  });
  const body: unknown = await res.json().catch(() => null);
  if (res.ok && typeof body === "object" && body !== null && Reflect.get(body, "ok") === true) {
    const token = Reflect.get(body, "token");
    authToken = typeof token === "string" ? token : "";
    return { ok: true };
  }
  const errObj = typeof body === "object" && body !== null ? Reflect.get(body, "error") : null;
  const msg =
    typeof errObj === "object" &&
    errObj !== null &&
    typeof Reflect.get(errObj, "message") === "string"
      ? String(Reflect.get(errObj, "message"))
      : "";
  return { ok: false, message: msg };
}

function decodeFileBytes(bytes: Uint8Array): { content: string; encoding: OpenedText["encoding"] } {
  try {
    return {
      content: new TextDecoder("utf-8", { fatal: true }).decode(bytes).replace(/^\uFEFF/, ""),
      encoding: "utf-8",
    };
  } catch {
    return { content: new TextDecoder("gbk").decode(bytes), encoding: "gbk" };
  }
}

function pickBrowserTextFile(options: { extensions?: string[] }): Promise<OpenedText | null> {
  return new Promise((resolve) => {
    const input = document.createElement("input");
    input.type = "file";
    const exts = options.extensions ?? ["txt", "md"];
    input.accept = exts.map((ext) => (ext.startsWith(".") ? ext : `.${ext}`)).join(",");
    let settled = false;
    const finish = (value: OpenedText | null) => {
      if (settled) return;
      settled = true;
      resolve(value);
    };
    input.addEventListener("change", () => {
      const file = input.files?.[0];
      if (!file) {
        finish(null);
        return;
      }
      file
        .arrayBuffer()
        .then((buf) => {
          const decoded = decodeFileBytes(new Uint8Array(buf));
          finish({ path: file.name, name: file.name, ...decoded });
        })
        .catch(() => finish(null));
    });
    input.addEventListener("cancel", () => finish(null));
    input.click();
  });
}

let cachedBridge: DesktopBridge | undefined;

export function getWebDesktopBridge(): DesktopBridge {
  if (cachedBridge) return cachedBridge;

  const listeners = new Set<(event: DesktopEvent) => void>();
  let source: EventSource | null = null;
  let wasDisconnected = false;

  function ensureStream(): void {
    if (source || typeof EventSource === "undefined") return;
    source = new EventSource(withWebAuthUrl("/api/events"));
    source.onopen = () => {
      if (!wasDisconnected) return;
      wasDisconnected = false;
      void fetch("/api/rpc/workspace.status", {
        method: "POST",
        headers: authHeaders({ "Content-Type": "application/json" }),
        body: JSON.stringify({ args: [] }),
      })
        .then((res) => (res.ok ? res.json() : null))
        .then((reply: unknown) => {
          if (
            typeof reply === "object" &&
            reply !== null &&
            Reflect.get(reply, "ok") === true &&
            Reflect.get(reply, "value")
          ) {
            const event: DesktopEvent = {
              kind: "workspace.status",
              status: Reflect.get(reply, "value") as Extract<
                DesktopEvent,
                { kind: "workspace.status" }
              >["status"],
            };
            for (const fn of listeners) fn(event);
          }
        })
        .catch(() => undefined);
    };
    source.onerror = () => {
      wasDisconnected = true;
    };
    source.onmessage = (msg) => {
      try {
        const parsed = JSON.parse(msg.data) as DesktopEvent;
        for (const fn of listeners) fn(parsed);
      } catch {
        // 忽略格式不合法的事件帧
      }
    };
  }

  function closeStreamIfIdle(): void {
    if (listeners.size === 0 && source) {
      source.close();
      source = null;
      wasDisconnected = false;
    }
  }

  cachedBridge = {
    async invoke<K extends IpcChannel>(
      channel: K,
      ...args: IpcArgs<K>
    ): Promise<Reply<IpcResult<K>>> {
      if (channel === "dialog.openText") {
        const options = (args[0] ?? {}) as { title?: string; extensions?: string[] };
        const value = await pickBrowserTextFile(options);
        return { ok: true, value: value as IpcResult<K> };
      }
      try {
        const timeoutMs = LONG_CHANNELS.has(channel) ? 300_000 : 60_000;
        const res = await fetch(`/api/rpc/${encodeURIComponent(channel)}`, {
          method: "POST",
          headers: authHeaders({ "Content-Type": "application/json" }),
          body: JSON.stringify({ args }),
          signal: AbortSignal.timeout(timeoutMs),
        });
        const body = (await res.json()) as Reply<IpcResult<K>>;
        if (!res.ok && body && body.ok !== false) {
          return {
            ok: false,
            error: { code: "network.proxy", message: `本地服务返回 HTTP ${res.status}` },
          };
        }
        return body;
      } catch (err) {
        return {
          ok: false,
          error: {
            code: "network.proxy",
            message: err instanceof Error ? err.message : "无法连接到本地服务",
          },
        };
      }
    },

    subscribe(callback: (event: DesktopEvent) => void): () => void {
      listeners.add(callback);
      ensureStream();
      return () => {
        listeners.delete(callback);
        closeStreamIfIdle();
      };
    },
  };

  return cachedBridge;
}
