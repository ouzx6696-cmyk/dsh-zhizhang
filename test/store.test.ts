/**
 * Storage layer — sandbox ids, ledger bound, mtime cache invalidation,
 * bad-timestamp resilience, snapshot field caps, lens rows, prev-chapter
 * resolution (no silent fallback for unregistered ids).
 */
import { describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { tmpdir } from "node:os";
import path from "node:path";
import { mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import {
  LEDGER_MAX_ENTRIES,
  appendLedger,
  assertResourceId,
  atomicWrite,
  buildPanelSnapshot,
  getRecentBrief,
  listChapterLensRows,
  readLedger,
  recordBriefBreadcrumb,
  ensureStorage,
  listProjects,
  rememberProject,
  saveChapter,
  setOutline,
  stageCandidate,
} from "../src/lib/store.ts";
import { readTextCached } from "../src/lib/file-cache.ts";
import { resolvePrevChapter } from "../src/lib/services/chapter-context.ts";
import { withWork, expectReject } from "./helpers.ts";

describe("store · 资源 id 沙箱", () => {
  test("路径段非法一律 bad_id；中文 id 合法", () => {
    for (const bad of ["../../escape", "../escape", "a/b", "a\\b", "..", "."]) {
      try {
        assertResourceId(bad, "章节 id");
        throw new Error(`应拒绝 ${bad}`);
      }
      catch (err) {
        expect((err as { code?: string }).code).toBe("bad_id");
      }
    }
    expect(assertResourceId("第二章", "章节 id")).toBe("第二章");
    expect(assertResourceId("c001", "章节 id")).toBe("c001");
  });
});

describe("store · ledger 与缓存", () => {
  test("appendLedger 保留上限并裁最旧", async () => {
    const { dir, cleanup } = await withWork("账本上限");
    try {
      const over = LEDGER_MAX_ENTRIES + 5;
      for (let i = 0; i < over; i++) {
        await appendLedger(dir, { chapterId: "c001", kind: "note", summary: `#${i}` });
      }
      const ledger = await readLedger(dir);
      expect(ledger.entries.length).toBe(LEDGER_MAX_ENTRIES);
      expect(ledger.entries[0].summary).toBe("#5");
      expect(ledger.entries[ledger.entries.length - 1].summary).toBe(`#${over - 1}`);
    }
    finally {
      await cleanup();
    }
  });

  test("mtime 读缓存：atomicWrite 与外部改写都正确失效", async () => {
    const { base, cleanup } = await withWork("缓存失效");
    try {
      const file = path.join(base, "cache-target.json");
      await atomicWrite(file, JSON.stringify({ v: 1 }));
      expect((await readTextCached(file)).includes('"v":1')).toBe(true);
      await atomicWrite(file, JSON.stringify({ v: 2 }));
      expect((await readTextCached(file)).includes('"v":2')).toBe(true);
      await new Promise((r) => setTimeout(r, 20));
      await writeFile(file, JSON.stringify({ v: 3 }), "utf8");
      expect((await readTextCached(file)).includes('"v":3')).toBe(true);
    }
    finally {
      await cleanup();
    }
  });

  test("坏时间戳只废一条：getRecentBrief 跳过继续找旧的", async () => {
    const { dir, cleanup } = await withWork("坏时间戳");
    try {
      await recordBriefBreadcrumb(dir, { chapterId: "c001", assetIds: ["style_contract"] });
      await new Promise((r) => setTimeout(r, 10));
      await recordBriefBreadcrumb(dir, { chapterId: "c001", assetIds: ["draft"] });
      const crumbsPath = path.join(dir, "brief-crumbs.json");
      const raw = JSON.parse(await readTextCached(crumbsPath));
      raw.entries[raw.entries.length - 1].at = "not-a-date";
      await atomicWrite(crumbsPath, JSON.stringify(raw, null, 2) + "\n");
      const hit = await getRecentBrief(dir, "c001");
      expect(hit?.chapterId).toBe("c001");
      expect(hit?.assetIds).toEqual(["style_contract"]);
    }
    finally {
      await cleanup();
    }
  });
});

describe("store · 快照上界（显示层裁剪，不碰事实源）", () => {
  test("foundation 600 / 透镜 400 / 候选=待采纳+近20 / payoff 近12章", async () => {
    const { paths, dir, cleanup } = await withWork("快照上界");
    try {
      await saveChapter(dir, { id: "c001", title: "一", body: "正文。", status: "drafted" });
      await setOutline(dir, "c001", {
        situationLens: "焦".repeat(900),
        livedScene: "场".repeat(900),
        ending: "他走了。",
      });
      for (let i = 1; i <= 30; i++) {
        await stageCandidate(dir, { chapterId: "c001", body: `历史稿 ${i}。`, note: `#${i}` });
      }
      const snap = await buildPanelSnapshot(dir, paths, { includeHtml: false });
      expect(snap.foundation.locks.length).toBeLessThanOrEqual(601);
      const ch = snap.chapters.find((c: any) => c.id === "c001");
      expect(ch.situationLens.length).toBeLessThanOrEqual(401);
      expect(ch.situationLens.endsWith("…")).toBe(true);
      // 待采纳候选全保留（面板要数 pending、列抉择）；已采纳侧在快照构建处另截 20
      expect(snap.candidates.length).toBe(30);
      expect(snap.candidates.every((c: any) => c.pending)).toBe(true);
    }
    finally {
      await cleanup();
    }
  });

  test("listChapterLensRows 只带透镜行（轻量路径）", async () => {
    const { dir, cleanup } = await withWork("透镜行");
    try {
      await setOutline(dir, "c001", { situationLens: "门口", livedScene: "推门", stateLens: "犹豫", ending: "走" });
      const rows = await listChapterLensRows(dir);
      expect(rows.length).toBe(1);
      expect(rows[0]).toHaveProperty("situationLens");
      expect(rows[0]).not.toHaveProperty("briefRecent");
    }
    finally {
      await cleanup();
    }
  });
});

describe("store · 前章解析", () => {
  test("未登记章节 id 不再静默回退到最后一章（返回 null）", async () => {
    const { dir, cleanup } = await withWork("前章回退");
    try {
      await saveChapter(dir, { id: "c001", title: "一", body: "甲", status: "drafted" });
      await saveChapter(dir, { id: "c002", title: "二", body: "乙", status: "drafted" });
      const prev = await resolvePrevChapter(dir, "c999");
      expect(prev).toBeNull();
      const ok = await resolvePrevChapter(dir, "c002");
      expect(ok?.meta?.id ?? ok?.id).toBeTruthy();
    }
    finally {
      await cleanup();
    }
  });
});

describe("store · 损坏章节不当作「不存在」", () => {
  test("front matter 非法：setOutline 与 saveChapter 都报错，原稿正文原样保留", async () => {
    const { dir, cleanup } = await withWork("损坏章节");
    try {
      await saveChapter(dir, { id: "c001", title: "一", body: "原稿正文不能丢。", status: "final" });
      const file = path.join(dir, "chapters", "c001.md");
      await writeFile(file, "---\n{ 这不是 JSON\n---\n\n原稿正文不能丢。\n", "utf8");

      await expectReject(() => setOutline(dir, "c001", { stateLens: "补一句状态" }));
      // saveChapter 内部读到既有记录时同样不能把损坏当新建：
      // 否则 outline / status(final) 会被静默重置成默认值。
      await expectReject(() =>
        saveChapter(dir, { id: "c001", title: "一", body: "新正文", status: "drafted" }),
      );

      const raw = await readFile(file, "utf8");
      expect(raw).toContain("原稿正文不能丢。");
      expect(raw).toContain("这不是 JSON");
    }
    finally {
      await cleanup();
    }
  });
});

describe("store · 候选 id 唯一", () => {
  test("同毫秒并发暂存 12 条，id 互不相同", async () => {
    const { dir, cleanup } = await withWork("并发暂存");
    try {
      await saveChapter(dir, { id: "c001", title: "一", body: "旧正文。" });
      const staged = await Promise.all(
        Array.from({ length: 12 }, () => stageCandidate(dir, { chapterId: "c001", body: "新正文。" })),
      );
      expect(new Set(staged.map((c: any) => c.id)).size).toBe(12);
    }
    finally {
      await cleanup();
    }
  });
});

describe("store · 快照轻量模式", () => {
  test("hintsOnly 只返回 nextHints，不读 ledger / 库 / 灵感", async () => {
    const { dir, paths, cleanup } = await withWork("轻量快照");
    try {
      await appendLedger(dir, { chapterId: "c001", kind: "note", summary: "一条账" });
      const lean = (await buildPanelSnapshot(dir, paths, { hintsOnly: true })) as Record<string, unknown>;
      expect(Object.keys(lean)).toEqual(["nextHints"]);
      const full = (await buildPanelSnapshot(dir, paths, {})) as any;
      expect(Array.isArray(full.ledgerRecent)).toBe(true);
      expect(full.ledgerRecent.length).toBeGreaterThan(0);
    }
    finally {
      await cleanup();
    }
  });
});

describe("store · 项目摘要的作品根", () => {
  test("自定义 worksRoot 的项目，摘要 worksRoot 指向该书库目录（面板切项目不串根）", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zhizhang-proj-"));
    const base = path.join(root, ".zhizhang");
    const books = path.join(root, "novels");
    try {
      await ensureStorage({}, { storageRoot: base, worksRoot: books });
      rememberProject(base, books);
      let hit: any;
      for (let i = 0; i < 40 && !hit; i++) {
        const rows = await listProjects({ refresh: true });
        hit = rows.find((r: any) => r.base === path.resolve(base));
        if (!hit)
          await new Promise((r) => setTimeout(r, 25));
      }
      expect(hit?.worksRoot).toBe(path.resolve(books));
    }
    finally {
      await rm(root, { recursive: true, force: true });
    }
  });
});
