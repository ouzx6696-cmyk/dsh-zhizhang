import { test, expect, _electron as electron } from "@playwright/test";
import { mkdtemp, readdir, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { fakeModel } from "./fake-model.mjs";

const BODY = "雨落在旧码头的铁皮棚上，林川把手电压低，沿着湿滑的台阶往下走。".repeat(20);

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

test("M0-1：桌面文章流水线两轮未过质检，草稿落盘且状态保持初稿待改", async () => {
  const model = await fakeModel(toutiaoAnswer);
  const home = await mkdtemp(path.join(tmpdir(), "zz-m0-state-"));
  const root = await mkdtemp(path.join(tmpdir(), "zz-m0-root-"));
  const pageErrors = [];
  const app = await electron.launch({
    args: [path.resolve("apps/desktop"), ...(process.platform === "linux" ? ["--no-sandbox"] : [])],
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
