/** A22 harness: seed two 10k-entry PI sessions and measure the real Electron shell. */
import { _electron as electron } from "@playwright/test";
import { SessionManager } from "@earendil-works/pi-coding-agent";
import { createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fileURLToPath } from "node:url";
import {
  ensureStorage,
  createWork,
  rememberProject,
} from "../apps/desktop/out-test/work-store.mjs";
import { defaultModels } from "../apps/desktop/out-test/models.mjs";

const root = fileURLToPath(new URL("../", import.meta.url));
const electronPath =
  process.env.WRITER_ELECTRON_EXECUTABLE ||
  createRequire(new URL("../apps/desktop/package.json", import.meta.url))("electron");
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const marker = (side, index) => `PERF-${side}-${String(index).padStart(5, "0")}`;

function sessionKey(mode, storageRoot, work) {
  return createHash("sha256")
    .update(JSON.stringify({ mode, root: path.resolve(storageRoot), work }))
    .digest("hex")
    .slice(0, 24);
}

async function seedSession(home, storageRoot, work, side) {
  const key = sessionKey("fanqie", storageRoot, work);
  const dir = path.join(home, "sessions", key);
  await mkdir(dir, { recursive: true });
  const manager = SessionManager.create(path.join(storageRoot, "works", work), dir);
  const filler = "长文本".repeat(220);
  manager.appendMessage({
    role: "user",
    content: `${marker(side, 0)} ${filler}`,
    timestamp: Date.now(),
  });
  for (let index = 1; index < 10000; index += 1) {
    if (index % 10 === 0) {
      manager.appendCustomMessageEntry(
        "writer-author",
        `${marker(side, index)} 作者通知 ${filler}`,
        true,
      );
    } else if (index % 2 === 0) {
      manager.appendMessage({
        role: "assistant",
        content: [{ type: "text", text: `${marker(side, index)} ${filler}` }],
        timestamp: Date.now(),
      });
    } else {
      manager.appendMessage({
        role: "user",
        content: `${marker(side, index)} ${filler}`,
        timestamp: Date.now(),
      });
    }
  }
  const file = manager.getSessionFile();
  const info = await stat(file);
  await writeFile(path.join(dir, "current"), file);
  await writeFile(path.join(dir, "history.json"), "[]");
  return {
    key,
    file,
    entries: manager.getEntryCount(),
    bytes: info.size,
    sha256: createHash("sha256").update(await readFile(file)).digest("hex"),
  };
}

async function writeConfig(home, workspace, storageRoot, work) {
  const models = defaultModels();
  for (const role of ["writer", "editor"]) {
    Object.assign(models[role], {
      provider: "fixture",
      baseUrl: "http://127.0.0.1:9/v1",
      apiKey: "fixture-key",
      model: "mock-" + role,
      reasoning: false,
      thinkingLevel: "off",
    });
  }
  await writeFile(path.join(home, "model.json"), JSON.stringify(models));
  await writeFile(
    path.join(home, "desktop.json"),
    JSON.stringify({ workspace, appearance: { theme: "light", font: "serif", fontSize: 18 } }),
  );
  await writeFile(
    path.join(home, "target.json"),
    JSON.stringify({ mode: "fanqie", root: storageRoot, work }),
  );
}

async function launch(home) {
  const app = await electron.launch({
    executablePath: electronPath,
    args: ["--no-sandbox", path.resolve(root, "apps/desktop/out/main/main.js")],
    env: {
      ...process.env,
      WRITER_USER_DATA: home,
      WRITER_PYTHON: process.env.WRITER_PYTHON || "python3",
    },
  });
  const page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 900 });
  return { app, page };
}

async function selectWork(page, title, side) {
  const menu = page.locator(".project-menu");
  const switcher = page.locator(".project-switch");
  const row = menu.locator("button").filter({ hasText: title }).first();
  for (let attempt = 0; attempt < 3; attempt += 1) {
    if (!(await menu.isVisible())) {
      await switcher.click();
      await page.waitForTimeout(150);
    }
    try {
      await row.waitFor({ state: "visible", timeout: 4000 });
      await page.waitForTimeout(150);
      const started = performance.now();
      await row.click({ timeout: 5000 });
      await page.waitForFunction(
        (value) => document.querySelector(".chat-messages")?.innerText.includes(value),
        marker(side, 9999),
        { timeout: 20000 },
      );
      return performance.now() - started;
    } catch (error) {
      if (attempt === 2) {
        const text = await menu.innerText().catch(() => "<no menu>");
        throw new Error(`${error.message}; menu=${text.slice(0, 600)}`);
      }
    }
  }
  throw new Error("无法选择作品：" + title);
}

async function metrics(app) {
  const values = await app.evaluate(({ app: electronApp }) =>
    electronApp.getAppMetrics().map((item) => item.memory?.workingSetSize || 0),
  );
  return values.reduce((sum, value) => sum + value, 0) / 1024;
}

