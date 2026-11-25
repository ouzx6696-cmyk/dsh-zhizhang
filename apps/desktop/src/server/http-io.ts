/**
 * Web 预览 HTTP 边界工具：同源校验、JSON 请求体限制、安全响应头、沙箱静态资源与导出下载、备份进程包装。
 */
import { spawn } from "node:child_process";
import fs from "node:fs/promises";
import type { IncomingMessage, ServerResponse } from "node:http";
import path from "node:path";
import { AppError } from "@zhizhang/core/errors";
import { resolveInsideAsync } from "@zhizhang/core/fs";

const MAX_BODY_BYTES = 25 * 1024 * 1024;

export const SECURITY_HEADERS: Record<string, string> = {
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

export function runNodeBackup(script: string, args: string[], signal: AbortSignal): Promise<void> {
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

export function isSameOriginRequest(req: IncomingMessage): boolean {
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

export async function readJsonBody(req: IncomingMessage): Promise<unknown> {
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

export function sendJson(res: ServerResponse, status: number, payload: unknown): void {
  const body = JSON.stringify(payload);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    "Content-Type": "application/json; charset=utf-8",
    "Cache-Control": "no-store",
  });
  res.end(body);
}

export async function serveStatic(
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

export async function serveExport(
  exportDir: string,
  rawName: string,
  res: ServerResponse,
): Promise<void> {
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
