import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeModel } from "./fake-model.mjs";
let app, page, home, root, model;
test.describe.configure({ mode: "serial" });
test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus) {
    await info.attach("model-calls", {
      body: JSON.stringify(model?.calls),
      contentType: "application/json",
    });
    if (page)
      await info.attach("desktop", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
  }
});
test.beforeAll(async () => {
  home = await mkdtemp(path.join(tmpdir(), "writer-ui-app-"));
  root = await mkdtemp(path.join(tmpdir(), "writer-ui-root-"));
  model = await fakeModel({
    "mock-writer": [
      { name: "fanqie_project_create", input: { title: "夜航", key: "night" } },
      {
        name: "fanqie_outline_set",
        input: {
          chapter: "c001",
          title: "雨夜",
          pov: "林川",
          targetWords: 2000,
          locks: "深夜车站",
          knowledge: "不知来电者",
          synopsis: "他去接人",
          conflict: "末班车已走",
          beats: "接到电话",
          ending: "有人敲门",
        },
      },
      {
        name: "fanqie_chapter_save",
        input: {
          chapter: "c001",
          content:
            "林川握着车票站在雨里。站台上的钟停在十一点，广播却又报了一次末班车。\n\n售票员推开窗，问他等谁。他没来得及回答，口袋里的电话先响了。",
          status: "drafted",
        },
      },
      {
        name: "fanqie_candidate_stage",
        input: { chapter: "c001", content: "第一份候选：林川拿起车票。" },
      },
      {
        name: "fanqie_candidate_stage",
        input: { chapter: "c001", content: "第二份候选：售票员拉开铁门。" },
      },
      { text: "作品已创建，请告诉我下一步。" },
      {
        name: "writer_review",
        input: {
          work: "night",
          chapter: "c001",
          task: "完整读本章并交审读回报。",
        },
      },
      { text: "审读回报已交，请作者核对。" },
    ],
    "mock-editor": [
      {
        name: "fanqie_chapter_read",
        input: { work: "night", chapter: "c001" },
      },
      {
        name: "fanqie_review_report",
        input: {
          work: "night",
          chapter: "c001",
          verdict: "通过",
          hard_issues: [],
          levels: [],
          reread_full: true,
          changed_scope: "未改",
          strengths: "动作清楚。",
        },
      },
      { text: "回报已交。" },
    ],
  });
  app = await electron.launch({
    executablePath:
      process.env.WRITER_ELECTRON_EXECUTABLE ||
      createRequire(
        new URL("../../apps/desktop/package.json", import.meta.url),
      )("electron"),
    args: ["--no-sandbox", path.resolve("apps/desktop/out/main/main.js")],
    env: {
      ...process.env,
      WRITER_USER_DATA: home,
      WRITER_PYTHON: process.env.WRITER_PYTHON || "python3",
    },
  });
  page = await app.firstWindow();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await app.evaluate(({ dialog }, directory) => {
    dialog.showOpenDialog = async () => ({
      canceled: false,
      filePaths: [directory],
    });
  }, root);
});
test.afterAll(async () => {
  await app?.close();
  await model?.close();
  if (home) await rm(home, { recursive: true, force: true });
  if (root) await rm(root, { recursive: true, force: true });
});

test("首次引导、连接测试、统一写作根与真实 Pi 创建作品", async () => {
  const wizard = page.getByRole("dialog", { name: "开始创作" });
  await expect(wizard).toBeVisible();
  await wizard.getByLabel("接口地址", { exact: true }).fill(model.url);
  await wizard.getByLabel("模型 ID", { exact: true }).fill("mock-writer");
  await wizard.getByLabel("API Key", { exact: true }).fill("fixture-key");
  await wizard.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(wizard.getByText(/连接成功/)).toBeVisible();
  await wizard.getByRole("button", { name: /保存连接并继续/ }).click();
  await wizard.getByRole("button", { name: /选择写作根/ }).click();
  await wizard.getByRole("button", { name: "开第一本书" }).click();
  await expect(page.getByRole("dialog", { name: "开始创作" })).toBeHidden();
  await expect(page.locator(".project-switch")).toContainText("夜航", {
    timeout: 20000,
  });
  await expect(page.locator(".studio-nav")).toContainText("雨夜");
  await expect(page.locator(".quick-actions")).toContainText("派编辑审");
});

