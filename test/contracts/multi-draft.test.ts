import { describe, expect, test, afterEach } from "bun:test";
import {
  MultiDraftPort,
  ProductMap,
  Scheduler,
  SCHEDULER_BYPASSES,
  getPortConfig,
  resetPortConfig,
  setPortConfig,
} from "../../src/lib/ports/index.ts";
import {
  acceptCandidate,
  listCandidates,
  markCandidateLinted,
  readCandidate,
  readChapter,
  stageCandidate,
  buildPanelSnapshot,
} from "../../src/lib/store.ts";
import { __testing } from "../../src/index.ts";
import { withTempWork } from "../helpers.ts";

describe("Multi-draft + unify (0.14 optional, default off)", () => {
  afterEach(() => {
    resetPortConfig();
    delete process.env.DSH_ZHIZHANG_MULTI_DRAFT;
  });

  test("default config: unify tools refuse multi_draft_disabled; chapters untouched", async () => {
    resetPortConfig();
    expect(getPortConfig().multiDraftEnabled).toBe(false);
    expect(MultiDraftPort.isEnabled()).toBe(false);

    const { base, dir, meta, cleanup } = await withTempWork("多稿关");
    try {
      const a = await stageCandidate(dir, {
        chapterId: "c001",
        body: "甲稿：灯下有人翻账。",
        draftLabel: "口气A",
      });
      await new Promise((r) => setTimeout(r, 2));
      const b = await stageCandidate(dir, {
        chapterId: "c001",
        body: "乙稿：雨打窗，条子还在。",
        draftLabel: "口气B",
      });

      const unifyBrief = __testing.tools.find((t) => t.name === "zhizhang_candidate_unify_brief")!;
      const out = await unifyBrief.execute(
        { work: meta.key, working_dir: base, chapter: "c001" },
        {},
      );
      expect(out).toMatch(/multi_draft_disabled|未开启/);

      const unifyStage = __testing.tools.find((t) => t.name === "zhizhang_candidate_unify_stage")!;
      const stageOut = await unifyStage.execute(
        {
          work: meta.key,
          working_dir: base,
          content: "合并稿不该落盘。",
          candidate_ids: [a.id, b.id],
        },
        {},
      );
      expect(stageOut).toMatch(/multi_draft_disabled|未开启/);

      // chapters/ still absent for c001
      let chErr: unknown;
      try {
        await readChapter(dir, "c001");
      } catch (e) {
        chErr = e;
      }
      expect(chErr).toBeTruthy();

      // staging with label still works when off
      const again = await readCandidate(dir, a.id);
      expect(again.draftLabel).toBe("口气A");
      expect((await listCandidates(dir)).filter((c) => c.pending).length).toBe(2);
    } finally {
      await cleanup();
    }
  });

  test("enable: two drafts → unify_brief → unify_stage → lint → accept", async () => {
    setPortConfig({ multiDraftEnabled: true });
    expect(MultiDraftPort.isEnabled()).toBe(true);

    const { base, dir, meta, cleanup } = await withTempWork("多稿开");
    try {
      const a = await stageCandidate(dir, {
        chapterId: "c001",
        body: "甲：柜台后头有人咳嗽，条子压在账本下。",
        draftLabel: "口气A",
        variantGroup: "batch-1",
      });
      await new Promise((r) => setTimeout(r, 2));
      const b = await stageCandidate(dir, {
        chapterId: "c001",
        body: "乙：雨砸铁皮棚，他把账本合上，条子还露一角。",
        draftLabel: "口气B",
        variantGroup: "batch-1",
      });

      const drafts = __testing.tools.find((t) => t.name === "zhizhang_chapter_drafts")!;
      const listOut = await drafts.execute(
        { work: meta.key, working_dir: base, chapter: "c001" },
        {},
      );
      expect(listOut).toContain(a.id);
      expect(listOut).toContain("口气A");
      expect(listOut).toMatch(/已开启/);

      const unifyBrief = __testing.tools.find((t) => t.name === "zhizhang_candidate_unify_brief")!;
      const briefOut = await unifyBrief.execute(
        { work: meta.key, working_dir: base, chapter: "c001" },
        {},
      );
      expect(briefOut).toContain("统一整理");
      expect(briefOut).toContain(a.id);
      expect(briefOut).toContain(b.id);
      expect(briefOut).toMatch(/unify_stage/);

      const merged =
        "雨砸铁皮棚。柜台后头有人咳嗽。他把账本合上，条子还露一角，压在最底下。";
      const unifyStage = __testing.tools.find((t) => t.name === "zhizhang_candidate_unify_stage")!;
      const staged = await unifyStage.execute(
        {
          work: meta.key,
          working_dir: base,
          content: merged,
          candidate_ids: [a.id, b.id],
          draft_label: "统一整理",
        },
        {},
      );
      expect(staged).toMatch(/统一整理候选已暂存/);
      const unifyId = (staged.match(/cand-[a-z0-9]+/) || [])[0];
      expect(unifyId).toBeTruthy();

      const u = await readCandidate(dir, unifyId!);
      expect(u.source).toBe("unify");
      expect(u.unifyOf).toEqual([a.id, b.id]);
      expect(u.draftLabel).toBe("统一整理");
      expect(u.body).toContain("雨砸铁皮棚");

      const pass = await markCandidateLinted(dir, unifyId!, 0);
      const ch = await acceptCandidate(dir, unifyId!, "replace", {
        lintPassToken: pass.token,
      });
      // acceptCandidate alone doesn't require brief when called at store layer —
      // but we're testing store path after lint. For tool path we'd skip_brief.
      expect(ch.body).toContain("雨砸铁皮棚");
      expect(ch.body).toContain("条子还露一角");

      // parents remain as candidate history
      const parents = await listCandidates(dir);
      expect(parents.some((c) => c.id === a.id)).toBe(true);
      expect(parents.some((c) => c.id === b.id)).toBe(true);
      expect(parents.find((c) => c.id === unifyId!)?.acceptedAt).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  test("stage draft_label persisted through lint mark", async () => {
    const { dir, cleanup } = await withTempWork("标签持久");
    try {
      const cand = await stageCandidate(dir, {
        chapterId: "c001",
        body: "标签测：窗外人影晃了一下。",
        draftLabel: "v2",
        variantGroup: "g1",
      });
      await markCandidateLinted(dir, cand.id, 0);
      const again = await readCandidate(dir, cand.id);
      expect(again.draftLabel).toBe("v2");
      expect(again.variantGroup).toBe("g1");
      expect(again.lintPassToken).toBeTruthy();
    } finally {
      await cleanup();
    }
  });

  test("Scheduler default hints still no unify; bypass multi.draft present", () => {
    expect(Scheduler.version).toBe("0.15.0");
    expect(ProductMap.version).toBe("0.15.0");
    expect(Scheduler.writeLine()).not.toMatch(/unify/);
    expect(Scheduler.nextHint("chapter_brief")).not.toMatch(/unify/);
    expect(Scheduler.nextHint("candidate_stage")).not.toMatch(/unify/);
    expect(SCHEDULER_BYPASSES.some((b) => b.id === "multi.draft")).toBe(true);
    const map = ProductMap.formatForAgent();
    expect(map).toMatch(/可选·多草稿|multi\.draft|多草稿/);
    expect(Scheduler.nextHint("candidate_unify_stage")).toMatch(/style_lint/);
  });

  test("panel snapshot exposes multiDraftEnabled and draft labels", async () => {
    resetPortConfig();
    const { dir, cleanup } = await withTempWork("面板多稿");
    try {
      await stageCandidate(dir, {
        chapterId: "c001",
        body: "面板甲。",
        draftLabel: "甲",
      });
      await new Promise((r) => setTimeout(r, 2));
      await stageCandidate(dir, {
        chapterId: "c001",
        body: "面板乙。",
        draftLabel: "乙",
      });
      const snapOff = await buildPanelSnapshot(dir);
      expect(snapOff.multiDraftEnabled).toBe(false);
      expect(snapOff.candidates.filter((c) => c.pending).length).toBe(2);
      expect(snapOff.candidates.some((c) => c.draftLabel === "甲")).toBe(true);

      setPortConfig({ multiDraftEnabled: true });
      const snapOn = await buildPanelSnapshot(dir);
      expect(snapOn.multiDraftEnabled).toBe(true);
    } finally {
      await cleanup();
    }
  });

  test("env DSH_ZHIZHANG_MULTI_DRAFT=1 enables without PortConfig", () => {
    resetPortConfig();
    process.env.DSH_ZHIZHANG_MULTI_DRAFT = "1";
    expect(MultiDraftPort.isEnabled()).toBe(true);
    delete process.env.DSH_ZHIZHANG_MULTI_DRAFT;
    expect(MultiDraftPort.isEnabled()).toBe(false);
  });

  test("chapter_drafts works when feature off", async () => {
    resetPortConfig();
    const { base, dir, meta, cleanup } = await withTempWork("草稿列表");
    try {
      await stageCandidate(dir, { chapterId: "c001", body: "一。", draftLabel: "一号" });
      const tool = __testing.tools.find((t) => t.name === "zhizhang_chapter_drafts")!;
      const out = await tool.execute(
        { work: meta.key, working_dir: base, chapter: "c001" },
        {},
      );
      expect(out).toContain("一号");
      expect(out).toMatch(/关闭/);
    } finally {
      await cleanup();
    }
  });
});
