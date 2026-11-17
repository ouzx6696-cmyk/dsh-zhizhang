import { test, expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, readdir, readFile, rm, stat } from "node:fs/promises";
import path from "node:path";
import { fakeModel } from "./fake-model.mjs";

const BODY = "雨落在旧码头的铁皮棚上，林川把手电压低，沿着湿滑的台阶往下走。".repeat(20);

// M0 旅程包含流水线等待与“关闭重开”的二次启动，统一放宽单测超时。
test.setTimeout(180_000);

// 临时目录放在仓库内而非 %TEMP%：腾讯电脑管家等安全软件会监控 %TEMP%，并在应用高频
// “临时文件 + 重命名”写盘后长时间禁止其在该目录新建文件（本地 E2E 稳定性前提）。
// 仓库目录通常在安全软件信任范围内；套件启动时清理超过一天的遗留目录。
const TMP_BASE = path.resolve("test/.tmp");

async function freshDir(prefix) {
  await mkdir(TMP_BASE, { recursive: true });
  return await mkdtemp(path.join(TMP_BASE, prefix));
}

test.beforeAll(async () => {
  // 本套件独占 test/.tmp；启动时只清理超过一天的遗留目录——
  // worker 因用例失败重启会再次执行 beforeAll，不能动当前这一轮的目录。
  await mkdir(TMP_BASE, { recursive: true }).catch(() => undefined);
  const entries = await readdir(TMP_BASE).catch(() => []);
  const dayAgo = Date.now() - 24 * 60 * 60 * 1000;
  for (const name of entries) {
    const info = await stat(path.join(TMP_BASE, name)).catch(() => undefined);
    if (!info || info.mtimeMs < dayAgo) {
      await rm(path.join(TMP_BASE, name), { recursive: true, force: true }).catch(() => undefined);
    }
  }
});

function toutiaoAnswer(_body, user) {
  const tail = user.slice(-400);
  if (tail.includes('"main"')) {
    return {
      text: JSON.stringify({
        main: { text: "夜码头的账本疑云", motif: "温情" },
        alternatives: [
          { text: "雨夜里的一本旧账", motif: "悬疑" },
          { text: "码头寻人记", motif: "故事" },
          { text: "灯下核账", motif: "警示" },
          { text: "雨停前找到他", motif: "温情" },
        ],
      }),
    };
  }
  if (tail.includes('"openingStyle"')) {
    return {
      text: JSON.stringify({
        openingStyle: "场景钩子式",
        endingStyle: "给期待式",
        sections: [{ heading: "雨夜", question: "找谁", action: "沿台阶走" }],
      }),
    };
  }
  if (tail.includes('"unlocated"')) {
    return { text: JSON.stringify({ claims: [] }) };
  }
  if (tail.includes('"issues"')) {
    return { text: JSON.stringify({ issues: [], summary: "可修" }) };
  }
  if (tail.includes("立项卡")) {
    return {
      text: JSON.stringify({ 主问题: "夜里谁在码头找人", 核心事实: "雨夜旧码头有人撑伞寻人" }),
    };
  }
  return { text: `# 夜码头的账本疑云\n\n${BODY}` };
}

// ── M0-2：编辑器草稿落盘 + 编辑态标题 ─────────────────────────────────────────

const DRAFT_TEXT = "雨夜正文第一段：林川把电压器调低，沿着湿滑的台阶往下走。";

