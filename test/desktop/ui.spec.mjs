import AxeBuilder from "@axe-core/playwright";
import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, rm, mkdir, writeFile, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createRequire } from "node:module";
import { fakeModel } from "./fake-model.mjs";
let app, page, home, root, model;
const rendererErrors = [];
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
    if (page) {
      console.error("Reader state:", await page.locator(".studio-paper-column").innerText());
      await info.attach("desktop", {
        body: await page.screenshot(),
        contentType: "image/png",
      });
    }
  }
  expect(rendererErrors.splice(0)).toEqual([]);
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
  page.on("pageerror", (error) => rendererErrors.push(error.message));
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

test("桌面完整旅程：创作、审读、修改、取消、上下文和搜索设置", async () => {
  test.setTimeout(180000);
  await test.step("首次引导、连接测试、统一写作根与真实 Pi 创建作品", async () => {
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

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("决策不被 Agent 挡住，右栏标签与响应式布局，亮暗截图", async () => {
    await page.getByRole("button", { name: "设置", exact: true }).click();
    const initialAppearance = page.getByRole("dialog", { name: "设置", exact: true });
    await initialAppearance.getByRole("button", { name: "外观", exact: true }).click();
    await initialAppearance.getByRole("button", { name: "晨光", exact: true }).click();
    await initialAppearance.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "light");
    const accessibility = await new AxeBuilder({ page })
      .setLegacyMode()
      .withRules(["color-contrast", "button-name"])
      .analyze();
    expect(accessibility.violations).toEqual([]);
    await page.getByRole("button", { name: /雨夜/ }).first().click();
    await expect(
      page.getByRole("button", { name: "声明已审读", exact: true }).first(),
    ).toBeVisible();
    await expect(page.getByRole("button", { name: "定稿", exact: true }).first()).toBeVisible();
    const listStyle = await page.locator(".studio-nav .wb-chapter-list").evaluate((element) => ({
      listStyle: getComputedStyle(element).listStyleType,
      padding: getComputedStyle(element).paddingLeft,
    }));
    expect(listStyle).toEqual({ listStyle: "none", padding: "0px" });
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
    await expect(
      page.getByRole("button", { name: "声明已审读", exact: true }).first(),
    ).toBeVisible();
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
    await appearance.getByRole("button", { name: "夜灯", exact: true }).click();
    await appearance.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
    await shot("desktop-1440-dark.png");
    await page.setViewportSize({ width: 1100, height: 900 });
    await shot("desktop-1100-dark.png");
    await page.setViewportSize({ width: 900, height: 900 });
    await shot("desktop-900-dark.png");
    await page.setViewportSize({ width: 1440, height: 1000 });

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("命令面板、角色设置与新对话保留作品", async () => {
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
    await page.getByRole("button", { name: "新增一份", exact: true }).click();
    await page.locator(".wb-pf-add input").fill("guard-unsaved");
    page.once("dialog", (dialog) => dialog.dismiss());
    await page.locator(".wb-pf-add button").click();
    await expect(method).toHaveValue(savedMethod + "\n未保存的界面校验草稿");

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
    const idleUsage = await page.evaluate(async () => {
      const api = window.writerDesktop;
      return api.contextUsage((await api.state()).target);
    });
    expect(idleUsage.stats).toBeNull();

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("正文可在稿纸中直接编辑并保存", async () => {
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
    const paths = await store.ensureStorage(null, {
      storageRoot: base,
      worksRoot: path.join(root, "novels"),
    });
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
      "手工编辑检查章",
    );
    await store.updateChapter(work.dir, {
      id: "c001",
      title: "手工编辑检查章",
      body: "林川握着车票站在雨里。站台上的钟停在十一点。",
      status: "drafted",
    });
    await page.reload();
    await page.locator(".project-switch").click();
    await page
      .getByRole("menu")
      .getByRole("button", { name: /编辑检查/ })
      .click();
    await page
      .getByRole("button", { name: /手工编辑检查章/ })
      .first()
      .click();
    await expect(page.locator(".wb-reader-title")).toHaveText("手工编辑检查章");
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

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("停止任务走应用内确认并在 2 秒内收尾", async () => {
    const requestsBefore = model.calls.length;
    model.push("mock-writer", { wait: true });
    const input = page.getByRole("textbox", { name: "写作要求" });
    await input.fill("等待模型时停止");
    await input.press("Enter");
    await expect.poll(() => model.calls.length, { timeout: 10000 }).toBeGreaterThan(requestsBefore);
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

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("今日头条使用同一套外壳与空态引导", async () => {
    const requestsBefore = model.calls.length;
    await page.locator(".project-switch").click();
    await page.getByRole("button", { name: "新头条" }).click();
    await expect.poll(() => model.calls.length, { timeout: 10000 }).toBeGreaterThan(requestsBefore);
    await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeDisabled();
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
    model.push("mock-writer", { status: 401, error: "invalid api key" });
    const input = page.getByRole("textbox", { name: "写作要求" });
    await input.fill("检查模型失败后的任务状态");
    await input.press("Enter");
    await expect(page.locator(".studio-error")).toContainText("模型认证失败");
    await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeDisabled();
    await expect(page.locator(".task-card")).not.toContainText("正在进行");

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("上下文设置持久化、统计可展开，原生窗口尺寸改变后工作区铺满", async () => {
    const panel = page.locator(".context-panel");
    await panel.locator("summary").click();
    await expect(panel).toContainText("累计输入");
    await expect(panel).toContainText("最近请求");
    for (const height of [700, 650]) {
      await page.setViewportSize({ width: 1100, height });
      const inputBounds = await page.locator(".agent-input-area").boundingBox();
      expect(inputBounds.y + inputBounds.height).toBeLessThanOrEqual(height + 1);
    }
    await shot("desktop-context-1100.png");
    await page.setViewportSize({ width: 1440, height: 1000 });
    const enabled = panel.getByRole("checkbox", { name: "自动压缩" });
    await enabled.uncheck();
    await panel.getByRole("button", { name: "保存压缩设置", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("压缩设置已保存");
    expect(
      await page.evaluate(async () => (await window.writerDesktop.state()).context.enabled),
    ).toBe(false);
    await enabled.check();
    await panel.getByRole("button", { name: "保存压缩设置", exact: true }).click();
    await expect(panel.getByRole("button", { name: "保存压缩设置", exact: true })).toBeEnabled();
    await panel.locator("summary").click();
    const cdp = await page.context().newCDPSession(page);
    await cdp.send("Emulation.clearDeviceMetricsOverride");
    const checkFill = async () => {
      await expect
        .poll(async () =>
          page.evaluate(() => {
            const shell = document.querySelector(".writer-desktop").getBoundingClientRect();
            return (
              Math.abs(shell.width - innerWidth) < 2 &&
              Math.abs(shell.height - innerHeight) < 2 &&
              document.documentElement.scrollWidth <= innerWidth
            );
          }),
        )
        .toBe(true);
    };
    for (const size of [
      { width: 1366, height: 768 },
      { width: 1920, height: 1080 },
      { width: 2560, height: 1440 },
    ]) {
      await app.evaluate(
        ({ BrowserWindow }, size) =>
          BrowserWindow.getAllWindows()[0].setBounds({ ...size, x: 0, y: 0 }),
        size,
      );
      await checkFill();
    }
    if (process.platform === "win32") {
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].maximize());
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isMaximized()),
        )
        .toBe(true);
      await checkFill();
      await app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].unmaximize());
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setFullScreen(true),
      );
      await expect
        .poll(() =>
          app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows()[0].isFullScreen()),
        )
        .toBe(true);
      await checkFill();
      await app.evaluate(({ BrowserWindow }) =>
        BrowserWindow.getAllWindows()[0].setFullScreen(false),
      );
    }
    await cdp.detach();

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("手动压缩使用真实 PI 接口，完成后可查看摘要并继续发送", async () => {
    const input = page.getByRole("textbox", { name: "写作要求" });
    const before = model.calls.length;
    await input.fill("压缩测试素材：阿禾对花生过敏。");
    await input.press("Enter");
    await expect.poll(() => model.calls.length).toBeGreaterThan(before);
    await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeDisabled();
    const panel = page.locator(".context-panel");
    await panel.locator(":scope > summary").click();
    await panel.getByRole("spinbutton", { name: "近期保留 token" }).fill("0");
    await panel.getByRole("button", { name: "保存压缩设置", exact: true }).click();
    await expect(panel.getByRole("button", { name: "保存压缩设置", exact: true })).toBeEnabled();
    await panel.getByRole("button", { name: "压缩当前会话", exact: true }).click();
    await expect(panel.getByRole("status")).toContainText("压缩完成");
    const summary = panel.getByText("最近压缩摘要（原始历史保留）", { exact: true });
    await summary.click();
    await expect(panel.locator("pre")).toBeVisible();
    await expect(panel.locator("pre")).not.toBeEmpty();
    await panel.getByRole("spinbutton", { name: "近期保留 token" }).fill("20000");
    await panel.getByRole("button", { name: "保存压缩设置", exact: true }).click();
    await expect(panel.getByRole("button", { name: "保存压缩设置", exact: true })).toBeEnabled();
    await panel.locator(":scope > summary").click();
    const next = model.calls.length;
    await input.fill("继续核对已保存素材");
    await input.press("Enter");
    await expect.poll(() => model.calls.length).toBeGreaterThan(next);
    await expect(page.getByRole("button", { name: "停止任务", exact: true })).toBeDisabled();

    expect(rendererErrors.splice(0)).toEqual([]);
  });
  await test.step("Exa 设置可保存和清除 Key，公开状态不暴露密钥", async () => {
    const resources = async () => {
      await page.getByRole("button", { name: "设置", exact: true }).click();
      const dialog = page.getByRole("dialog", { name: "设置", exact: true });
      await dialog.getByRole("button", { name: "资源与备份", exact: true }).click();
      return dialog;
    };
    let dialog = await resources();
    const libraryPath = path.join(root, ".writer", "library");
    await expect(dialog.getByLabel("当前项目的拆书库路径")).toHaveValue(libraryPath);
    const bookFile = path.join(root, "原文示例.txt");
    await writeFile(bookFile, "第1章 原文\n雨停了，她收起伞。", "utf8");
    await app.evaluate(({ dialog }, file) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
    }, bookFile);
    await dialog.getByRole("button", { name: "导入小说原文", exact: true }).click();
    await expect(dialog).toContainText("已导入原文，尚未拆解");
    await rm(bookFile);
    const stored = (await readdir(path.join(libraryPath, "sources"))).filter((name) =>
      name.endsWith(".txt"),
    );
    expect(stored.length).toBeGreaterThan(0);
    expect(
      (
        await Promise.all(
          stored.map((name) => readFile(path.join(libraryPath, "sources", name), "utf8")),
        )
      ).some((text) => text.includes("雨停了，她收起伞")),
    ).toBe(true);

    await dialog.getByRole("combobox", { name: "搜索服务", exact: true }).selectOption("exa");
    await dialog.getByRole("combobox", { name: "搜索模式", exact: true }).selectOption("lite");
    await dialog.getByLabel("exa API Key", { exact: true }).fill("fixture-exa-secret");
    await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(dialog).toBeHidden();
    const state = await page.evaluate(() => window.writerDesktop.state());
    expect(state.searchConfigured).toBe(true);
    expect(state.searchProvider).toBe("exa");
    expect(JSON.stringify(state)).not.toContain("fixture-exa-secret");
    dialog = await resources();
    await dialog.getByRole("button", { name: "清除搜索 Key", exact: true }).click();
    await dialog.getByRole("button", { name: "保存设置", exact: true }).click();
    await expect(dialog).toBeHidden();
    expect(
      await page.evaluate(async () => (await window.writerDesktop.state()).searchConfigured),
    ).toBe(false);

    expect(rendererErrors.splice(0)).toEqual([]);
  });
});
