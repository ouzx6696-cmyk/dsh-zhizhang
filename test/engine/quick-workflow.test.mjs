import { test } from "node:test";
import assert from "node:assert/strict";
import { rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { BOOK, setup, id, cardInput } from "./workflow-fixture.mjs";
import { LibraryPort, InspirationPort } from "../../build/fanqie/src/engine/ports/index.js";
import { resolveWorkDir } from "../../build/fanqie/src/engine/work-store.js";
import { readChapter } from "../../build/fanqie/src/engine/storage/chapters.js";
import { readWorkMeta } from "../../build/fanqie/src/engine/storage/work-meta.js";

test("拆书证据经明确采纳进入规划，正文经扫描采纳后供续章使用", async () => {
  const f = await setup();
  try {
    const originalFile = path.join(f.root, "original.txt");
    await writeFile(originalFile, BOOK);
    const { sourceId } = await LibraryPort.importSource(f.paths, {
      title: "参考书",
      file: originalFile,
    });
    await rm(originalFile);
    const fact = await f.run("fanqie_library_facts_stage", {
      source: sourceId,
      facts: {
        n: 1,
        events: [{ desc: "盘点少了三罐", quote: "屏幕上的数字比昨天少了三罐咖啡" }],
        readingLevel: "正文已读",
      },
    });
    assert.match(fact, /已记录 1 章/);
    const candidate = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
    const { cardId } = await LibraryPort.acceptCard(f.paths, candidate.candId);
    const card = await LibraryPort.getCard(f.paths, cardId);
    assert.equal(card.readingEvidence.chapters[0].readingLevel, "正文已读");
    assert.match(card.readingEvidence.note, /不证明/);
    await assert.rejects(
      LibraryPort.acceptCard(f.paths, candidate.candId),
      (e) => e.code === "candidate_already_accepted",
    );
    const combo = await LibraryPort.suggestCombo(f.paths);
    assert.equal(combo.ok, true);
    assert.equal(combo.mind, null);
    assert.ok(combo.cardIds.includes(cardId));
    assert.match(await f.run("fanqie_library_combo_suggest"), new RegExp(cardId));
    const session = await InspirationPort.startSession(f.paths, {
      goal: "新故事",
      cardIds: [cardId],
      pace: "慢燃",
    });
    const foundation = await InspirationPort.stageEmit(f.paths, session.sessionId, {
      kind: "foundation",
      payload: { planned: "追查差数" },
    });
    await InspirationPort.acceptEmit(f.paths, foundation.candId, { workKey: "新作", apply: true });
    const outline = await InspirationPort.stageEmit(f.paths, session.sessionId, {
      kind: "outline",
      payload: { chapter: "c001", title: "第一章", ending: "她把门推开。" },
    });
    await InspirationPort.acceptEmit(f.paths, outline.candId, { workKey: "新作", apply: true });
    const dir = await resolveWorkDir(f.paths, "新作");
    assert.equal((await readWorkMeta(dir)).pace, "慢燃");
    const handoff = JSON.parse(
      await f.run("fanqie_chapter_brief", { work: "新作", chapter: "c001", handoff_only: true }),
    );
    assert.ok(handoff.references.assets.includes("card:" + cardId));
    assert.match(handoff.references.content, /其他可核对的差异/);
    assert.equal(handoff.requiresBodyRead, true);
    await f.run("fanqie_chapter_brief", { work: "新作", chapter: "c001" });
    const body = "夜班第七天，她查完账，把门推开。";
    const staged = await f.run("fanqie_candidate_stage", {
      work: "新作",
      chapter: "c001",
      content: body,
    });
    const candId = id(staged, /(cand-[a-z0-9]+)/);

    await f.run("fanqie_payoff_audit", {
      work: "新作",
      chapter: "c001",
      text: "另一版正文，他把门关上。",
    });
    assert.match(
      await f.run("fanqie_candidate_accept", {
        work: "新作",
        candidate: candId,
        require_payoff: true,
      }),
      /payoff_missing/,
    );
    assert.match(
      await f.run("fanqie_candidate_accept", { work: "新作", candidate: candId }),
      /已采纳/,
    );
    assert.equal((await readChapter(dir, "c001")).body, body);
    await f.run("fanqie_outline_set", { work: "新作", chapter: "c002", ending: "他翻开账本。" });
    assert.ok(
      (await f.run("fanqie_chapter_brief", { work: "新作", chapter: "c002" })).includes(body),
    );
  } finally {
    await f.close();
  }
});