async function main() {
  const base = await mkdtemp(path.join(tmpdir(), "writer-a22-"));
  const home = path.join(base, "app");
  const workspace = path.join(base, "workspace");
  const storageRoot = path.join(workspace, ".writer");
  await mkdir(home, { recursive: true });
  process.env.DSH_HOME = home;
  const paths = await ensureStorage(null, { storageRoot });
  await rememberProject(paths.base, paths.works);
  const first = await createWork(paths, { title: "性能甲" });
  const second = await createWork(paths, { title: "性能乙" });
  const sampleA = await seedSession(home, paths.base, first.meta.key, "A");
  const sampleB = await seedSession(home, paths.base, second.meta.key, "B");
  const targets = {
    A: { title: "性能甲", side: "A", target: { mode: "fanqie", root: paths.base, work: first.meta.key } },
    B: { title: "性能乙", side: "B", target: { mode: "fanqie", root: paths.base, work: second.meta.key } },
  };
  const results = {
    environment: {
      platform: process.platform,
      release: (await import("node:os")).release(),
      cpus: (await import("node:os")).cpus().length,
      totalMemoryGiB: Number(((await import("node:os")).totalmem() / 1024 ** 3).toFixed(1)),
      electron: createRequire(path.resolve(root, "apps/desktop/package.json"))("electron/package.json").version,
      node: process.version,
      viewport: "1440x900",
    },
    sample: { A: sampleA, B: sampleB },
    cold: [],
    hot: [],
    rssMiB: null,
    correctness: null,
  };
  try {
    const coldRuns = Number(process.env.A22_COLD_RUNS ?? 5);
    const hotRuns = Number(process.env.A22_HOT_RUNS ?? 30);
    for (let run = 0; run < coldRuns; run += 1) {
      await writeConfig(home, workspace, paths.base, first.meta.key);
      const startedAt = performance.now();
      const { app, page } = await launch(home);
      try {
        await page.waitForFunction(
          (value) => document.querySelector(".chat-messages")?.innerText.includes(value),
          marker("A", 9999),
          { timeout: 20000 },
        );
        const elapsed = await selectWork(page, targets.B.title, "B");
        results.cold.push({ run: run + 1, ms: Math.round(elapsed), launchMs: Math.round(performance.now() - startedAt) });
      } finally {
        await app.close();
      }
    }

    await writeConfig(home, workspace, paths.base, first.meta.key);
    const { app, page } = await launch(home);
    try {
      await page.waitForFunction(
        (value) => document.querySelector(".chat-messages")?.innerText.includes(value),
        marker("A", 9999),
        { timeout: 20000 },
      );
      let current = "A";
      for (let index = 0; index < 5; index += 1) {
        const next = current === "A" ? "B" : "A";
        await selectWork(page, targets[next].title, next);
        current = next;
      }
      await sleep(1000);
      const before = await metrics(app);
      results.rssBeforeMiB = Number(before.toFixed(2));
      for (let index = 0; index < hotRuns; index += 1) {
        const next = current === "A" ? "B" : "A";
        const elapsed = await selectWork(page, targets[next].title, next);
        results.hot.push({ run: index + 1, side: next, ms: Math.round(elapsed) });
        current = next;
      }
      await sleep(10000);
      const after = await metrics(app);
      results.rssMiB = Number((after - before).toFixed(2));
      results.rssSettleMs = 10000;
      const view = await page.evaluate(async (target) => {
        const api = window.writerDesktop;
        await api.select(target);
        return api.view(target, 80);
      }, targets.A.target);
      const wide = await page.evaluate(
        (target) => window.writerDesktop.view(target, 160),
        targets.A.target,
      );
      results.correctness = {
        total: view.total,
        visible: view.messages.length,
        wideVisible: wide.messages.length,
        wideTotal: wide.total,
        first: view.messages[0]?.writerMessageId || null,
        last: view.messages.at(-1)?.writerMessageId || null,
      };
    } finally {
      await app.close();
    }
    const sorted = results.hot.map((item) => item.ms).sort((a, b) => a - b);
    results.hotP95 = sorted[Math.max(0, Math.ceil(sorted.length * 0.95) - 1)];
    results.coldMax = Math.max(...results.cold.map((item) => item.ms));
    results.hotMax = Math.max(...sorted);
    const out = path.resolve(root, "outputs/acceptance-0.9.3");
    await mkdir(out, { recursive: true });
    const file = path.join(out, `a22-${new Date().toISOString().replace(/[:.]/g, "-")}.json`);
    await writeFile(file, JSON.stringify(results, null, 2));
    console.log(JSON.stringify(results, null, 2));
    console.log("result", file);
  } finally {
    await rm(base, { recursive: true, force: true });
  }
}

await main();
