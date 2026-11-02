import AxeBuilder from "@axe-core/playwright";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeModel } from "./fake-model.mjs";
let app, page, home, root, model;
const shot = async (name) => {
  const folder = path.resolve(process.env.WRITER_SCREENSHOT_DIR || "test-results/screenshots");
  await mkdir(folder, { recursive: true });
  await page.screenshot({ path: path.join(folder, name), fullPage: true, animations: "disabled" });
};
test.describe.configure({ mode: "default" });
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
      createRequire(new URL("../../apps/desktop/package.json", import.meta.url))("electron"),
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
  await wizard.getByText("高级连接与模型设置", { exact: true }).click();
  await wizard.getByLabel("接口地址", { exact: true }).fill(model.url);
  await wizard.getByLabel("模型", { exact: true }).fill("mock-writer");
  await wizard.getByLabel("API Key", { exact: true }).fill("fixture-key");
  await wizard.getByRole("button", { name: "测试连接", exact: true }).click();
  await expect(wizard.getByText(/已连接/)).toBeVisible();
  await wizard.getByRole("button", { name: /保存连接并继续/ }).click();
  await wizard.getByRole("button", { name: /选择写作文件夹/ }).click();
  await wizard.getByRole("button", { name: "开第一本书" }).click();
  await expect(page.getByRole("dialog", { name: "开始创作" })).toBeHidden();
  await expect(page.locator(".project-switch")).toContainText("夜航", {
    timeout: 20000,
  });
  await expect(page.locator(".studio-nav")).toContainText("雨夜");
  await expect(page.locator(".quick-actions")).toContainText("派编辑审");
});

test("决策不被 Agent 挡住，右栏标签与响应式布局，亮暗截图", async () => {
  await page.getByRole("button", {name:"设置",exact:true}).click();
  const initialAppearance = page.getByRole("dialog", {name:"设置",exact:true});
  await initialAppearance.getByRole("button", {name:"外观",exact:true}).click();
  await initialAppearance.getByRole("combobox", {name:"主题",exact:true}).selectOption("light");
  await initialAppearance.getByRole("button", {name:"保存设置",exact:true}).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
  const accessibility = await new AxeBuilder({ page })
    .setLegacyMode()
    .withRules(["color-contrast", "button-name"])
    .analyze();
  expect(accessibility.violations).toEqual([]);
  await page.getByRole("button", { name: /雨夜/ }).first().click();
  await expect(page.getByRole("button", { name: "声明已审读", exact: true }).first()).toBeVisible();
  await expect(page.getByRole("button", { name: "定稿", exact: true }).first()).toBeVisible();
  const columns = await page
    .locator(".studio-layout")
    .evaluate((element) => getComputedStyle(element).gridTemplateColumns);
  expect(columns.split(" ")).toHaveLength(3);
  const fonts = await page.evaluate(() => {
    const families = new Map();
    for (const element of [document.body, ...document.body.querySelectorAll("*")]) {
      if (!element.textContent?.trim() || !element.getClientRects().length) continue;
      const family = getComputedStyle(element).fontFamily;
      if (!families.has(family))
        families.set(
          family,
          element.tagName.toLowerCase() +
            (typeof element.className === "string" && element.className
              ? "." + element.className.trim().split(/\s+/).join(".")
              : ""),
        );
    }
    return [...families];
  });
  for (const [family, source] of fonts)
    expect(family, `字体来自 ${source}`).toMatch(/Noto Sans SC|Noto Serif SC|monospace/);
  const visibleText = await page.locator("body").innerText();
  for (const pattern of [
    /cand-[0-9a-f]{6}/i,
    /\bdrafted\b/i,
    /\bkind\s*=/i,
    /\bkey\s*=/i,
    /\bledger\b/i,
    /writer_plan/,
    /fanqie_/,
    /toutiao_/,
  ])
    expect(visibleText).not.toMatch(pattern);
  await shot("desktop-1440-light.png");
  await page.setViewportSize({ width: 1100, height: 900 });
  await expect(page.getByRole("button", { name: "声明已审读", exact: true }).first()).toBeVisible();
  const reader = await page.locator(".studio-paper-column").boundingBox(),
    sidebar = await page.locator(".studio-sidebar").boundingBox();
  expect(reader.x + reader.width).toBeLessThanOrEqual(sidebar.x + 1);
  await shot("desktop-1100-light.png");
  await page.setViewportSize({ width: 900, height: 900 });
  await expect(page.locator(".studio-sidebar")).toHaveCSS("position", "fixed");
  await shot("desktop-900-light.png");
  await page.getByRole("button", { name: "收起右栏", exact: true }).click();
  await expect(page.locator(".studio-sidebar")).toBeHidden();
  await page.getByRole("button", { name: "打开右栏", exact: true }).click();
  await expect(page.locator(".studio-sidebar")).toBeVisible();
  await page.getByRole("tab", { name: "本章", exact: true }).click();
  await expect(page.locator(".decision-panel")).toBeVisible();
  const panelText = await page.locator(".studio-sidebar").innerText();
  for (const pattern of [
    /situationLens/,
    /fanqie_/,
    /toutiao_/,
    /multiDraft/,
    /chapter_save/,
    /confirm_bypass/,
    /expected_revision/,
  ])
    expect(panelText).not.toMatch(pattern);
  await page.getByRole("button", { name: "全书仪表盘", exact: true }).click();
  await expect(page.locator(".wb-pipeline")).toBeVisible();
  const overviewText = await page.locator(".wb-pipeline").innerText();
  for (const pattern of [
    /situationLens/,
    /fanqie_/,
    /toutiao_/,
    /multiDraft/,
    /chapter_save/,
    /confirm_bypass/,
    /expected_revision/,
  ])
    expect(overviewText).not.toMatch(pattern);
  await page.getByRole("button", { name: "写作", exact: true }).click();
  await page.getByRole("button", { name: "收起右栏", exact: true }).click();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const appearance = page.getByRole("dialog", { name: "设置", exact: true });
  await appearance.getByRole("button", { name: "外观", exact: true }).click();
  await appearance.getByRole("combobox", { name: "主题", exact: true }).selectOption("dark");
  await appearance.getByRole("button", { name: "保存设置", exact: true }).click();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await shot("desktop-1440-dark.png");
  await page.setViewportSize({ width: 1100, height: 900 });
  await shot("desktop-1100-dark.png");
  await page.setViewportSize({ width: 900, height: 900 });
  await shot("desktop-900-dark.png");
  await page.setViewportSize({ width: 1440, height: 1000 });
});

