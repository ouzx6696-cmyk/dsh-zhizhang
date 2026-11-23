/**
 * Web 预览服务器（Node HTTP + SSE）：
 * 复用 apps/desktop 的共享组合根（createAppRuntime）与传输无关 RPC 分发器（createRpcHandlers），
 * 在 0.0.0.0:3000 提供 /api/health、/api/rpc/:channel、/api/events、/api/exports/:file 与静态/开发前端资源。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import http, { type IncomingMessage, type ServerResponse } from "node:http";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { AppError, classify, serializeError } from "@zhizhang/core/errors";
import { resolveInsideAsync } from "@zhizhang/core/fs";
import { APP_VERSION } from "@zhizhang/core/version";
import type { DesktopEvent } from "../shared/events.js";
import type { Mode } from "../shared/views.js";
import { createAppRuntime } from "../main/app-runtime.js";
import { createRpcHandlers } from "../main/ipc/handlers.js";
import type { HostPlatform } from "../main/platform.js";
import type { SecretCipher } from "../main/services/config.js";
import { seedWebPreviewWorkspace } from "./seed.js";

const MAX_BODY_BYTES = 25 * 1024 * 1024;
const SECURITY_HEADERS: Record<string, string> = {
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "no-referrer",
};
const MIME_TYPES: Record<string, string> = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
  ".txt": "text/plain; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
  ".docx": "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
};

const noopCipher: SecretCipher = {
  available: () => false,
  encrypt: () => "",
  decrypt: () => "",
};

function runNodeBackup(script: string, args: string[], signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(new AppError("run.stopped", "备份已取消"));
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.execPath, [script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    const stop = () => child.kill();
    signal.addEventListener("abort", stop, { once: true });
    child.stderr.on("data", (chunk: Buffer) => {
      stderr = (stderr + chunk.toString("utf8")).slice(-32768);
    });
    child.once("error", (err) => {
      signal.removeEventListener("abort", stop);
      reject(new AppError("storage.io", err.message));
    });
    child.once("exit", (code) => {
      signal.removeEventListener("abort", stop);
      if (signal.aborted) reject(new AppError("run.stopped", "备份已取消"));
      else if (code !== 0)
        reject(new AppError("storage.io", stderr.trim() || `备份退出：${code ?? -1}`));
      else resolve();
    });
  });
}

function isSameOriginRequest(req: IncomingMessage): boolean {
  const origin = req.headers.origin;
  if (!origin) return true;
  let originHost: string;
  try {
    originHost = new URL(origin).host.toLowerCase();
  } catch {
    return false;
  }
  const forwarded = req.headers["x-forwarded-host"];
  const allowedHosts = new Set<string>();
  const rawHost = req.headers.host;
  if (typeof rawHost === "string" && rawHost.trim()) {
    allowedHosts.add(rawHost.trim().toLowerCase());
  }
  if (typeof forwarded === "string" && forwarded.trim()) {
    for (const part of forwarded.split(",")) {
      const h = part.trim().toLowerCase();
      if (h) allowedHosts.add(h);
    }
  }
  return allowedHosts.has(originHost);
}

async function readJsonBody(req: IncomingMessage): Promise<unknown> {
  const contentType = req.headers["content-type"] ?? "";
  if (contentType && !contentType.toLowerCase().includes("application/json")) {
    throw new AppError("ipc.invalid_args", "RPC 请求须使用 application/json");
  }
  const chunks: Buffer[] = [];
  let total = 0;
  for await (const chunk of req) {
    const buf = typeof chunk === "string" ? Buffer.from(chunk) : (chunk as Buffer);
    total += buf.length;
    if (total > MAX_BODY_BYTES) {
      throw new AppError("input.invalid", "请求体过大", { maxBytes: MAX_BODY_BYTES });
    }
    chunks.push(buf);
  }
  const text = Buffer.concat(chunks).toString("utf8").trim();
  if (!text) return {};
  try {
    return JSON.parse(text);
  } catch {
    throw new AppError("ipc.invalid_args", "RPC 请求体不是合法 JSON");
  }
}

function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

async function serveStatic(
  staticDir: string,
  pathname: string,
  res: ServerResponse,
): Promise<void> {
  let decoded = pathname;
  try {
    decoded = decodeURIComponent(pathname);
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const fallbackIndex = path.join(staticDir, "index.html");
  let filePath = fallbackIndex;
  try {
    const candidate = await resolveInsideAsync(staticDir, rel);
    const stat = await fs.stat(candidate).catch(() => undefined);
    if (stat?.isFile()) filePath = candidate;
  } catch {
    filePath = fallbackIndex;
  }
  const data = await fs.readFile(filePath).catch(() => undefined);
  if (!data) {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  const ext = path.extname(filePath).toLowerCase();
  const isHashedAsset =
    filePath !== fallbackIndex &&
    (rel.startsWith("assets/") || /\.[a-f0-9]{8,}\./i.test(path.basename(filePath)));
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
    "Cache-Control": isHashedAsset ? "public, max-age=31536000, immutable" : "no-cache",
  });
  res.end(data);
}

async function serveExport(exportDir: string, rawName: string, res: ServerResponse): Promise<void> {
  let name: string;
  try {
    name = decodeURIComponent(rawName);
  } catch {
    res.writeHead(400, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }
  if (!name || name.includes("/") || name.includes("\\")) {
    res.writeHead(400, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Bad Request");
    return;
  }
  let target: string;
  try {
    target = await resolveInsideAsync(exportDir, name);
  } catch {
    res.writeHead(403, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Forbidden");
    return;
  }
  const data = await fs.readFile(target).catch(() => undefined);
  if (!data) {
    res.writeHead(404, { ...SECURITY_HEADERS, "Content-Type": "text/plain; charset=utf-8" });
    res.end("Not Found");
    return;
  }
  const ext = path.extname(target).toLowerCase();
  const safeFile = path.basename(target).replace(/["\r\n]/g, "_");
  res.writeHead(200, {
    ...SECURITY_HEADERS,
    "Content-Type": MIME_TYPES[ext] ?? "application/octet-stream",
    "Content-Disposition": `attachment; filename*=UTF-8''${encodeURIComponent(safeFile)}`,
    "Cache-Control": "no-store",
  });
  res.end(data);
}

export interface WebPreviewOptions {
  host?: string;
  port?: number;
  repoRoot?: string;
  stateRoot?: string;
  workspaceRoot?: string;
  staticDir?: string;
  middleware?: (req: IncomingMessage, res: ServerResponse, next: () => void) => void;
}

export async function startWebPreviewServer(opts: WebPreviewOptions = {}) {
  const here = path.dirname(fileURLToPath(import.meta.url));
  const repoRoot = opts.repoRoot ?? path.resolve(here, "../../../..");
  const cacheRoot = path.join(repoRoot, ".cache", "web-preview");
  const stateRoot = opts.stateRoot ?? path.join(cacheRoot, "state");
  const workspaceRoot = opts.workspaceRoot ?? path.join(cacheRoot, "workspace");
  const exportDir = path.join(stateRoot, "exports");
  const staticDir = opts.staticDir ?? path.join(repoRoot, "apps", "desktop", "out", "web");

  const sseClients = new Set<ServerResponse>();
  const safeWriteSse = (client: ServerResponse, chunk: string) => {
    if (client.writableEnded || client.destroyed) {
      sseClients.delete(client);
      return;
    }
    try {
      client.write(chunk);
    } catch {
      sseClients.delete(client);
    }
  };
  const emit = (event: DesktopEvent) => {
    const frame = `data: ${JSON.stringify(event)}\n\n`;
    for (const client of sseClients) {
      safeWriteSse(client, frame);
    }
  };

  const hostPlatform: HostPlatform = {
    kind: "web",
    packaged: false,
    platform: process.platform,
    cipher: noopCipher,
    async pickDirectory() {
      return workspaceRoot;
    },
    async pickSave(defaultName, extension) {
      await fs.mkdir(exportDir, { recursive: true });
      const safe = defaultName.replace(/[\\/:*?"<>|]/g, "_") || "export";
      return path.join(exportDir, `${safe}.${extension}`);
    },
    async openTextFile() {
      return null;
    },
    copyText() {
      // 浏览器端剪贴板由前端处理
    },
    async openExternal() {
      // Web 预览禁止服务端拉起本机浏览器
    },
    async openPath() {
      // Web 预览不打开宿主机文件管理器
    },
    runBackup: runNodeBackup,
  };

  const toutiaoScriptsDir = path.join(repoRoot, "packages", "toutiao", "skill", "scripts");
  const toutiaoProfileDir = path.join(repoRoot, "packages", "toutiao", "profiles", "default");
  const backupScriptPath = path.join(repoRoot, "scripts", "backup.mjs");

  const runtime = await createAppRuntime({
    stateRoot,
    builtinProfilesDir: (mode: Mode) => path.join(repoRoot, "packages", mode, "profiles"),
    toutiaoScriptsDir,
    toutiaoProfileDir,
    backupScriptPath,
    host: hostPlatform,
    emit,
    initialWorkspaceRoot: workspaceRoot,
  });

  await seedWebPreviewWorkspace({
    roots: runtime.services.workspace.status().roots,
    locks: runtime.services.commands.locks,
    clock: runtime.services.clock,
    scriptsDir: toutiaoScriptsDir,
  });

  const rpc = createRpcHandlers(runtime.services);

  const heartbeat = setInterval(() => {
    for (const client of sseClients) {
      safeWriteSse(client, ": ping\n\n");
    }
  }, 25_000);
  heartbeat.unref();

  const server = http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", "http://localhost");

    if (req.method === "GET" && url.pathname === "/api/health") {
      sendJson(res, 200, {
        ok: true,
        version: APP_VERSION,
        host: "web",
        workspace: runtime.services.workspace.status().root,
      });
      return;
    }

    if (req.method === "GET" && url.pathname.startsWith("/api/exports/")) {
      await serveExport(exportDir, url.pathname.slice("/api/exports/".length), res);
      return;
    }

    if (req.method === "GET" && url.pathname === "/api/events") {
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache, no-transform",
        Connection: "keep-alive",
      });
      sseClients.add(res);
      safeWriteSse(res, ": connected\n\n");
      if (runtime.startupNotice) {
        safeWriteSse(res, `data: ${JSON.stringify(runtime.startupNotice)}\n\n`);
      }
      req.on("close", () => sseClients.delete(res));
      res.on("error", () => sseClients.delete(res));
      return;
    }

    if (req.method === "POST" && url.pathname.startsWith("/api/rpc/")) {
      try {
        if (!isSameOriginRequest(req)) {
          sendJson(res, 403, {
            ok: false,
            error: { code: "gate.denied", message: "拒绝跨源 RPC 请求" },
          });
          return;
        }
        let channel: string;
        try {
          channel = decodeURIComponent(url.pathname.slice("/api/rpc/".length));
        } catch {
          throw new AppError("ipc.invalid_args", "RPC 通道编码无效");
        }
        if (!rpc.has(channel)) {
          throw new AppError("ipc.invalid_args", `未知 RPC 通道：${channel}`, { channel });
        }
        const parsed = await readJsonBody(req);
        const args =
          typeof parsed === "object" &&
          parsed !== null &&
          Array.isArray(Reflect.get(parsed, "args"))
            ? (Reflect.get(parsed, "args") as unknown[])
            : [];
        const reply = await rpc.invoke(channel, args);
        sendJson(res, 200, reply);
      } catch (err) {
        const serialized = serializeError(classify(err));
        sendJson(res, 200, {
          ok: false,
          error: {
            code: serialized.code,
            message: serialized.message,
            ...(serialized.data !== undefined ? { data: serialized.data } : {}),
          },
        });
      }
      return;
    }

    if (opts.middleware) {
      opts.middleware(req, res, () => {
        void serveStatic(staticDir, url.pathname, res);
      });
      return;
    }
    await serveStatic(staticDir, url.pathname, res);
  });

  const host = opts.host ?? process.env.HOST ?? "0.0.0.0";
  const port = opts.port ?? Number(process.env.PORT ?? 3000);

  await new Promise<void>((resolve, reject) => {
    server.once("error", reject);
    server.listen(port, host, () => resolve());
  });

  async function close(): Promise<void> {
    clearInterval(heartbeat);
    for (const client of sseClients) client.end();
    sseClients.clear();
    await new Promise<void>((resolve) => server.close(() => resolve()));
    await runtime.dispose();
  }

  return { server, host, port, close, runtime };
}

const isEntrypoint =
  process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href;

if (isEntrypoint) {
  startWebPreviewServer()
    .then(({ host, port }) => {
      console.log(`织章 Web 预览已就绪：http://${host}:${port}`);
    })
    .catch((err: unknown) => {
      console.error("织章 Web 预览启动失败：", err);
      process.exit(1);
    });
}
