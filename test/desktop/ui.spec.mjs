import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeModel } from "./fake-model.mjs";

/**
 * 桌面端四条核心旅程（串行共享一个应用实例，状态逐步累积）：
 * (a) 首启引导 → 写作文件夹 → 模型连接；(b) 番茄作品与章节；(c) 番茄章节流水线 → 对照 → 采纳；
 * (d) 头条文章 → 草稿 → 状态流转；另含写作助手发送与停止。
 * 模型是本地假服务；原生选目录对话框在主进程里打桩。
 */

const BODY = "雨落在旧码头的铁皮棚上，林川把手电压低，沿着湿滑的台阶往下走。".repeat(20);

function answer(body, user) {
  const tail = user.slice(-400);
  if (tail.includes("<<<END>>>"))
    return { text: `# 第二章 夜码头\n\n${BODY.repeat(4)}\n<<<END>>>` };
  if (tail.includes('"scenes"')) {
    return {
      text: JSON.stringify({
        scenes: [{ title: "码头", goal: "找人", conflict: "雨夜", hook: "来电" }],
      }),
    };
  }
  if (tail.includes('"score"'))
    return {
      text: JSON.stringify({ score: 88, strengths: ["氛围"], weaknesses: [], summary: "可用" }),
    };
  if (tail.includes('"winner"'))
    return { text: JSON.stringify({ winner: "A", reason: "节奏更紧" }) };
  if (tail.includes('"verdict"'))
    return { text: JSON.stringify({ verdict: "pass", issues: [], summary: "可以交付" }) };
  if (tail.includes('"issues"')) return { text: JSON.stringify({ issues: [] }) };
  if (user.includes("E2E-HOLD")) return { hold: true, text: "我先想一想" };
  return { text: "好的，已读完当前作品。" };
}

let app, page, model, home, root;
const pageErrors = [];
const tid = (id) => page.getByTestId(id);

test.describe.configure({ mode: "serial" });

test.beforeAll(async () => {
  model = await fakeModel(answer);
  home = await mkdtemp(path.join(tmpdir(), "zz-e2e-state-"));
  root = await mkdtemp(path.join(tmpdir(), "zz-e2e-root-"));
  app = await electron.launch({
    args: [path.resolve("apps/desktop"), ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
    env: { ...process.env, ZHIZHANG_USER_DATA: home, NO_PROXY: "127.0.0.1,localhost" },
  });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
  }, root);
  page = await app.firstWindow();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  page.on("console", (message) => {
    if (message.type() === "error") pageErrors.push(message.text());
  });
});

test.afterAll(async () => {
  await app?.close();
  await model?.close();
});

test.afterEach(async ({}, info) => {
  if (info.status !== info.expectedStatus && page) {
    await info.attach("desktop", { body: await page.screenshot(), contentType: "image/png" });
  }
  expect(pageErrors.splice(0)).toEqual([]);
});

test("(a) 首启引导：选写作文件夹、连接模型", async () => {
  await expect(tid("onboarding")).toBeVisible();
  await expect(tid("onboarding-workspace-path")).toHaveAttribute("data-configured", "false");
  await tid("onboarding-choose-workspace").click();
  await expect(tid("onboarding-workspace-path")).toHaveAttribute("data-configured", "true");
  await tid("onboarding-next").click();

  await expect(tid("onboarding-step-model")).toBeVisible();
  await tid("connection-label").fill("本地假模型");
  await tid("connection-api").selectOption("openai-completions");
  await tid("connection-base-url").fill(model.url);
  await tid("connection-keyless").check();
  await tid("connection-model").fill("fake-writer");
  await tid("connection-test").click();
  await expect(tid("connection-result")).toHaveAttribute("data-ok", "true");
  await tid("connection-save").click();

  await expect(tid("onboarding-step-start")).toBeVisible();
  await tid("onboarding-finish").click();
  await expect(tid("onboarding")).toHaveCount(0);
  await expect(tid("model-status")).toHaveAttribute("data-ready", "true");
});