async function launchDesktop(home, root) {
  const model = await fakeModel(() => ({ text: "好的。" }));
  // 应用状态与 Chromium 的 localStorage / 缓存都隔离；同一 home 重启时保留两者。
  const app = await electron.launch({
    args: [
      path.resolve("apps/desktop"),
      `--user-data-dir=${path.join(home, "chromium")}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: { ...process.env, ZHIZHANG_USER_DATA: home, NO_PROXY: "127.0.0.1,localhost" },
  });
  // 关窗守卫统一“离开”：草稿已经由停顿写入落盘，关窗只为重开验证。
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBoxSync = () => 1;
  }, root);
  return { model, app };
}

async function finishOnboarding(page, model) {
  const tid = (id) => page.getByTestId(id);
  await expect(tid("onboarding")).toBeVisible();
  await tid("onboarding-choose-workspace").click();
  await tid("onboarding-next").click();
  await tid("connection-label").fill("本地假模型");
  await tid("connection-api").selectOption("openai-completions");
  await tid("connection-base-url").fill(model.url);
  await tid("connection-keyless").check();
  await tid("connection-model").fill("fake-writer");
  await tid("connection-test").click();
  await expect(tid("connection-result")).toHaveAttribute("data-ok", "true");
  await tid("connection-save").click();
  await tid("onboarding-finish").click();
  await expect(tid("onboarding")).toHaveCount(0);
}

async function createWorkAndChapter(page, workTitle, chapterTitle) {
  const tid = (id) => page.getByTestId(id);
  await tid("target-switch").click();
  await page.getByTestId("target-menu").getByRole("menuitem", { name: "新建长篇" }).click();
  await tid("new-work-title").fill(workTitle);
  await tid("new-work-premise").fill(`${workTitle}的雨夜码头故事`);
  await tid("new-work-submit").click();
  await expect(tid("new-work-dialog")).toHaveCount(0);
  await expect(tid("target-label")).toContainText(workTitle);
  await tid("new-chapter").click();
  await expect(tid("new-chapter-dialog")).toBeVisible();
  await tid("new-chapter-title").fill(chapterTitle);
  await tid("new-chapter-submit").click();
  await expect(tid("chapter-item")).toHaveCount(1);
}

async function typeDraftAndWait(page, root, text) {
  const tid = (id) => page.getByTestId(id);
  await tid("chapter-edit").click();
  await tid("source-editor-input").fill(text);
  const chapterId = await tid("chapter-item").first().getAttribute("data-chapter-id");
  expect(chapterId).toBeTruthy();
  const draftsDir = path.join(root, ".zhizhang", "drafts");
  await expect
    .poll(
      async () => {
        try {
          const names = (await readdir(draftsDir)).filter((n) => n.endsWith(".json"));
          return await Promise.all(
            names.map(async (name) =>
              JSON.parse(await readFile(path.join(draftsDir, name), "utf8")),
            ),
          );
        } catch (error) {
          if (error.code === "ENOENT") return []; // 首次停顿写入尚未建目录
          throw error;
        }
      },
      { timeout: 15_000 },
    )
    .toEqual(
      expect.arrayContaining([
        expect.objectContaining({ text, key: expect.stringContaining(chapterId) }),
      ]),
    );
  return draftsDir;
}

async function selectTargetByLabel(page, label) {
  await page.getByTestId("target-switch").click();
  await page
    .getByTestId("target-menu")
    .getByRole("menuitem")
    .filter({ hasText: label })
    .first()
    .click();
}

test("M0-2：编辑不保存关闭重开 → 恢复提示内容一致，草稿落在写作文件夹", async () => {
  const home = await freshDir("zz-m0-draft-state-");
  const root = await freshDir("zz-m0-draft-root-");
  const { model, app } = await launchDesktop(home, root);
  try {
    const page = await app.firstWindow();
    await finishOnboarding(page, model);
    await createWorkAndChapter(page, "夜航", "雨夜");
    const draftsDir = await typeDraftAndWait(page, root, DRAFT_TEXT);

    await app.close();
    await model.close();

    const relaunched = await launchDesktop(home, root);
    try {
      const page2 = await relaunched.app.firstWindow();
      const tid = (id) => page2.getByTestId(id);
      await expect(tid("onboarding")).toHaveCount(0);
      await tid("chapter-item").first().click();
      await tid("chapter-edit").click();
      await expect(tid("draft-offer")).toBeVisible();
      await tid("draft-offer").getByRole("button", { name: /恢复/ }).click();
      await expect(tid("source-editor-input")).toHaveValue(DRAFT_TEXT);
    } finally {
      await relaunched.app.close();
      await relaunched.model.close();
    }
    expect(draftsDir).toBeTruthy();
  } finally {
    await app.close().catch(() => undefined);
    await model.close().catch(() => undefined);
  }
});

test("M0-2：切换作品后回来 → 草稿仍在（未决定的恢复提示不丢草稿）", async () => {
  const home = await freshDir("zz-m0-switch-state-");
  const root = await freshDir("zz-m0-switch-root-");
  const { model, app } = await launchDesktop(home, root);
  try {
    const page = await app.firstWindow();
    await finishOnboarding(page, model);
    await createWorkAndChapter(page, "夜航", "雨夜");
    await createWorkAndChapter(page, "灯塔", "开端");
    await selectTargetByLabel(page, "夜航");
    await typeDraftAndWait(page, root, DRAFT_TEXT);

    await app.close();
    await model.close();

    const relaunched = await launchDesktop(home, root);
    try {
      const page2 = await relaunched.app.firstWindow();
      const tid = (id) => page2.getByTestId(id);
      await tid("chapter-item").first().click();
      await tid("chapter-edit").click();
      await expect(tid("draft-offer")).toBeVisible();

      // 恢复提示未决定时切换作品：编辑器不脏、守卫放行，草稿文件保留。
      await selectTargetByLabel(page2, "灯塔");
      await selectTargetByLabel(page2, "夜航");
      await tid("chapter-item").first().click();
      await tid("chapter-edit").click();
      await expect(tid("draft-offer")).toBeVisible();
      await tid("draft-offer").getByRole("button", { name: /恢复/ }).click();
      await expect(tid("source-editor-input")).toHaveValue(DRAFT_TEXT);
    } finally {
      await relaunched.app.close();
      await relaunched.model.close();
    }
  } finally {
    await app.close().catch(() => undefined);
    await model.close().catch(() => undefined);
  }
});

test("M0-2：草稿只落写作文件夹，localStorage 不出现正文键", async () => {
  const home = await freshDir("zz-m0-storage-state-");
  const root = await freshDir("zz-m0-storage-root-");
  const { model, app } = await launchDesktop(home, root);
  try {
    const page = await app.firstWindow();
    await finishOnboarding(page, model);
    await createWorkAndChapter(page, "夜航", "雨夜");
    const draftsDir = await typeDraftAndWait(page, root, DRAFT_TEXT);

    const keys = await page.evaluate(() => Object.keys(localStorage));
    expect(keys.filter((key) => key.startsWith("zhizhang:draft:"))).toEqual([]);

    const [draftName] = await readdir(draftsDir);
    const stored = JSON.parse(await readFile(path.join(draftsDir, draftName), "utf8"));
    expect(stored.text).toBe(DRAFT_TEXT);
    expect(typeof stored.savedAt).toBe("number");
  } finally {
    await app.close();
    await model.close();
  }
});

test("M0-2：编辑态稿纸首行无 #，标题框显示章名并随保存同步", async () => {
  const home = await freshDir("zz-m0-heading-state-");
  const root = await freshDir("zz-m0-heading-root-");
  const { model, app } = await launchDesktop(home, root);
  try {
    const page = await app.firstWindow();
    await finishOnboarding(page, model);
    await createWorkAndChapter(page, "夜航", "雨夜");
    const tid = (id) => page.getByTestId(id);
    const chapterId = await tid("chapter-item").first().getAttribute("data-chapter-id");

    // 无首行标题的章节：标题框显示 front matter 章名；输入带 # 的正文原样保存。
    await tid("chapter-edit").click();
    await expect(tid("source-editor-title")).toHaveValue("雨夜");
    await tid("source-editor-input").fill("# 第一章 雨夜\n\n正文从码头开始。");
    await tid("source-editor-save").click();
    await expect(tid("chapter-edit")).toHaveCount(0);

    // 重开编辑态：首行 # 拆出为标题框，textarea 只含其余正文。
    await tid("chapter-edit").click();
    await expect(tid("source-editor-title")).toHaveValue("第一章 雨夜");
    await expect(tid("source-editor-input")).toHaveValue("\n正文从码头开始。");

    // 改标题保存 → 正文首行与 front matter、章节列表、阅读态同步。
    await tid("source-editor-title").fill("第一章 晚潮");
    await tid("source-editor-save").click();
    await expect(tid("chapter-body")).toContainText("晚潮");
    await expect(tid("chapter-item")).toContainText("晚潮");
    const works = await readdir(path.join(root, "长篇"));
    const saved = await readFile(
      path.join(root, "长篇", works[0], "chapters", `${chapterId}.md`),
      "utf8",
    );
    expect(saved).toContain("# 第一章 晚潮");
    expect(saved).toContain("正文从码头开始。");
  } finally {
    await app.close();
    await model.close();
  }
});

test("M0-1：桌面文章流水线两轮未过质检，草稿落盘且状态保持初稿待改", async () => {
  const model = await fakeModel(toutiaoAnswer);
  const home = await freshDir("zz-m0-state-");
  const root = await freshDir("zz-m0-root-");
  const pageErrors = [];
  const app = await electron.launch({
    args: [
      path.resolve("apps/desktop"),
      `--user-data-dir=${path.join(home, "chromium")}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: { ...process.env, ZHIZHANG_USER_DATA: home, NO_PROXY: "127.0.0.1,localhost" },
  });
  try {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    }, root);
    const page = await app.firstWindow();
    page.on("pageerror", (error) => pageErrors.push(error.message));
    const tid = (id) => page.getByTestId(id);

    await expect(tid("onboarding")).toBeVisible();
    await tid("onboarding-choose-workspace").click();
    await tid("onboarding-next").click();
    await tid("connection-label").fill("本地假模型");
    await tid("connection-api").selectOption("openai-completions");
    await tid("connection-base-url").fill(model.url);
    await tid("connection-keyless").check();
    await tid("connection-model").fill("fake-writer");
    await tid("connection-test").click();
    await expect(tid("connection-result")).toHaveAttribute("data-ok", "true");
    await tid("connection-save").click();
    await tid("onboarding-finish").click();
    await expect(tid("onboarding")).toHaveCount(0);

    await tid("target-switch").click();
    await page.getByTestId("target-menu").getByRole("menuitem", { name: "新建头条" }).click();
    await tid("new-article-submit").click();
    await expect(tid("new-article-dialog")).toHaveCount(0);
    await expect(tid("article-item")).toHaveCount(1);
    await tid("dock-tab-pipeline").click();
    await tid("workflow-start").click();
    await expect(tid("workflow-run").first()).toHaveAttribute("data-state", "awaiting-author", {
      timeout: 60_000,
    });

    const articleRoot = path.join(root, "头条");
    const articles = (await readdir(articleRoot, { withFileTypes: true })).filter((entry) =>
      entry.isDirectory(),
    );
    expect(articles).toHaveLength(1);
    const articleDir = path.join(articleRoot, articles[0].name);
    const meta = JSON.parse(await readFile(path.join(articleDir, "meta.json"), "utf8"));
    expect(meta.status).toBe("初稿待改");
    const drafts = await readdir(path.join(articleDir, "drafts"));
    expect(drafts.some((name) => name.endsWith("qa-recheck-2.md"))).toBe(true);
    expect(drafts.some((name) => /^rev-.+\.md$/.test(name))).toBe(true);
    expect(pageErrors).toEqual([]);
  } finally {
    await app.close();
    await model.close();
  }
});