test("命令面板、角色设置与新对话保留作品", async () => {
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  const candidate = page.locator('.result-card[data-kind="candidate"]').first();
  await expect(candidate).toBeVisible();
  const candidateTitles = page.locator('.result-card[data-kind="candidate"] strong');
  await expect(candidateTitles.nth(0)).toHaveText("候选稿 1");
  await expect(candidateTitles.nth(1)).toHaveText("候选稿 2");
  await candidate.getByRole("button", { name: /对照查看/ }).click();
  await expect(page.locator(".studio-paper-column")).toContainText("第一份候选：林川拿起车票。");
  await expect(page.getByRole("combobox", { name: "选择候选稿" })).toBeVisible();
  await page.getByRole("button", { name: /雨夜/ }).first().click();
  await page.getByRole("tab", { name: "方法方案", exact: true }).click();
  await page.getByRole("button", { name: "打开方法方案", exact: true }).click();
  await page.getByRole("button", { name: "新建方案", exact: true }).click();
  await page.locator(".wb-pf-new input").first().fill("界面校验方案");
  await page.getByRole("button", { name: "创建", exact: true }).click();
  await expect(page.locator(".wb-pf-methods h3")).toHaveText("界面校验方案");
  await page.locator(".wb-pf-method").first().click();
  await page.getByRole("button", { name: "编辑", exact: true }).click();
  const method = page.locator(".wb-pf-textarea");
  await expect(method).toBeEditable();
  const savedMethod = await method.inputValue();
  await method.fill(savedMethod + "\n未保存的界面校验草稿");
  await page.getByRole("button", { name: "关闭方法方案", exact: true }).click();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  page.once("dialog", (dialog) => dialog.dismiss());
  await candidate.getByRole("button", { name: /对照查看/ }).click();
  await page.getByRole("tab", { name: "方法方案", exact: true }).click();
  await page.getByRole("button", { name: "打开方法方案", exact: true }).click();
  await expect(method).toHaveValue(savedMethod + "\n未保存的界面校验草稿");
  await method.fill(savedMethod);
  await page.getByRole("button", { name: "关闭方法方案", exact: true }).click();
  await page.getByRole("tab", { name: "Agent", exact: true }).click();
  await page.keyboard.press("Control+k");
  const commands = page.getByRole("dialog", { name: "命令面板" });
  await expect(commands).toBeVisible();
  await expect(commands.getByRole("button", { name: /新对话/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await page.getByRole("button", { name: "设置", exact: true }).click();
  const settings = page.getByRole("dialog", { name: "设置", exact: true });
  await expect(settings.getByRole("tab", { name: "独立编辑", exact: true })).toBeVisible();
  await settings.getByRole("tab", { name: "独立编辑", exact: true }).click();
  await expect(
    settings.locator("fieldset").first().getByLabel("模型", { exact: true }),
  ).toHaveValue("mock-writer");
  await settings.getByRole("button", { name: "写作文件夹", exact: true }).click();
  await settings.getByRole("button", { name: "检查占用和未完成写入", exact: true }).click();
  await expect(settings.getByText(/没有待恢复的写入/)).toBeVisible();
  await expect(
    settings.getByRole("button", { name: "备份后恢复原操作", exact: true }),
  ).toBeHidden();
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
  await expect(page.locator(".studio-paper-column")).toContainText("林川握着车票");
  const before = model.calls.filter((call) => call.model === "mock-writer").length;
  const workBefore = await page.evaluate(async () => (await window.writerDesktop.state()).target);
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
    .poll(() => model.calls.filter((call) => call.model === "mock-writer").length)
    .toBe(before + 1);
  await page.keyboard.press("Control+k");
  await page
    .getByRole("dialog", { name: "命令面板" })
    .getByRole("button", { name: /新对话/ })
    .click();
  await expect(page.locator(".studio-nav")).toContainText("雨夜");
  expect(await page.evaluate(async () => (await window.writerDesktop.state()).target)).toEqual(
    workBefore,
  );
  await expect(page.locator(".chat-messages")).toContainText("从一句想法开始");
});

test("正文可在稿纸中直接编辑并保存", async () => {
  await page.evaluate(async (url) => {
    const api = window.writerDesktop,
      state = await api.state();
    if (!state.workspace) {
      await api.model({
        writer: {
          ...state.models.writer,
          api: "openai-completions",
          baseUrl: url,
          model: "mock-writer",
          apiKey: "fixture-key",
        },
        editor: {
          ...state.models.editor,
          api: "openai-completions",
          baseUrl: url,
          model: "mock-editor",
          apiKey: "fixture-key",
        },
      });
      await api.workspace();
    }
  }, model.url);
  const store = await import("../../apps/desktop/out-test/work-store.mjs");
  const base = path.join(root, ".writer");
  const paths = await store.ensureStorage(
    {},
    { storageRoot: base, worksRoot: path.join(root, "novels") },
  );
  const work = await store.createWork(paths, { title: "编辑检查", key: "edit-check" });
  await store.setOutline(
    work.dir,
    "c001",
    {
      pov: "林川",
      targetWords: 2000,
      locks: "车站",
      knowledge: "未知来客",
      synopsis: "等车",
      conflict: "末班已过",
      beats: "来电",
      ending: "有人敲门",
    },
    "雨夜",
  );
  await store.saveChapter(work.dir, {
    id: "c001",
    title: "雨夜",
    body: "林川握着车票站在雨里。站台上的钟停在十一点。",
    status: "drafted",
  });
  await page.evaluate(
    async (target) => {
      await window.writerDesktop.select(target);
    },
    { mode: "fanqie", root: base, work: work.meta.key },
  );
  await page.reload();
  await page.getByRole("button", { name: /雨夜/ }).first().click();
  await page.getByRole("button", { name: "编辑正文", exact: true }).click();
  const editor = page.getByRole("textbox", { name: "编辑正文" });
  await expect(editor).toBeEditable();
  await editor.fill(
    "林川握着车票站在雨里。站台上的钟停在十一点，广播又报了一次末班车。\n\n" +
      "售票员推开窗，问他等谁。他没来得及回答，口袋里的电话先响了。\n\n" +
      "作者亲手补写的一段。",
  );
  // Refusing a view change must keep the live draft.
  await page.evaluate(() => {
    window.__restoreConfirm = window.confirm;
    window.confirm = () => false;
  });
  try {
    await page.getByRole("button", { name: "全书仪表盘", exact: true }).click();
    await expect(editor).toHaveValue(/作者亲手补写的一段/);
  } finally {
    await page.evaluate(() => {
      window.confirm = window.__restoreConfirm;
      delete window.__restoreConfirm;
    });
  }
  await page.keyboard.press("Control+s");
  await expect(editor).toBeHidden();
  await expect(page.locator(".studio-paper-column .wb-manuscript")).toContainText(
    "作者亲手补写的一段。",
  );
  await expect(page.getByText("已保存当前正文。")).toBeVisible();
  // A background write must not silently replace the editor's captured basis.
  await page.getByRole("button", { name: "编辑正文", exact: true }).click();
  await editor.fill("作者尚未保存的局部修改");
  await page.evaluate(async () => {
    const api = window.writerDesktop;
    const state = await api.state();
    const work = state.target.work;
    const current = await api.request("/chapter", { query: { work, id: "c001" } });
    const result = await api.request("/chapter/save", {
      method: "POST",
      body: {
        work,
        chapter: "c001",
        expectedRevision: current.data.meta.revision,
        body: current.data.body + "\n后台先保存的新正文。",
      },
    });
    if (result.status !== 200) throw new Error(JSON.stringify(result));
  });
  await expect(editor).toHaveValue("作者尚未保存的局部修改");
  await page.keyboard.press("Control+s");
  await expect(page.locator(".wb-source-editor [role=alert]")).toContainText(/变化|冲突/);
  await expect(editor).toHaveValue("作者尚未保存的局部修改");
  await page.getByRole("button", { name: "取消", exact: true }).click();
  await page.getByRole("button", { name: "再次点击放弃", exact: true }).click();
  await expect(page.locator(".studio-paper-column .wb-manuscript")).toContainText(
    "后台先保存的新正文。",
  );
});

test("停止任务走应用内确认并在 2 秒内收尾", async () => {
  model.push("mock-writer", { wait: true });
  const input = page.getByRole("textbox", { name: "写作要求" });
  await input.fill("等待模型时停止");
  await input.press("Enter");
  const stop = page.getByRole("button", { name: "停止任务" });
  await expect(stop).toBeVisible({ timeout: 10000 });
  await page.keyboard.press("Escape");
  const confirm = page.getByRole("dialog", { name: "确认操作" });
  await expect(confirm).toBeVisible();
  await confirm.getByRole("button", { name: "取消", exact: true }).focus();
  await page.keyboard.press("Enter");
  await expect(confirm).toBeHidden();
  await expect(stop).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeHidden();
  await expect(stop).toBeEnabled();
  await page.keyboard.press("Escape");
  await expect(confirm).toBeVisible();
  const started = Date.now();
  await confirm.getByRole("button", { name: "继续", exact: true }).click();
  await expect(stop).toBeDisabled({ timeout: 2000 });
  expect(Date.now() - started).toBeLessThan(2000);
});

test("今日头条使用同一套外壳与空态引导", async () => {
  await page.locator(".project-switch").click();
  await page.getByRole("button", { name: "新头条" }).click();
  await expect(page.locator(".studio-nav")).toContainText("文章");
  await expect(page.getByRole("tab", { name: "本篇", exact: true })).toBeVisible();
  await expect(page.locator(".view-switch")).not.toContainText("全书仪表盘");
  await expect(page.locator(".paper-decisions")).toBeHidden();
  await expect(page.getByRole("button", { name: /新写一篇头条/ })).toBeVisible();
  await page.getByRole("button", { name: "发稿台账", exact: true }).click();
  await expect(page.locator(".paper-ledger")).toContainText("发稿台账");
  await expect(page.locator(".paper-ledger")).toContainText("还没有头条稿件");
  const ledgerText = await page.locator(".paper-ledger").innerText();
  for (const pattern of [/toutiao_/, /fanqie_/, /multiDraft/, /chapter_save/])
    expect(ledgerText).not.toMatch(pattern);
  await page.getByRole("button", { name: "写作", exact: true }).click();
  await expect(page.locator(".paper-ledger")).toBeHidden();
  await shot("desktop-toutiao-1440-light.png");
});