test("(b) 番茄：新建作品、新建章节、编辑保存、看板", async () => {
  await tid("target-switch").click();
  await page.getByTestId("target-menu").getByRole("menuitem", { name: "新建长篇" }).click();
  await expect(tid("new-work-dialog")).toBeVisible();
  await tid("new-work-title").fill("夜航");
  await tid("new-work-premise").fill("雨夜码头的寻人故事");
  await tid("new-work-submit").click();
  await expect(tid("new-work-dialog")).toHaveCount(0);
  await expect(tid("target-label")).toContainText("夜航");

  await tid("new-chapter").click();
  await expect(tid("new-chapter-dialog")).toBeVisible();
  await tid("new-chapter-title").fill("雨夜");
  await tid("new-chapter-submit").click();
  await expect(tid("chapter-item")).toHaveCount(1);
  const chapterId = await tid("chapter-item").first().getAttribute("data-chapter-id");

  await tid("chapter-edit").click();
  await tid("source-editor-input").fill(`# 第一章 雨夜\n\n${BODY}`);
  await tid("source-editor-save").click();
  await expect(tid("chapter-body")).toContainText("旧码头");

  const works = await readdir(path.join(root, "长篇"));
  expect(works.length).toBe(1);
  const saved = await readFile(
    path.join(root, "长篇", works[0], "chapters", `${chapterId}.md`),
    "utf8",
  );
  expect(saved).toContain("旧码头");

  await tid("view-board").click();
  await expect(tid("board")).toBeVisible();
  await expect(tid("board-row")).toHaveCount(1);
  await tid("view-writing").click();
});

test("(c) 番茄：章节流水线 → 阶段进度 → 对照 → 采纳", async () => {
  await tid("chapter-start-pipeline").click();
  await expect(tid("workflow-panel")).toBeVisible();
  await tid("workflow-start").click();
  const run = tid("workflow-run").first();
  await expect(run).toHaveAttribute("data-state", "awaiting-author", { timeout: 30_000 });
  await expect(tid("workflow-stage").first()).toBeVisible();
  await tid("workflow-compare").click();
  await expect(tid("compare-candidate")).toContainText("夜码头");
  await tid("workflow-adopt").click();
  const confirm = tid("confirm-ok");
  if (await confirm.isVisible().catch(() => false)) await confirm.click();
  await expect(run).not.toHaveAttribute("data-state", "awaiting-author", { timeout: 15_000 });
  // 采纳后候选稿才进入正文（流水线只交候选稿，正文由作者决定）。
  const works = await readdir(path.join(root, "长篇"));
  const chapters = path.join(root, "长篇", works[0], "chapters");
  const files = await readdir(chapters);
  const bodies = await Promise.all(files.map((f) => readFile(path.join(chapters, f), "utf8")));
  expect(bodies.some((b) => b.includes("夜码头"))).toBe(true);

  // 连续性真源对作者统一叫“设定集”（网文通用说法），界面里不再出现旧称。
  await tid("dock-tab-chapter").click();
  await expect(tid("bible-pane")).toContainText("设定集");
  await expect(tid("right-dock")).not.toContainText("圣经");
});

test("写作助手：发送、流式回复、停止", async () => {
  await tid("dock-tab-assistant").click();
  await expect(tid("agent-panel")).toBeVisible();
  await tid("agent-input").fill("请读一下当前作品");
  await tid("agent-send").click();
  await expect(tid("agent-message").filter({ hasText: "已读完当前作品" })).toBeVisible({
    timeout: 15_000,
  });

  await tid("agent-input").fill("E2E-HOLD 慢慢想");
  await tid("agent-send").click();
  await expect(tid("agent-stop")).toBeVisible();
  await tid("agent-stop").click();
  await expect(tid("agent-busy")).toHaveCount(0, { timeout: 10_000 });
});

test("(d) 头条：新建文章、编辑草稿、状态流转", async () => {
  await tid("target-switch").click();
  await page.getByTestId("target-menu").getByRole("menuitem", { name: "新建头条" }).click();
  await expect(tid("new-article-dialog")).toBeVisible();
  await tid("new-article-submit").click();
  await expect(tid("new-article-dialog")).toHaveCount(0);
  await expect(tid("article-list")).toBeVisible();
  await expect(tid("article-item")).toHaveCount(1);

  await tid("draft-edit").click();
  await tid("source-editor-input").fill(
    "交了二十年社保，退休才发现少算了一笔\n\n## 先说结论\n\n" + "这笔钱要自己去申请。".repeat(30),
  );
  await tid("source-editor-save").click();
  await expect(tid("draft-body")).toContainText("自己去申请");

  const before = await tid("article-status").innerText();
  const transition = tid("article-transition").first();
  await expect(transition).toBeVisible();
  await transition.click();
  const ok = tid("confirm-ok");
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await expect(tid("article-status")).not.toHaveText(before);
});
