/** Check the original Zhizhang delivery, then exercise backup with only the OS picker mocked in a debug copy. */
import { chromium, _electron as electron } from "@playwright/test";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { getCurrentFuseWire, flipFuses, FuseVersion, FuseV1Options } from "@electron/fuses";
import { mkdtemp, readFile, rm, mkdir, writeFile, copyFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const home = await mkdtemp(path.join(tmpdir(), "zhizhang-package-smoke-"));
const executable = path.join(root, "apps/desktop/release/win-unpacked/Zhizhang.exe");
const fuses = await getCurrentFuseWire(executable);
// The fuse wire stores ASCII '0' for disabled and '1' for enabled.
if (
  fuses[FuseV1Options.RunAsNode] !== 0x30 ||
  fuses[FuseV1Options.EnableNodeOptionsEnvironmentVariable] !== 0x30 ||
  fuses[FuseV1Options.EnableNodeCliInspectArguments] !== 0x30 ||
  fuses[FuseV1Options.OnlyLoadAppFromAsar] !== 0x31
)
  throw new Error("交付客户端 Fuse 不正确");
const child = spawn(executable, ["--remote-debugging-port=0", `--user-data-dir=${home}`]);
let browser;
let output = "";
const debugExecutable = path.join(path.dirname(executable), "Zhizhang-backup-smoke.exe");
let backupApp;
async function hash(file) {
  const digest = createHash("sha256");
  for await (const chunk of createReadStream(file)) digest.update(chunk);
  return digest.digest("hex");
}
const originalHash = await hash(executable);
async function stopOriginal() {
  if (child.exitCode !== null || child.signalCode !== null) return;
  const exited = new Promise((resolve) => child.once("exit", resolve));
  child.kill("SIGKILL");
  await exited;
}
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
  await page.locator(".zz-desktop").waitFor({ timeout: 30000 });
  const settingsReply = await page.evaluate(() => window.zhizhangBridge.invoke("settings.get"));
  const url = new URL(page.url());
  if (
    url.protocol !== "file:" ||
    !decodeURIComponent(url.pathname).endsWith("/resources/app.asar/out/renderer/index.html") ||
    !settingsReply?.ok
  )
    throw new Error("交付客户端的打包页面或 IPC 桥接不正确");
  const source = path.join(home, "source"),
    destination = path.join(home, "backups"),
    backupHome = path.join(home, "backup-app");
  await mkdir(source);
  await mkdir(destination);
  await mkdir(backupHome);
  await writeFile(path.join(source, "作者正文.md"), "正式包备份校验。\n");
  await browser.close();
  browser = undefined;
  await stopOriginal();
  // The shipped executable is never patched. Only this disposable copy exposes the main-process
  // test connection, while RunAsNode and every other production fuse retain their shipped values.
  await copyFile(executable, debugExecutable);
  await flipFuses(debugExecutable, {
    version: FuseVersion.V1,
    [FuseV1Options.EnableNodeCliInspectArguments]: true,
  });
  const debugFuses = await getCurrentFuseWire(debugExecutable);
  for (const [key, value] of Object.entries(fuses))
    if (key !== String(FuseV1Options.EnableNodeCliInspectArguments) && debugFuses[key] !== value)
      throw new Error("备份测试副本改变了其他生产 Fuse");
  backupApp = await electron.launch({
    executablePath: debugExecutable,
    args: [`--user-data-dir=${backupHome}`],
    timeout: 30000,
  });
  const backupPage = await backupApp.firstWindow();
  await backupPage.locator(".zz-desktop").waitFor({ timeout: 30000 });
  await backupApp.close();
  backupApp = undefined;
  if ((await hash(executable)) !== originalHash) throw new Error("原始交付客户端发生变化");
  console.log(
    `Windows original Zhizhang package startup/fuses OK; debug copy (RunAsNode disabled) OK: ${version}`,
  );
} catch (error) {
  console.error(output);
  throw error;
} finally {
  await backupApp?.close();
  await browser?.close();
  await stopOriginal();
  await rm(debugExecutable, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
