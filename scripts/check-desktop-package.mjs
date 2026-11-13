/** Smoke the actual delivery without the Node inspector disabled by production fuses. */
import { chromium } from "@playwright/test";
import { spawn, execFile } from "node:child_process";
import { promisify } from "node:util";
import { getCurrentFuseWire, FuseV1Options } from "@electron/fuses";
import { mkdtemp, readFile, rm, mkdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const { version } = JSON.parse(await readFile(path.join(root, "package.json"), "utf8"));
const home = await mkdtemp(path.join(tmpdir(), "writer-package-smoke-"));
const executable = path.join(root, "apps/desktop/release/win-unpacked/WriterAgent.exe");
const fuses = await getCurrentFuseWire(executable);
// The fuse wire stores ASCII '0' for disabled and '1' for enabled.
if (fuses[FuseV1Options.RunAsNode] !== 0x30 || fuses[FuseV1Options.OnlyLoadAppFromAsar] !== 0x31)
  throw new Error("交付客户端 Fuse 不正确");
const child = spawn(executable, ["--remote-debugging-port=0", `--user-data-dir=${home}`]);
let browser;
let output = "";
async function chooseDirectory(page, action, title, directory) {
  console.log(`Packaged ${action}: selecting directory`);
  const script = `$ErrorActionPreference = 'Stop'
  Add-Type -AssemblyName UIAutomationClient
  Add-Type -AssemblyName UIAutomationTypes
  $root = [System.Windows.Automation.AutomationElement]::RootElement
  $condition = [System.Windows.Automation.AndCondition]::new(
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::NameProperty, $env:WRITER_DIALOG_TITLE),
    [System.Windows.Automation.PropertyCondition]::new([System.Windows.Automation.AutomationElement]::ControlTypeProperty, [System.Windows.Automation.ControlType]::Window))
  $dialog = $null
  for ($i=0; $i -lt 100; $i++) {
    $dialog = $root.FindFirst([System.Windows.Automation.TreeScope]::Descendants, $condition)
    if ($null -ne $dialog) { break }
    Start-Sleep -Milliseconds 100
  }
  if ($null -eq $dialog) { throw 'Native directory dialog not found' }
  $folder = $null
  $select = $null
  for ($i=0; $i -lt 100; $i++) {
    $controls = $dialog.FindAll([System.Windows.Automation.TreeScope]::Descendants, [System.Windows.Automation.Condition]::TrueCondition)
    $inputs = @($controls | Where-Object {
      $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Edit -and
      -not $_.Current.IsOffscreen -and $_.Current.IsEnabled -and
      $_.Current.Name -notmatch 'Search' -and $_.Current.AutomationId -notmatch 'Search' -and
      $_.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true
    })
    $select = $controls | Where-Object { $_.Current.ControlType -eq [System.Windows.Automation.ControlType]::Button -and $_.Current.AutomationId -eq '1' } | Select-Object -First 1
    if ($inputs.Count -eq 1 -and $null -ne $select) { $folder = $inputs[0]; break }
    Start-Sleep -Milliseconds 100
  }
  if ($null -eq $folder) {
    $details = $controls | ForEach-Object { @{ name=$_.Current.Name; id=$_.Current.AutomationId; type=$_.Current.ControlType.ProgrammaticName; offscreen=$_.Current.IsOffscreen; value=($_.GetCurrentPropertyValue([System.Windows.Automation.AutomationElement]::IsValuePatternAvailableProperty) -eq $true) } }
    throw ('Folder controls not ready: ' + ($details | ConvertTo-Json -Compress))
  }
  $folder.GetCurrentPattern([System.Windows.Automation.ValuePattern]::Pattern).SetValue($env:WRITER_DIALOG_DIRECTORY)
  $select.GetCurrentPattern([System.Windows.Automation.InvokePattern]::Pattern).Invoke()`;
  let timer;
  try {
    const [result] = await Promise.race([
      Promise.all([
        page.evaluate((operation) => window.writerDesktop[operation](), action),
        promisify(execFile)("powershell", ["-NoProfile", "-STA", "-Command", script], {
          env: { ...process.env, WRITER_DIALOG_TITLE: title, WRITER_DIALOG_DIRECTORY: directory },
          timeout: 25000,
        }),
      ]),
      new Promise((_, reject) => {
        timer = setTimeout(() => reject(new Error("目录选择或备份未完成")), 30000);
      }),
    ]);
    console.log(`Packaged ${action}: directory accepted`);
    return result;
  } finally {
    clearTimeout(timer);
  }
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
  await page.locator(".writer-desktop").waitFor({ timeout: 30000 });
  const state = await page.evaluate(() => window.writerDesktop.state());
  const url = new URL(page.url());
  if (
    url.protocol !== "file:" ||
    !decodeURIComponent(url.pathname).endsWith("/resources/app.asar/out/renderer/index.html") ||
    state.version !== version
  )
    throw new Error("交付客户端的版本或打包页面不正确");
  const source = path.join(home, "source"),
    destination = path.join(home, "backups");
  await mkdir(source);
  await mkdir(destination);
  await writeFile(path.join(source, "作者正文.md"), "正式包备份校验。\n");
  await chooseDirectory(page, "workspace", "选择统一写作根", source);
  const backup = await chooseDirectory(
    page,
    "backup",
    "选择备份保存位置（写作根以外）",
    destination,
  );
  const manifest = JSON.parse(
    await readFile(path.join(backup.file, "writer-novel-backup-manifest.json"), "utf8"),
  );
  const entry = manifest.roots[0].entries.find((entry) => entry.path === "作者正文.md");
  if (
    !entry ||
    (await readFile(path.join(backup.file, "root-1", "作者正文.md"), "utf8")) !==
      "正式包备份校验。\n"
  )
    throw new Error("正式包备份正文不一致");
  console.log(`Windows packaged startup, fuses and utility backup OK: ${version}`);
} catch (error) {
  console.error(output);
  throw error;
} finally {
  if (child.exitCode === null && child.signalCode === null) child.kill("SIGKILL");
  await browser?.close();
  await rm(home, { recursive: true, force: true, maxRetries: 10, retryDelay: 100 });
}