// ── M0-3：外壳（D10 切换守卫 / D11 稍后再说 / D13 历史详情）────────────────────

function chapterAnswer(_body, user) {
  const tail = user.slice(-400);
  if (tail.includes("<<<END>>>"))
    return { text: `# 第二章 夜码头\n\n${BODY.repeat(4)}\n<<<END>>>` };
  if (tail.includes('"scenes"'))
    return {
      text: JSON.stringify({
        scenes: [{ title: "码头", goal: "找人", conflict: "雨夜", hook: "来电" }],
      }),
    };
  if (tail.includes('"score"'))
    return {
      text: JSON.stringify({ score: 88, strengths: ["氛围"], weaknesses: [], summary: "可用" }),
    };
  if (tail.includes('"winner"'))
    return { text: JSON.stringify({ winner: "A", reason: "节奏更紧" }) };
  if (tail.includes('"verdict"'))
    return { text: JSON.stringify({ verdict: "pass", issues: [], summary: "可以交付" }) };
  if (tail.includes('"issues"')) return { text: JSON.stringify({ issues: [] }) };
  return { text: "好的，已读完当前作品。" };
}

test("M0-3：点稍后再说并重启 → 不弹引导（模型未配置也不催）", async () => {
  const home = await freshDir("zz-m0-later-state-");
  const root = await freshDir("zz-m0-later-root-");
  const { model, app } = await launchDesktop(home, root);
  try {
    const page = await app.firstWindow();
    const tid = (id) => page.getByTestId(id);
    await expect(tid("onboarding")).toBeVisible();
    await tid("onboarding-choose-workspace").click();
    await tid("onboarding-next").click();
    await tid("onboarding-skip-model").click();
    await tid("onboarding-finish").click();
    await expect(tid("onboarding")).toHaveCount(0);
    // 等落盘后重启；仅等引导消失可能先于 settings.save 完成。
    await expect
      .poll(async () => JSON.parse(await readFile(path.join(home, "settings.json"), "utf8")))
      .toMatchObject({ shell: { onboardingDismissed: true } });
    await app.close();
    await model.close();

    const relaunched = await launchDesktop(home, root);
    try {
      const page2 = await relaunched.app.firstWindow();
      // 正向确认启动完成，避免尚未渲染的空页面让“不存在”断言提前通过。
      await expect(page2.getByTestId("app")).toBeVisible();
      await expect(page2.getByTestId("welcome")).toBeVisible();
      await expect(page2.getByTestId("onboarding")).toHaveCount(0);
    } finally {
      await relaunched.app.close();
      await relaunched.model.close();
    }
  } finally {
    await app.close().catch(() => undefined);
    await model.close().catch(() => undefined);
  }
});

