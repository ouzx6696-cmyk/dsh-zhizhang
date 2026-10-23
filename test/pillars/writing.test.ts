import { describe, test } from "node:test";
import { expect } from "../_compat/expect.ts";
import path from "node:path";
import { ZhizhangError } from "../../src/lib/errors.ts";
import {
  acceptCandidate,
  listCandidates,
  markCandidateLinted,
  readChapter,
  readLedger,
  readWorkMeta,
  saveChapter,
  setFoundation,
  setOutline,
  stageCandidate,
  buildPanelSnapshot,
} from "../../src/lib/store.ts";
import { __testing } from "../../src/index.ts";
import { withTempWork } from "../helpers.ts";

describe("Writing pillar", () => {
  test("accept gates: final overwrite / double-accept / lint_required / demote reviewed", async () => {
    const { base, dir, meta, cleanup } = await withTempWork("灯下账本");
    try {
      await saveChapter(dir, {
        id: "c001",
        title: "定稿章",
        body: "灯芯已短。",
        status: "final",
      });
      const cand = await stageCandidate(dir, { chapterId: "c001", body: "雨落下来。灯灭了。" });
      const pass = await markCandidateLinted(dir, cand.id, 0);
      let caught: unknown;
      try {
        await acceptCandidate(dir, cand.id, "replace");
      } catch (err) {
        caught = err;
      }
      expect((caught as ZhizhangError).code).toBe("refuse_overwrite_final");
      const forced = await acceptCandidate(dir, cand.id, "replace", {
        force: true,
        lintPassToken: pass.token,
      });
      expect(forced.body).toContain("雨落下来");

      const c2 = await stageCandidate(dir, { chapterId: "c001", body: "第二稿：窗外有人停步。" });
      await markCandidateLinted(dir, c2.id, 0);
      await acceptCandidate(dir, c2.id, "replace");
      let dbl: unknown;
      try {
        await acceptCandidate(dir, c2.id, "replace");
      } catch (err) {
        dbl = err;
      }
      expect((dbl as ZhizhangError).code).toBe("candidate_already_accepted");
      expect((await listCandidates(dir)).some((c) => c.id === c2.id && c.acceptedAt)).toBe(true);

      await saveChapter(dir, { id: "c002", title: "已审", body: "旧稿。", status: "reviewed" });
      const c3 = await stageCandidate(dir, { chapterId: "c002", body: "新稿：灯灭了。" });
      await markCandidateLinted(dir, c3.id, 0);
      expect((await acceptCandidate(dir, c3.id, "replace")).status).toBe("drafted");

      const c4 = await stageCandidate(dir, { chapterId: "c001", body: "未扫稿。" });
      const acceptTool = __testing.tools.find((t) => t.name === "zhizhang_candidate_accept")!;
      const out = await acceptTool.execute(
        { candidate: c4.id, work: meta.key, working_dir: base, skip_brief: true },
        {},
      );
      expect(out).toContain("lint_required");
    } finally {
      await cleanup();
    }
  });

  test("brief → accept appends happened; foundation_append idempotent; panel ledger", async () => {
    const { base, dir, meta, cleanup } = await withTempWork("状态测");
    try {
      await setFoundation(dir, { threads: "条子未结；对面是谁" });
      await saveChapter(dir, {
        id: "c001",
        title: "第一瓶",
        body: "旧。",
        status: "drafted",
        outline: {
          ending: "条子压在账本下",
          situationLens: "夜班",
          livedScene: "对轨",
          stateLens: "短",
        },
      });
      const brief = __testing.tools.find((t) => t.name === "zhizhang_chapter_brief")!;
      const briefOut = await brief.execute(
        { chapter: "c001", work: meta.key, working_dir: base, skip_cards: true },
        {},
      );
      expect(briefOut).toContain("本书读者合同");
      expect(briefOut).toContain("写法提醒");
      expect(briefOut).toContain("style_contract");
      expect(briefOut).toContain("lean");
      expect(briefOut).not.toContain("节拍：");

      const stage = __testing.tools.find((t) => t.name === "zhizhang_candidate_stage")!;
      const staged = await stage.execute(
        {
          chapter: "c001",
          content: "她把条子压进账本，没再关门。",
          work: meta.key,
          working_dir: base,
        },
        {},
      );
      const candId = staged.match(/候选已暂存：(\S+)/)?.[1];
      expect(candId).toBeTruthy();
      await markCandidateLinted(dir, candId!, 0);
      const accept = __testing.tools.find((t) => t.name === "zhizhang_candidate_accept")!;
      const out = await accept.execute(
        { candidate: candId, work: meta.key, working_dir: base },
        {},
      );
      expect(out).toContain("happened_appended");
      expect((await readWorkMeta(dir)).foundation.happened).toContain("[c001]");

      const append = __testing.tools.find((t) => t.name === "zhizhang_foundation_append_happened")!;
      expect(
        await append.execute(
          { chapter: "c001", text: "不应再写", title: "一", work: meta.key, working_dir: base },
          {},
        ),
      ).toContain("未追加");

      // n>=2 injects previous
      await saveChapter(dir, {
        id: "c002",
        title: "续",
        body: "",
        status: "planned",
        outline: { ending: "钥匙", situationLens: "查", livedScene: "人", stateLens: "压" },
      });
      const b2 = await brief.execute(
        { chapter: "c002", work: meta.key, working_dir: base, skip_cards: true },
        {},
      );
      expect(b2).toContain("前章正文");
      expect(b2).toContain("条子压在账本下");
      expect(b2).toContain("她把条子压进账本"); // full prev body, not just ending/tail

      const snap = await buildPanelSnapshot(dir);
      expect(snap.workKey).toBe(meta.key);
      expect((await readLedger(dir)).entries.some((e) => e.summary.includes("采纳"))).toBe(true);
      expect((await readChapter(dir, "c001")).body).toContain("没再关门");
    } finally {
      await cleanup();
    }
  });
});
