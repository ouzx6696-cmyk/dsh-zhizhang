/**
 * Writing loop — lean/full brief contracts, n≥2 previous-body injection,
 * method asset expansion, delivery chain (brief→stage→lint→accept),
 * payoff soft note, finalize (status-only), assemble, arg hard-validation.
 */
import { afterEach, beforeEach, describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { __testing } from "../src/index.ts";
import { ensureStorage } from "../src/lib/store.ts";

let root: string;
let base: string;
let run: (name: string, args?: Record<string, unknown>) => Promise<string>;
beforeEach(async () => {
  root = await mkdtemp(path.join(tmpdir(), "zhizhang-write-"));
  base = path.join(root, ".zhizhang");
  await ensureStorage({}, { storageRoot: base });
  const tools = new Map(__testing.tools.map((t) => [t.name, t.execute]));
  run = (name, args = {}) => tools.get(name)!(args, {}) as Promise<string>;
});
afterEach(async () => {
  await rm(root, { recursive: true, force: true });
});
const wd = () => ({ working_dir: base });

const BODY1 = ["冻柜的嗡声比人先到。何菱推着计数器数完第三遍，数字停在同一格：奶咖少一箱。", "她把小票的时间戳抄在掌心，对着屏幕又核了一遍。", "门铃没有响。侧窗外的雨把路灯泡开成一团。何菱把侧窗的锁扣死，屏幕停在 02:10。"].join("\n\n");

async function setupWork() {
  await run("zhizhang_project_create", { title: "凌晨账本", genre: "都市", ...wd() });
  await run("zhizhang_outline_set", {
    chapter: "c001", title: "少一箱",
    situationLens: "盘完货对不上数的焦虑", livedScene: "独自调回放", stateLens: "冷、在算数",
    ending: "何菱把侧窗的锁扣死，屏幕停在 02:10。", ...wd(),
  });
}

describe("writing · brief 契约", () => {
  test("lean：读者合同开篇行 + 处境 + style_contract + 交稿链指路", async () => {
    await setupWork();
    const out = await run("zhizhang_chapter_brief", { chapter: "c001", ...wd() });
    expect(out).toContain("## 本书读者合同");
    expect(out).toContain("开篇写法");
    expect(out).toContain("本章处境（lean · 无节拍分镜）");
    expect(out).toContain("style_contract");
    expect(out).toContain("candidate_stage");
  });

  test("n≥2 续写：前章正文全文注入；前章缺 ending 有告警索引", async () => {
    await setupWork();
    await run("zhizhang_candidate_stage", { chapter: "c001", content: BODY1, ...wd() });
    let out = await run("zhizhang_style_lint", { candidate: /cand-[a-z0-9]+/.exec(await run("zhizhang_chapter_drafts", { chapter: "c001", ...wd() }))![0], ...wd() });
    expect(out).toContain("lintPassToken");
    // 用 outline_set 建第二章（有 ending）
    await run("zhizhang_outline_set", { chapter: "c002", title: "旧店名", situationLens: "查签字", ending: "他把小票推回来。", ...wd() });
    // 第一章未 accept → brief 走 c002 时前章无正文
    out = await run("zhizhang_chapter_brief", { chapter: "c002", ...wd() });
    expect(out).toContain("续写");
    expect(out).toContain("前章");
  });

  test("method_get：ids 数组/逗号串皆可（A1）；plan 资产自动带出 style_contract（includes）", async () => {
    let out = await run("zhizhang_method_get", { ids: ["style_contract", "draft"] });
    expect(out).toContain("文风契约");
    expect(out).toContain("写作方法");
    out = await run("zhizhang_method_get", { ids: "style_contract,draft" });
    expect(out).toContain("文风契约");
    out = await run("zhizhang_method_get", { ids: "plan" });
    expect(out).toContain("规划方法");
    expect(out).toContain("文风契约");
    out = await run("zhizhang_method_get", { ids: 42 });
    expect(out).toContain("参数 ids");
  });
});

describe("writing · 交稿链与定稿", () => {
  test("brief→stage→lint→accept→软兑付提示→定稿→汇编", async () => {
    await setupWork();
    await run("zhizhang_chapter_brief", { chapter: "c001", ...wd() });
    let out = await run("zhizhang_candidate_stage", { chapter: "c001", content: BODY1, draft_label: "初稿", ...wd() });
    const candId = /cand-[a-z0-9]+/.exec(out)?.[0]!;
    expect(out).toContain("候选已暂存");

    out = await run("zhizhang_candidate_accept", { candidate: candId, ...wd() });
    expect(out).toContain("lint_required");

    out = await run("zhizhang_style_lint", { candidate: candId, ...wd() });
    expect(out).toContain("lintPassToken：lint-");

    out = await run("zhizhang_candidate_accept", { candidate: candId, ...wd() });
    expect(out).toContain("已采纳");
    expect(out).toContain("payoff_missing");

    const chapterFile = path.join(base, "works", "凌晨账本", "chapters", "c001.md");
    expect((await readFile(chapterFile, "utf8")).includes("侧窗的锁扣死")).toBe(true);

    out = await run("zhizhang_payoff_audit", { chapter: "c001", ...wd() });
    expect(out).toContain("结论：ok（无警告）");

    await run("zhizhang_review_ledger", { action: "append", chapter: "c001", kind: "finalize", summary: "读毕定稿", ...wd() });
    out = await run("zhizhang_chapter_save", { chapter: "c001", status: "final", ...wd() });
    expect(out).toMatch(/final|已保存/);

    out = await run("zhizhang_assemble", { work: "凌晨账本", ...wd() });
    expect(out).toContain("manuscripts");
    expect((await stat(path.join(base, "manuscripts", "凌晨账本.md"))).isFile()).toBe(true);
  });

  test("chapter_save 大正文须 confirm_bypass；仅改状态免", async () => {
    await setupWork();
    const big = "夜".repeat(1200);
    let out = await run("zhizhang_chapter_save", { chapter: "c001", content: big, ...wd() });
    expect(out).toContain("bypass_confirm_required");
    out = await run("zhizhang_chapter_save", { chapter: "c001", content: big, confirm_bypass: true, ...wd() });
    expect(out).toContain("已保存");
    out = await run("zhizhang_chapter_save", { chapter: "c001", status: "final", ...wd() });
    expect(out).toMatch(/final|已保存/);
  });
});

describe("writing · 参数硬校验", () => {
  test("card_ids 传错类型给明确错误，不静默空数组", async () => {
    await setupWork();
    const out = await run("zhizhang_chapter_brief", { chapter: "c001", card_ids: "not-an-array", ...wd() });
    expect(out).toContain("参数 card_ids");
  });
});

describe("writing · 确认旗标只认严格 true", () => {
  test("confirm_bypass 传字符串 \"false\" / \"true\" 都打不开大正文旁路", async () => {
    await setupWork();
    const big = "夜".repeat(1200);
    for (const flag of ["false", "true", 1, "yes"]) {
      const out = await run("zhizhang_chapter_save", {
        chapter: "c001", content: big, confirm_bypass: flag, ...wd(),
      });
      expect(out).toContain("bypass_confirm_required");
    }
  });

  test("final 章拒覆盖：force 传字符串 \"false\" 不生效，严格 true 才放行", async () => {
    await setupWork();
    await run("zhizhang_chapter_brief", { chapter: "c001", ...wd() });
    let out = await run("zhizhang_candidate_stage", { chapter: "c001", content: BODY1, ...wd() });
    const first = /cand-[a-z0-9]+/.exec(out)?.[0]!;
    await run("zhizhang_style_lint", { candidate: first, ...wd() });
    out = await run("zhizhang_candidate_accept", { candidate: first, ...wd() });
    expect(out).toContain("已采纳");
    await run("zhizhang_chapter_save", { chapter: "c001", status: "final", ...wd() });

    await run("zhizhang_chapter_brief", { chapter: "c001", ...wd() });
    out = await run("zhizhang_candidate_stage", { chapter: "c001", content: BODY1, ...wd() });
    const second = /cand-[a-z0-9]+/.exec(out)?.[0]!;
    await run("zhizhang_style_lint", { candidate: second, ...wd() });

    out = await run("zhizhang_candidate_accept", { candidate: second, force: "false", ...wd() });
    expect(out).toContain("refuse_overwrite_final");
    out = await run("zhizhang_candidate_accept", { candidate: second, force: true, ...wd() });
    expect(out).toContain("已采纳");
    expect(out).toContain("drafted");
  });
});

describe("writing · 候选列表顺序", () => {
  test("chapter_drafts include_accepted 取最近 5 条，不是最旧 5 条", async () => {
    await setupWork();
    const candDir = path.join(base, "works", "凌晨账本", "candidates");
    const ids: string[] = [];
    for (let i = 1; i <= 7; i++) {
      const id = `cand-probe${i}`;
      ids.push(id);
      const stamp = `2026-01-0${i}T00:00:00.000Z`;
      await writeFile(path.join(candDir, `${id}.json`), JSON.stringify({
        id, workKey: "凌晨账本", chapterId: "c001", body: "正文", wordCount: 2,
        stagedAt: stamp, updatedAt: stamp, acceptedAt: stamp, note: `第${i}稿`,
      }, null, 2) + "\n", "utf8");
    }
    const out = await run("zhizhang_chapter_drafts", { chapter: "c001", include_accepted: true, ...wd() });
    for (const id of ids.slice(2)) {
      expect(out).toContain(id);
    }
    expect(out).not.toContain("cand-probe1");
    expect(out).not.toContain("cand-probe2");
  });
});
