/** Smoke the actual delivery without the Node inspector disabled by production fuses. */
import { chromium } from "@playwright/test";
import { spawn } from "node:child_process";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const home = await mkdtemp(path.join(tmpdir(), "writer-package-smoke-"));
const child = spawn(path.join(root, "apps/desktop/release/win-unpacked/WriterAgent.exe"), [
  "--remote-debugging-port=0",
  `--user-data-dir=${home}`,
]);
let browser;
let output = "";
try {
  const endpoint = await new Promise((resolve, reject) => {
    const timer = setTimeout(() => reject(new Error("交付客户端未开放窗口连接\n" + output)), 30000);
    child.once("error", (error) => {
      clearTimeout(timer);
      reject(error);
    });
    child.once("exit", (code, signal) => {
      clearTimeout(timer);
      reject(new Error(`交付客户端提前退出：${code}/${signal}\n${output}`));
    });
    for (const stream of [child.stdout, child.stderr])
      stream.on("data", (chunk) => {
        output = (output + chunk.toString()).slice(-12000);
        const match = /DevTools listening on (ws:\/\/127\.0\.0\.1:\d+\/\S+)/.exec(output);
        if (match) {
          clearTimeout(timer);
          resolve(match[1]);
        }
      });
  });
  browser = await chromium.connectOverCDP(endpoint);
  const context = browser.contexts()[0];
  const page = context.pages()[0] ?? (await context.waitForEvent("page", { timeout: 30000 }));
  await page.locator(".writer-desktop").waitFor({ timeout: 30000 });
  const state = await page.evaluate(() => window.writerDesktop.state());
  const url = new URL(page.url());
  if (
    url.protocol !== "file:" ||
    !decodeURIComponent(url.pathname).endsWith("/resources/app.asar/out/renderer/index.html") ||
    state.version !== version
  )
    throw new Error("交付客户端的版本或打包页面不正确");
  console.log(`Windows packaged startup OK: ${version}`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await browser?.close();
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
