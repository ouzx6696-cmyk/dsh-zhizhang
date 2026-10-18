#!/usr/bin/env node
/**
 * Copy (or optionally esbuild) the ModuleLoader client into dist/client.js.
 * --check: verify source exists and parses as JS (Function constructor smoke).
 */
import { mkdir, readFile, writeFile, copyFile, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const src = path.join(root, "src", "client", "client.js");
const out = path.join(root, "dist", "client.js");
const checkOnly = process.argv.includes("--check");

async function main() {
  await access(src);
  const code = await readFile(src, "utf8");
  if (!code.includes("window.__ModuleLoader__.load")) {
    throw new Error("client.js missing ModuleLoader wrapper");
  }
  if (!code.includes("sidebar.panellist") || !code.includes("ctx.slots.inject")) {
    throw new Error("client.js missing official seat registration");
  }
  if (code.includes("ctx.inject([")) {
    throw new Error("client.js must not use ctx.inject([...]) for seats (use ctx.slots.inject)");
  }
  // Syntax smoke: strip ModuleLoader shell and ensure factory body is parseable enough
  // by checking balanced braces roughly + Function on a stub.
  new Function("window", code.replace(/window\.__ModuleLoader__\.load/, "void"));

  if (checkOnly) {
    console.log("build-client: check ok", src);
    return;
  }
  await mkdir(path.dirname(out), { recursive: true });
  await copyFile(src, out);
  // Ensure package can resolve ./client
  const written = await readFile(out, "utf8");
  if (written.length < 100) throw new Error("dist/client.js too small");
  console.log("build-client: wrote", out, "(" + written.length + " bytes)");
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
