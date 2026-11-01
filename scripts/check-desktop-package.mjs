/** Smoke the actual Windows delivery, whose dependencies differ from dev mode. */
import { _electron as electron } from "@playwright/test";
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
let app;
try {
  app = await electron.launch({
    executablePath: path.join(root, "apps/desktop/release/win-unpacked/WriterAgent.exe"),
    timeout: 30000,
  });
  const page = await app.firstWindow();
  await page.locator(".writer-desktop").waitFor({ timeout: 30000 });
  const state = await page.evaluate(() => window.writerDesktop.state());
  const packaged = await app.evaluate(({ app }) => app.isPackaged);
  if (!packaged || state.version !== version) throw new Error("交付客户端的版本或打包状态不正确");
  console.log(`Windows packaged startup OK: ${version}`);
} finally {
  await app?.close();
}
