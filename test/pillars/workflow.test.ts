import { describe, expect, test } from "bun:test";
import { access, readFile } from "node:fs/promises";
import path from "node:path";
import { lintStyle, summarizeStyleLint } from "../../src/lib/style-linter.ts";
import {
  acceptCandidate,
  appendLedger,
  assembleManuscript,
  buildPanelSnapshot,
  markCandidateLinted,
  readLedger,
  readWorkMeta,
  saveChapter,
  setFoundation,
  setOutline,
  stageCandidate,
} from "../../src/lib/store.ts";
import { withTempWork } from "../helpers.ts";

async function exists(p: string): Promise<boolean> {
  try {
    await access(p);
    return true;
  } catch {
    return false;
  }
}

describe("End-to-end writing workflow", () => {
  test("foundation→outline→lint→stage→accept→ledger→panel→assemble", async () => {
    const { paths, dir, meta, cleanup } = await withTempWork("借月修补铺");
    try {
      await setFoundation(dir, {
        locks: "灯芯只能拨短不能拨长",
        happened: "阿绫送来一盏无名灯",
        characters: "沈砚；阿绫",
        threads: "刀痕来源未明",
        style: "短句、克制",
      });
      expect((await readWorkMeta(dir)).foundation.locks).toContain("灯芯");

      await setOutline(dir, "c001", {
        pov: "沈砚限知",
        situationLens: "先算刀痕再看人",
        livedScene: "辨认修补痕迹的博弈",
        stateLens: "短句、克制",
        targetWords: 800,
      });

      const aiish =
        "雨还没落。他不是害怕，而是在衡量代价。嘴角勾起一抹冷笑。他感到一阵莫名的绝望。灯灭了。";
      const hits = lintStyle(aiish);
      expect(summarizeStyleLint(hits).cliche_syntax).toBeGreaterThan(0);
      await appendLedger(dir, {
        chapterId: "c001",
        kind: "style_lint",
        summary: `语感雷达 ${hits.length} 处命中`,
        styleHitCount: hits.length,
      });

      const clean =
        "雨还没落。沈砚把灯芯拨短一寸。窗外脚步停了一停，又往巷口走了。他把镊子放回匣中。";
      const cand = await stageCandidate(dir, { chapterId: "c001", body: clean, note: "e2e" });
      const lintPass = await markCandidateLinted(dir, cand.id, 0);
      const accepted = await acceptCandidate(dir, cand.id, "replace", {
        lintPassToken: lintPass.token,
      });
      expect(accepted.body).toContain("巷口");

      await appendLedger(dir, {
        chapterId: "c001",
        kind: "author_checks",
        summary: "四维勾选通过",
        dims: {
          locks_ledger: true,
          pov_situation: true,
          style_radar: true,
          continuity_snap: true,
        },
      });
      await saveChapter(dir, {
        id: "c001",
        title: "雨前的灯",
        body: accepted.body,
        status: "final",
      });

      const ledger = await readLedger(dir);
      expect(ledger.entries.some((e) => e.kind === "style_lint")).toBe(true);
      expect(ledger.entries.some((e) => e.kind === "author_checks")).toBe(true);

      const snap = await buildPanelSnapshot(dir);
      expect(snap.totals.final).toBe(1);
      expect(snap.html).toContain("雨前的灯");

      const assembled = await assembleManuscript(dir, paths, { onlyFinal: true });
      expect(assembled.chapters).toBe(1);
      expect(await exists(assembled.file)).toBe(true);
      expect(await readFile(assembled.file, "utf8")).toContain("巷口");
      expect(meta.key).toBeTruthy();
      expect(path.basename(dir)).toBe(meta.key);
    } finally {
      await cleanup();
    }
  });

  test("refuse empty candidate at stage", async () => {
    const { dir, cleanup } = await withTempWork("空候选闸");
    try {
      await saveChapter(dir, { id: "c001", title: "一", body: "有字。", status: "drafted" });
      let stageErr: unknown;
      try {
        await stageCandidate(dir, { chapterId: "c001", body: "   \n\t  " });
      } catch (err) {
        stageErr = err;
      }
      expect((stageErr as { code: string }).code).toBe("candidate_empty");
    } finally {
      await cleanup();
    }
  });
});
