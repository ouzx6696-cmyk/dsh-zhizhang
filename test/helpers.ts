/**
 * Shared fixtures for the lean suite — one storage, one work, one panel server.
 * Tests create what they need via these three; no per-file boilerplate.
 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createWork, ensureStorage, type StoragePaths } from "../src/lib/store.ts";
import type { PluginConfig } from "../src/lib/types.ts";

export const FIXTURES = path.join(import.meta.dirname, "fixtures");

export async function withStorage(prefix = "zhizhang-"): Promise<{
  base: string;
  paths: StoragePaths;
  cleanup: () => Promise<void>;
}> {
  const base = await mkdtemp(path.join(tmpdir(), prefix));
  const paths = await ensureStorage({}, { storageRoot: base });
  return { base, paths, cleanup: () => rm(base, { recursive: true, force: true }) };
}

export async function withWork(title = "测作品") {
  const ctx = await withStorage();
  const { meta, dir } = await createWork(ctx.paths, { title });
  return { ...ctx, meta, dir, key: meta.key, paths: ctx.paths, base: ctx.base, cleanup: ctx.cleanup };
}

/** Throw-assert helper: resolves with the error when its code matches. */
export async function expectReject(fn: () => Promise<unknown>, code?: string) {
  try {
    await fn();
  } catch (err) {
    const e = err as { code?: string };
    if (code && e.code !== code) {
      throw new Error(`期望错误码 ${code}，实际 ${(e as Error).message}`);
    }
    return err as Error;
  }
  throw new Error(`期望抛出 ${code ?? "错误"}，但没有抛`);
}

/** Ephemeral panel HTTP server bound to the given storage config. */
export async function servePanel(config: PluginConfig = {}) {
  const { createPanelApiHandler, ZZ_API_PREFIX } = await import("../src/lib/http-api.ts");
  const server = createServer(createPanelApiHandler(config));
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  const { port } = server.address() as { port: number };
  return {
    api: `http://127.0.0.1:${port}${ZZ_API_PREFIX}`,
    close: () => new Promise<void>((resolve, reject) => server.close((e) => (e ? reject(e) : resolve()))),
  };
}

export const jpost = (api: string, route: string, body: unknown) =>
  fetch(`${api}${route}`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify(body),
  });

/** Pad short samples so HumanFeel MIN_CHARS (120) / NovelSense (160) engage. */
export function padBody(s: string, times = 2): string {
  return s.repeat(times);
}
