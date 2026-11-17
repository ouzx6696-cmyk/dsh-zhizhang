import { test, expect } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { launchV14, v14Answer, command, invoke } from "./v14-helpers.mjs";
let env;
test.describe.configure({ mode: "serial" });
test.setTimeout(90000);
test.beforeAll(async () => (env = await launchV14(v14Answer)));
test.afterAll(async () => env?.close());
test("导入向导 → 原文确认 → 写入设定库 → 历史撤销，规划页无 axe 违规", async () => {
  const { page, tid, work } = env;
  await tid("view-plan").click();
  await tid("plan-tab-import").click();
  await env.pickFile("人物.md", "# 人物\n林川是守灯人。");
  await tid("import-pick").click();
  await expect(tid("import-section")).toHaveCount(1);
  await tid("import-next").click();
  await tid("import-start").click();
  await expect(tid("import-review")).toBeVisible();
  await tid("import-review").click();
  await expect(tid("proposal-source")).toContainText("林川是守灯人。");
  expect((await command(page, "fanqie.bible.get", { work })).entities).toHaveLength(0);
  await tid("proposal-accept").click();
  await tid("pending-commit").click();
  await expect
    .poll(async () => (await command(page, "fanqie.bible.get", { work })).entities.length)
    .toBe(1);
  await tid("plan-tab-library").click();
  await expect(tid("library-page")).toContainText("林川");
  const results = await new AxeBuilder({ page })
    .include('[data-testid="plan-view"]')
    .setLegacyMode(true)
    .analyze();
  expect(results.violations).toEqual([]);
  await tid("plan-tab-history").click();
  await tid("history-page").getByRole("button", { name: "撤销", exact: true }).first().click();
  await tid("confirm-ok").click();
  await expect
    .poll(async () => (await command(page, "fanqie.bible.get", { work })).entities.length)
    .toBe(0);
});
test("编辑大纲 → 创建正文 → 已写章重排预览与提交 → 撤销恢复章序", async () => {
  const { page, tid, work } = env;
  await tid("plan-tab-outline").click();
  await tid("add-volume").click();
  await tid("node-title").fill("卷一");
  await tid("node-save").click();
  await expect(tid("node-editor")).toHaveCount(0);
  await page.getByRole("button", { name: "新建幕", exact: true }).click();
  await tid("node-title").fill("开篇");
  await tid("node-save").click();
  await expect(tid("node-editor")).toHaveCount(0);
  for (const title of ["守灯", "来信"]) {
    await tid("add-plan-chapter").click();
    await tid("node-title").fill(title);
    await tid("node-save").click();
    await expect(tid("node-editor")).toHaveCount(0);
  }
  let outline = await command(page, "fanqie.outline.get", { work });
  const first = outline.nodes.find((n) => n.title === "守灯"),
    volume = outline.nodes.find((n) => n.title === "卷一"),
    act = outline.nodes.find((n) => n.title === "开篇");
  for (const node of [volume, act]) {
    const row = page.locator(`[data-node-id="${node.id}"]`);
    if ((await row.getAttribute("aria-expanded")) !== "true") await row.locator("button").click();
  }
  await page.locator(`[data-node-id="${first.id}"]`).click();
  await page.getByRole("button", { name: "创建正文", exact: true }).click();
  await expect
    .poll(async () => (await command(page, "fanqie.chapter.list", { work })).rows.length)
    .toBe(1);
  const row = (await command(page, "fanqie.chapter.list", { work })).rows[0];
  await command(page, "fanqie.chapter.save", {
    work,
    chapter: row.id,
    base: row.revision,
    body: "林川守着旧灯。",
  });
  // 正文仍为 planned 时不触发“已写章”门禁；先经真实审读流程变为 reviewed。
  const target = { mode: "fanqie", path: work },
    ref = await invoke(page, "workflow.start", target, {
      kind: "fanqie.review",
      request: { chapterId: row.id },
    });
  await expect
    .poll(async () => (await invoke(page, "workflow.get", ref)).state)
    .toBe("awaiting-author");
  await invoke(page, "workflow.decide", ref, "apply");
  await page.getByRole("button", { name: "下移", exact: true }).click();
  await expect(page.getByRole("dialog")).toHaveAccessibleName("确认章节位置变更");
  expect((await command(page, "fanqie.chapter.list", { work })).rows[0].position).toBe(1);
  await page.getByRole("dialog").getByRole("button", { name: "确认并提交", exact: true }).click();
  await expect
    .poll(async () => (await command(page, "fanqie.chapter.list", { work })).rows[0].position)
    .toBe(2);
  await tid("plan-tab-history").click();
  await tid("history-page").getByRole("button", { name: "撤销", exact: true }).first().click();
  await tid("confirm-ok").click();
  await expect
    .poll(async () => (await command(page, "fanqie.chapter.list", { work })).rows[0].position)
    .toBe(1);
});
test("定稿自动记账 → 作者确认 → 已确认状态与一致性检查", async () => {
  const { page, tid, work } = env;
  const row = (await command(page, "fanqie.chapter.list", { work })).rows[0],
    target = { mode: "fanqie", path: work };
  await command(page, "fanqie.chapter.save", {
    work,
    chapter: row.id,
    base: row.revision,
    body: "林川是守灯人。林川左臂受伤。",
  });
  const ref = await invoke(page, "workflow.start", target, {
    kind: "fanqie.review",
    request: { chapterId: row.id },
  });
  await expect
    .poll(async () => (await invoke(page, "workflow.get", ref)).state)
    .toBe("awaiting-author");
  await invoke(page, "workflow.decide", ref, "apply");
  await command(page, "fanqie.chapter.finalize", { work, chapter: row.id });
  await expect
    .poll(
      async () =>
        (await command(page, "fanqie.pending.list", { work })).batches.filter(
          (b) => b.source === "ledger",
        ).length,
    )
    .toBe(1);
  await tid("plan-tab-pending").click();
  const batches = (await command(page, "fanqie.pending.list", { work })).batches,
    ledger = batches.find((b) => b.source === "ledger");
  await tid("pending-batch").selectOption(ledger.id);
  const pending = await command(page, "fanqie.pending.get", {
    work,
    batch: ledger.id,
    page: { offset: 0, limit: 100 },
  });
  for (const item of pending.items)
    await command(page, "fanqie.pending.decide", {
      work,
      batch: ledger.id,
      decisions: [{ id: item.id, decision: "accept" }],
    });
  await tid("pending-commit").click();
  await expect
    .poll(
      async () =>
        (await command(page, "fanqie.bible.get", { work })).states.filter(
          (s) => s.status === "confirmed",
        ).length,
    )
    .toBe(1);
  await tid("plan-tab-checks").click();
  await tid("checks-page").getByRole("button", { name: "开始检查", exact: true }).click();
  await expect(tid("checks-page")).not.toContainText("正在读取");
});