test("M0-3：写作文件夹未配置时，稍后再说不能阻止引导重现", async () => {
  const home = await freshDir("zz-m0-force-state-");
  const model = await fakeModel(() => ({ text: "好的。" }));
  const app = await electron.launch({
    args: [
      path.resolve("apps/desktop"),
      `--user-data-dir=${path.join(home, "chromium")}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: {
      ...process.env,
      ZHIZHANG_USER_DATA: home,
      NO_PROXY: "127.0.0.1,localhost",
      ELECTRON_DISABLE_SANDBOX: "1",
    },
  });
  try {
    const page = await app.firstWindow();
    const tid = (id) => page.getByTestId(id);
    await expect(tid("onboarding")).toBeVisible();
    await tid("onboarding-later").click();
    await expect(tid("onboarding")).toHaveCount(0);
    await app.close();
    await model.close();

    // 写作文件夹仍未配置：关闭标记不生效，引导必须重现。
    const relaunched = await launchDesktop(home, await freshDir("zz-m0-force-unused"));
    try {
      const page2 = await relaunched.app.firstWindow();
      await expect(page2.getByTestId("onboarding")).toBeVisible({ timeout: 15_000 });
    } finally {
      await relaunched.app.close();
      await relaunched.model.close();
    }
  } finally {
    await app.close().catch(() => undefined);
    await model.close().catch(() => undefined);
  }
});

test("M0-3：历史里点开上一条运行 → 显示阶段列表与交付回执", async () => {
  const home = await freshDir("zz-m0-hist-state-");
  const root = await freshDir("zz-m0-hist-root-");
  const model = await fakeModel(chapterAnswer);
  const app = await electron.launch({
    args: [
      path.resolve("apps/desktop"),
      `--user-data-dir=${path.join(home, "chromium")}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: {
      ...process.env,
      ZHIZHANG_USER_DATA: home,
      NO_PROXY: "127.0.0.1,localhost",
      ELECTRON_DISABLE_SANDBOX: "1",
    },
  });
  try {
    await app.evaluate(({ dialog }, folder) => {
      dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
      dialog.showMessageBoxSync = () => 1;
    }, root);
    const page = await app.firstWindow();
    const tid = (id) => page.getByTestId(id);

    await finishOnboarding(page, model);
    await createWorkAndChapter(page, "夜航", "雨夜");
    await tid("dock-tab-pipeline").click();
    await tid("workflow-start").click();
    await expect(tid("workflow-run").first()).toHaveAttribute("data-state", "awaiting-author", {
      timeout: 120_000,
    });
    // 采纳第一条：章节流水线走“对照 → 采纳”（与 ui.spec (c) 同一条路径）
    await tid("workflow-compare").click();
    await expect(tid("compare-candidate")).toBeVisible({ timeout: 30_000 });
    await tid("workflow-adopt").click();
    const confirm = tid("confirm-ok");
    if (await confirm.isVisible().catch(() => false)) await confirm.click();
    await expect(tid("workflow-run").first()).toHaveAttribute("data-state", "applied", {
      timeout: 30_000,
    });

    // 发起第二条（此时第一条进历史）
    await tid("workflow-start").click();
    await expect(tid("workflow-run").first()).toHaveAttribute("data-state", "awaiting-author", {
      timeout: 120_000,
    });

    // 点开历史里的第一条（applied，候选稿已交付）→ 阶段列表 + 交付回执 → 返回当前运行
    await tid("workflow-history").locator("summary").click();
    await tid("workflow-history-item").first().click();
    await expect(tid("run-detail")).toBeVisible();
    await expect(tid("run-detail")).toHaveAttribute("data-state", "applied");
    await expect(tid("run-detail-stage").first()).toBeVisible();
    expect(await tid("run-detail-stage").count()).toBeGreaterThan(1);
    await expect(tid("run-detail-receipt")).toBeVisible();
    await expect(tid("run-detail-context-empty")).toBeVisible();
    await tid("run-detail-back").click();
    await expect(tid("workflow-run").first()).toBeVisible();

    // 再进同一详情 → 「打开对照」产物链接 → 对照视图（候选稿落盘，采纳后仍可回看）→ 关闭回到当前运行
    await tid("workflow-history").locator("summary").click();
    await tid("workflow-history-item").first().click();
    await expect(tid("run-detail")).toBeVisible();
    await expect(tid("run-detail-compare")).toBeVisible();
    await tid("run-detail-compare").click();
    await expect(tid("compare-candidate")).toBeVisible({ timeout: 30_000 });
    await tid("compare-close").click();
    await expect(tid("workflow-run").first()).toBeVisible();
  } finally {
    await app.close();
    await model.close();
  }
});
