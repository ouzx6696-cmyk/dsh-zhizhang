/**
 * Multi-draft (opt-in) — disabled default refuses; enabled: two drafts →
 * unify_brief → unify_stage (source=unify candidate) → lint → accept.
 */
import { describe, test } from "node:test";
import { expect } from "./_compat/expect.ts";
import { __testing } from "../src/index.ts";
import { MultiDraftPort, setPortConfig, resetPortConfig } from "../src/lib/ports/index.ts";
import { acceptCandidate, listCandidates, markCandidateLinted, readCandidate, saveChapter, stageCandidate } from "../src/lib/store.ts";
import { withWork } from "./helpers.ts";

describe("multidraft · 默认关 / 开启后统一整理", () => {
  test("默认关：unify 工具硬拒且不动章节", async () => {
    const { base, dir, key, cleanup } = await withWork("多稿关");
    try {
      await saveChapter(dir, { id: "c001", title: "一", body: "原稿。", status: "drafted" });
      const unifyBrief = __testing.tools.find((t) => t.name === "zhizhang_candidate_unify_brief")!;
      const out = await unifyBrief.execute({ work: key, working_dir: base, chapter: "c001" }, {});
      expect(out).toContain(MultiDraftPort.disabledCode);
    }
    finally {
      await cleanup();
    }
  });

  test("开启：两稿 → drafts 列表 → unify_brief → unify_stage → lint → accept", async () => {
    setPortConfig({ multiDraftEnabled: true });
    try {
      expect(MultiDraftPort.isEnabled()).toBe(true);
      const { base, dir, key, cleanup } = await withWork("多稿开");
      try {
        await saveChapter(dir, { id: "c001", title: "一", body: "原稿。", status: "drafted" });
        const a = await stageCandidate(dir, { chapterId: "c001", body: "甲：柜台后头有人咳嗽，条子压在账本下。", draftLabel: "口气A", variantGroup: "batch-1" });
        await new Promise((r) => setTimeout(r, 2));
        const b = await stageCandidate(dir, { chapterId: "c001", body: "乙：雨砸铁皮棚，他把账本合上，条子还露一角。", draftLabel: "口气B", variantGroup: "batch-1" });

        const tools = new Map(__testing.tools.map((t) => [t.name, t.execute]));
        const listOut = await tools.get("zhizhang_chapter_drafts")!({ work: key, working_dir: base, chapter: "c001" }, {});
        expect(listOut).toContain("口气A");

        const briefOut = await tools.get("zhizhang_candidate_unify_brief")!({ work: key, working_dir: base, chapter: "c001" }, {});
        expect(briefOut).toContain("统一整理");
        expect(briefOut).toContain(a.id);
        expect(briefOut).toContain(b.id);

        const staged = await tools.get("zhizhang_candidate_unify_stage")!({
          work: key, working_dir: base,
          content: "雨砸铁皮棚。柜台后头有人咳嗽。他把账本合上，条子还露一角，压在最底下。",
          candidate_ids: [a.id, b.id],
          draft_label: "统一整理",
        }, {});
        const unifyId = staged.match(/cand-[a-z0-9]+/)?.[0]!;
        const u = await readCandidate(dir, unifyId);
        expect(u.source).toBe("unify");
        expect(u.unifyOf).toEqual([a.id, b.id]);

        const pass = await markCandidateLinted(dir, unifyId, 0);
        const ch = await acceptCandidate(dir, unifyId, "replace", { lintPassToken: pass.token });
        expect(ch.body).toContain("条子还露一角");
        const parents = await listCandidates(dir);
        expect(parents.some((c) => c.id === a.id)).toBe(true);
        expect(parents.find((c) => c.id === unifyId)?.acceptedAt).toBeTruthy();
      }
      finally {
        await cleanup();
      }
    }
    finally {
      resetPortConfig();
    }
  });
});