test("决策不被 Agent 挡住，右栏标签与响应式布局，亮暗截图", async () => {
  await page.getByRole("button", { name: /雨夜/ }).first().click();
  await expect(
    page.getByRole("button", { name: "声明已审读", exact: true }).first(),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "定稿", exact: true }).first(),
  ).toBeVisible();
  const columns = await page
    .locator(".studio-layout")
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.split(" ")).toHaveLength(3);
  const fonts = await page.evaluate(() =>
    [
      ...new Set(
        [...document.querySelectorAll("*")]
          .filter((element) => element.textContent?.trim())
          .map((element) => getComputedStyle(element).fontFamily),
      ),
    ],
  );
  for (const family of fonts)
    expect(family).toMatch(/Noto Sans SC|Noto Serif SC|monospace/);
  await page.screenshot({
    path: "docs/design/baseline/desktop-1440-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(
    page.getByRole("button", { name: "声明已审读", exact: true }).first(),
  ).toBeVisible();
  const reader = await page.locator(".studio-paper-column").boundingBox(),
    sidebar = await page.locator(".studio-sidebar").boundingBox();
  expect(reader.x + reader.width).toBeLessThanOrEqual(sidebar.x + 1);
  await page.screenshot({
    path: "docs/design/baseline/desktop-1100-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator(".studio-sidebar")).toHaveCSS("position", "fixed");
  await page.screenshot({
    path: "docs/design/baseline/desktop-900-light.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.getByRole("button", { name: "收起右栏", exact: true }).click();
  await expect(page.locator(".studio-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "打开右栏", exact: true }).click();
  await expect(page.locator(".studio-sidebar")).toBeVisible();
  await page.getByRole("tab", { name: "本章", exact: true }).click();
  await expect(page.locator(".decision-panel")).toBeVisible();
  await page.getByRole("button", { name: "收起右栏", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const appearance = page.getByRole("dialog", { name: "设置", exact: true });
  await appearance.getByRole("button", { name: "外观", exact: true }).click();
  await appearance
    .getByRole("combobox", { name: "主题", exact: true })
    .selectOption("dark");
  await appearance
    .getByRole("button", { name: "保存设置", exact: true })
    .click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.screenshot({
    path: "docs/design/baseline/desktop-1440-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1100, height: 900 });
  await page.screenshot({
    path: "docs/design/baseline/desktop-1100-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 900, height: 900 });
  await page.screenshot({
    path: "docs/design/baseline/desktop-900-dark.png",
    fullPage: true,
    animations: "disabled",
  });
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("命令面板、角色设置与新对话保留作品", async () => {
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  const candidate = page.locator('.result-card[data-kind="candidate"]').first();
  await expect(candidate).toBeVisible();
  await candidate.getByRole("button", { name: /对照查看/ }).click();
  await expect(page.locator(".studio-paper-column")).toContainText(
    "第一份候选：林川拿起车票。",
  );
  await page.getByRole("button", { name: /雨夜/ }).first().click();
  await page.getByRole("tab", { name: "方法方案", exact: true }).click();
  await page.getByRole("button", { name: "新建方案", exact: true }).click();
  await page.locator(".wb-pf-new input").first().fill("界面校验方案");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".wb-pf-methods h3")).toHaveText("界面校验方案");
  await page.locator(".wb-pf-method").first().click();
  const method = page.locator(".wb-pf-textarea");
  await expect(method).toBeEditable();
  const savedMethod = await method.inputValue();
  await method.fill(savedMethod + "\n未保存的界面校验草稿");
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await candidate.getByRole("button", { name: /对照查看/ }).click();
  await page.getByRole("tab", { name: "方法方案", exact: true }).click();
  await expect(method).toHaveValue(savedMethod + "\n未保存的界面校验草稿");
  await method.fill(savedMethod);
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.keyboard.press("Control+k");
  const commands = page.getByRole("dialog", { name: "命令面板" });
  await expect(commands).toBeVisible();
  await expect(commands.getByRole("button", { name: /新对话/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(settings.getByText("独立编辑", { exact: true })).toBeVisible();
  await expect(
    settings.locator("fieldset").nth(1).getByLabel("模型 ID", { exact: true }),
  ).toHaveValue("deepseek-reasoner");
  await settings.getByRole("button", { name: "写作根与偏好", exact: true }).click();
  await settings.getByRole("button", { name: "检查占用和未完成写入", exact: true }).click();
  await expect(settings.getByText(/没有待恢复的写入/)).toBeVisible();
  await expect(settings.getByRole("button", { name: "备份后恢复原操作", exact: true })).toBeHidden();
  await settings.getByRole("button", { name: "取消", exact: true }).click();
  await page.evaluate(async (url) => {
    const api = window.writerDesktop,
      state = await api.state();
    await api.model({
      ...state.models,
      editor: {
        ...state.models.writer,
        baseUrl: url,
        model: "mock-editor",
        apiKey: "fixture-key",
        reasoning: false,
        thinkingLevel: "off",
      },
    });
    await api.request("/agent/deliver", {
      method: "POST",
      body: {
        base: state.target.root,
        work: state.target.work,
        chapter: "c001",
        action: "review",
        confirm: true,
        requestId: "ui-review",
      },
    });
  }, model.url);
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  const result = page.locator('.result-card[data-kind="review"]').last();
  await expect(result).toContainText("通过", { timeout: 15000 });
  await result.getByRole("button", { name: /对照查看/ }).click();
  await expect(page.locator(".studio-paper-column")).toContainText(
    "林川握着车票",
  );
  const before = model.calls.filter(
    (call) => call.model === "mock-writer",
  ).length;
  const workBefore = await page.evaluate(
    async () => (await window.writerDesktop.state()).target,
  );
  await page.evaluate(async () => {
    const api = window.writerDesktop,
      state = await api.state(),
      body = {
        base: state.target.root,
        work: state.target.work,
        action: "continue",
        confirm: true,
        requestId: "ui-dedupe",
      };
    await Promise.all([
      api.request("/agent/deliver", { method: "POST", body }),
      api.request("/agent/deliver", { method: "POST", body }),
    ]);
  });
  await expect
    .poll(
      () => model.calls.filter((call) => call.model === "mock-writer").length,
    )
    .toBe(before + 1);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("dialog", { name: "命令面板" })
    .getByRole("button", { name: /新对话/ })
    .click();
  await expect(page.locator(".studio-nav")).toContainText("雨夜");
  expect(
    await page.evaluate(
      async () => (await window.writerDesktop.state()).target,
    ),
  ).toEqual(workBefore);
  await expect(page.locator(".chat-messages")).toContainText("从一句想法开始");
});
