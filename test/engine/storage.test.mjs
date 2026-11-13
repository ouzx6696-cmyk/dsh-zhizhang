/** User assets: recovery, compatibility, concurrency and offline backup. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { ensureStorage } from "../../build/fanqie/src/engine/storage/paths.js";
import { createWork, assembleManuscript } from "../../build/fanqie/src/engine/work-store.js";
import { readWorkMeta } from "../../build/fanqie/src/engine/storage/work-meta.js";
import {
  readChapter,
  setOutline,
  updateChapter,
} from "../../build/fanqie/src/engine/storage/chapters.js";
import {
  readCandidate,
  stageCandidate,
  markCandidateLinted,
  acceptCandidate,
  listCandidates,
} from "../../build/fanqie/src/engine/storage/candidates.js";
import { readLedger, writeLedgerEntry } from "../../build/fanqie/src/engine/storage/ledger.js";
import { atomicWrite } from "../../build/core/src/fsx.js";
import { assertResourceId } from "../../build/fanqie/src/engine/storage/primitives.js";
import { buildPanelSnapshot } from "../../build/fanqie/src/engine/panel-query.js";
import { buildLibraryView } from "../../build/fanqie/src/engine/panel-enrich.js";
import { InspirationPort, LibraryPort } from "../../build/fanqie/src/engine/ports/index.js";
import { snapshotFile } from "../../build/fanqie/src/engine/storage/accept-journal.js";
import {
  createInspirationJournal,
  inspectPendingInspiration,
  resumePendingInspiration,
} from "../../build/fanqie/src/engine/storage/inspiration-journal.js";
import {
  createChapterJournal,
  createWorkRecordJournal,
  inspectPendingChapterSave,
  resumePendingChapterSave,
} from "../../build/fanqie/src/engine/storage/chapter-journal.js";
import {
  createSourceJournal,
  inspectPendingSource,
  resumePendingSource,
} from "../../build/fanqie/src/engine/storage/source-journal.js";
import {
  createDiscardJournal,
  resumePendingDiscard,
} from "../../build/fanqie/src/engine/storage/discard-journal.js";
import {
  createAnalysisJournal,
  resumePendingAnalysis,
} from "../../build/fanqie/src/engine/storage/analysis-journal.js";
import {
  createPlanJournal,
  resumePendingPlan,
} from "../../build/fanqie/src/engine/storage/plan-journal.js";
import {
  inspectPendingCard,
  resumePendingCard,
} from "../../build/fanqie/src/engine/storage/card-journal.js";
import {
  ensureAnalysis,
  readAnalysisBundle,
} from "../../build/fanqie/src/engine/ports/analysis/meta.js";
async function fixture() {
  const root = await mkdtemp(path.join(tmpdir(), "writer-novel-rebuild-"));
  const paths = await ensureStorage({ cwd: root }, { storageRoot: root });
  return { root, paths, close: () => rm(root, { recursive: true, force: true }) };
}
test("灵感应用中断后保护作者修改并恢复原操作", async () => {
  const f = await fixture();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "作品" });
    const { sessionId } = await InspirationPort.startSession(f.paths, { goal: "目标" });
    const { candId } = await InspirationPort.stageEmit(f.paths, sessionId, {
      kind: "foundation",
      payload: { planned: "主线" },
    });
    const metaPath = path.join(dir, "meta.json"),
      candPath = path.join(f.paths.inspiration, "candidates", `${candId}.json`);
    const oldMeta = await readFile(metaPath, "utf8"),
      oldCandidate = await readFile(candPath, "utf8");
    const nextMeta = JSON.parse(oldMeta);
    nextMeta.foundation.planned = "主线";
    const candidate = JSON.parse(oldCandidate);
    candidate.status = "accepted";
    candidate.appliedWorkKey = meta.key;
    const writes = [
      {
        target: "work",
        file: "meta.json",
        before: await snapshotFile(metaPath),
        content: JSON.stringify(nextMeta) + "\n",
      },
      {
        target: "inspiration",
        file: `candidates/${candId}.json`,
        before: await snapshotFile(candPath),
        content: JSON.stringify(candidate) + "\n",
      },
    ];
    await createInspirationJournal(f.paths, { workKey: meta.key, candidateId: candId, writes });
    await atomicWrite(metaPath, writes[0].content);
    await assert.rejects(readWorkMeta(dir), (e) => e.code === "recovery_required");
    await writeFile(candPath, "作者修改");
    assert.equal((await inspectPendingInspiration(f.paths)).conflict, true);
    await assert.rejects(
      resumePendingInspiration(f.paths),
      (e) => e.code === "inspiration_recovery_conflict",
    );
    assert.equal(await readFile(candPath, "utf8"), "作者修改");
    await atomicWrite(candPath, oldCandidate);
    await resumePendingInspiration(f.paths);
    assert.equal((await readWorkMeta(dir)).foundation.planned, "主线");
    assert.equal(JSON.parse(await readFile(candPath, "utf8")).status, "accepted");
  } finally {
    await f.close();
  }
});
test("章节、候选与留痕中断后不覆盖作者修改", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "作品" });
    await setOutline(dir, "c001", { ending: "原结尾" }, "第一章");
    const chapter = path.join(dir, "chapters", "c001.md"),
      meta = path.join(dir, "meta.json");
    const oldChapter = await readFile(chapter, "utf8"),
      oldMeta = await readFile(meta, "utf8");
    const nextMeta = JSON.parse(oldMeta);
    nextMeta.title = "改后标题";
    const writes = [
      {
        file: "chapters/c001.md",
        before: await snapshotFile(chapter),
        content: oldChapter + "新正文\n",
      },
      {
        file: "meta.json",
        before: await snapshotFile(meta),
        content: JSON.stringify(nextMeta) + "\n",
      },
    ];
    await createChapterJournal(dir, { chapterId: "c001", writes });
    await atomicWrite(chapter, writes[0].content);
    await writeFile(meta, "作者修改");
    await assert.rejects(resumePendingChapterSave(dir), (e) => e.code === "recovery_conflict");
    assert.equal(await readFile(meta, "utf8"), "作者修改");
    await atomicWrite(meta, oldMeta);
    await resumePendingChapterSave(dir);
    assert.equal((await readWorkMeta(dir)).title, "改后标题");
    assert.ok((await readFile(chapter, "utf8")).endsWith("新正文\n"));
    const ledgerPath = path.join(dir, "ledger.json"),
      crumbPath = path.join(dir, "brief-crumbs.json");
    const oldLedger = await readFile(ledgerPath, "utf8"),
      nextLedger = JSON.parse(oldLedger);
    nextLedger.entries.push({ id: "brief-record", chapterId: "c001", kind: "brief_seen" });
    const crumb = JSON.stringify({ entries: [{ chapterId: "c001", assetIds: [] }] }) + "\n";
    await createWorkRecordJournal(dir, {
      kind: "brief",
      chapterId: "c001",
      writes: [
        { file: "brief-crumbs.json", before: await snapshotFile(crumbPath), content: crumb },
        {
          file: "ledger.json",
          before: await snapshotFile(ledgerPath),
          content: JSON.stringify(nextLedger) + "\n",
        },
      ],
    });
    await atomicWrite(crumbPath, crumb);
    await writeFile(ledgerPath, "作者修改");
    await assert.rejects(resumePendingChapterSave(dir), (e) => e.code === "recovery_conflict");
    assert.equal(await readFile(ledgerPath, "utf8"), "作者修改");
    await atomicWrite(ledgerPath, oldLedger);
    await resumePendingChapterSave(dir);
    assert.equal((await readLedger(dir)).entries.filter((e) => e.id === "brief-record").length, 1);
    const id = "cand-recovery",
      bodyPath = path.join(dir, "candidates", `${id}.md`),
      candPath = path.join(dir, "candidates", `${id}.json`);
    const disk =
      JSON.stringify({
        id,
        chapterId: "c001",
        bodyFile: `${id}.md`,
        stagedAt: new Date().toISOString(),
      }) + "\n";
    await createWorkRecordJournal(dir, {
      kind: "stage",
      chapterId: "c001",
      candidateId: id,
      writes: [
        { file: `candidates/${id}.md`, before: null, content: "候选原文" },
        { file: `candidates/${id}.json`, before: null, content: disk },
      ],
    });
    await atomicWrite(bodyPath, "候选原文");
    await resumePendingChapterSave(dir);
    assert.equal((await readCandidate(dir, id)).body, "候选原文");
    const beforeLintLedger = await readFile(ledgerPath, "utf8");
    const lintLedger = JSON.parse(beforeLintLedger);
    lintLedger.entries.push({ id: "lint-record", kind: "style_lint" });
    await createWorkRecordJournal(dir, {
      kind: "lint",
      chapterId: "c001",
      candidateId: id,
      writes: [
        {
          file: `candidates/${id}.json`,
          before: await snapshotFile(candPath),
          content: JSON.stringify({ ...JSON.parse(disk), lintPassToken: "token" }) + "\n",
        },
        {
          file: "ledger.json",
          before: await snapshotFile(ledgerPath),
          content: JSON.stringify(lintLedger) + "\n",
        },
      ],
    });
    await writeFile(ledgerPath, "作者修改");
    await assert.rejects(resumePendingChapterSave(dir), (e) => e.code === "recovery_conflict");
    assert.equal(await readFile(ledgerPath, "utf8"), "作者修改");
    await atomicWrite(ledgerPath, beforeLintLedger);
    await resumePendingChapterSave(dir);
    assert.equal((await readCandidate(dir, id)).lintPassToken, "token");
  } finally {
    await f.close();
  }
});
test("书源导入和删卡恢复时保护中断后的修改", async () => {
  const f = await fixture();
  try {
    await LibraryPort.ensureLibrary(f.paths);
    const indexPath = path.join(f.paths.library, "index.json");
    const oldIndex = await readFile(indexPath, "utf8");
    const sourceId = "src-recovery";
    const nextIndex = JSON.parse(oldIndex);
    nextIndex.sources.push({ id: sourceId, title: "参考" });
    const text = "第一章 开始\n参考原文";
    await createSourceJournal(f.paths.library, {
      sourceId,
      text,
      metaContent:
        JSON.stringify({ id: sourceId, title: "参考", excerptPath: `${sourceId}.txt` }) + "\n",
      indexBefore: await snapshotFile(indexPath),
      indexContent: JSON.stringify(nextIndex) + "\n",
    });
    await atomicWrite(path.join(f.paths.library, "sources", `${sourceId}.txt`), text);
    await writeFile(indexPath, "作者修改");
    await assert.rejects(
      resumePendingSource(f.paths.library),
      (e) => e.code === "library_recovery_conflict",
    );
    assert.equal(await readFile(indexPath, "utf8"), "作者修改");
    await atomicWrite(indexPath, oldIndex);
    await resumePendingSource(f.paths.library);
    const stage = await LibraryPort.stageCard(f.paths, {
      title: "技法",
      sourceId,
      body: "分析",
      mechanisms: [{ name: "动作", experience: "e", rebuild: "r", discard: "d", failWhen: "失效" }],
    });
    const { cardId } = await LibraryPort.acceptCard(f.paths, stage.candId);
    const cardPath = path.join(f.paths.library, "cards", `${cardId}.json`),
      oldCard = await readFile(cardPath, "utf8");
    const idx = JSON.parse(await readFile(indexPath, "utf8"));
    idx.cards = idx.cards.filter((x) => x.id !== cardId);
    const content = JSON.stringify(idx) + "\n";
    await createDiscardJournal(f.paths.library, {
      cardId,
      indexBefore: await snapshotFile(indexPath),
      cardBefore: await snapshotFile(cardPath),
      indexContent: content,
    });
    await atomicWrite(indexPath, content);
    await writeFile(cardPath, "作者修改");
    await assert.rejects(
      resumePendingDiscard(f.paths.library),
      (e) => e.code === "library_recovery_conflict",
    );
    assert.equal(await readFile(cardPath, "utf8"), "作者修改");
    await atomicWrite(cardPath, oldCard);
    await resumePendingDiscard(f.paths.library);
    assert.equal((await LibraryPort.listCards(f.paths)).length, 0);
  } finally {
    await f.close();
  }
});
test("离线备份拒绝覆盖并能发现备份内容变化", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-novel-backup-"));
  try {
    const source = path.join(root, "source"),
      output = path.join(root, "backup");
    await mkdir(source);
    await writeFile(path.join(source, "chapter.md"), "作者正文");
    const run = promisify(execFile);
    const script = path.resolve("scripts/backup.mjs");
    await run(process.execPath, [script, "--source", source, "--output", output]);
    await run(process.execPath, [script, "--verify", output]);
    await writeFile(path.join(source, ".writer-write-lock-gate"), "");
    await assert.rejects(
      run(process.execPath, [
        script,
        "--source",
        source,
        "--output",
        path.join(root, "busy-backup"),
      ]),
    );
    await rm(path.join(source, ".writer-write-lock-gate"));
    await assert.rejects(run(process.execPath, [script, "--source", source, "--output", output]));
    await assert.rejects(
      run(process.execPath, [script, "--source", source, "--output", path.join(source, "inside")]),
    );
    await writeFile(path.join(output, "root-1", "chapter.md"), "备份被改动");
    await assert.rejects(run(process.execPath, [script, "--verify", output]));
    assert.equal(await readFile(path.join(source, "chapter.md"), "utf8"), "作者正文");
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
test("拆书分析恢复时保护被修改的元数据", async () => {
  const f = await fixture();
  try {
    const source = await LibraryPort.importSource(f.paths, {
      title: "参考",
      text: "第一章 开始\n原文",
    });
    await ensureAnalysis(f.paths, source.sourceId, "第一章 开始\n原文");
    const prefix = `analyses/${source.sourceId}`,
      metaPath = path.join(f.paths.library, prefix, "meta.json");
    const factsPath = path.join(f.paths.library, prefix, "chapters.jsonl");
    const oldMeta = await readFile(metaPath, "utf8"),
      nextMeta = JSON.parse(oldMeta);
    nextMeta.stage = "facts";
    const facts = JSON.stringify({ n: 1, events: [{ desc: "动作", quote: "原文" }] }) + "\n";
    await createAnalysisJournal(f.paths.library, {
      sourceId: source.sourceId,
      dataFile: "chapters.jsonl",
      writes: [
        { file: `${prefix}/chapters.jsonl`, before: await snapshotFile(factsPath), content: facts },
        {
          file: `${prefix}/meta.json`,
          before: await snapshotFile(metaPath),
          content: JSON.stringify(nextMeta) + "\n",
        },
      ],
    });
    await atomicWrite(factsPath, facts);
    await writeFile(metaPath, "作者修改");
    await assert.rejects(
      resumePendingAnalysis(f.paths.library),
      (e) => e.code === "library_recovery_conflict",
    );
    assert.equal(await readFile(metaPath, "utf8"), "作者修改");
    await atomicWrite(metaPath, oldMeta);
    await resumePendingAnalysis(f.paths.library);
    assert.equal((await readAnalysisBundle(f.paths, source.sourceId)).chapters.length, 1);
  } finally {
    await f.close();
  }
});
test("阅读计划恢复时保护被修改的确认凭据", async () => {
  const f = await fixture();
  try {
    const source = await LibraryPort.importSource(f.paths, {
      title: "参考",
      text: "第一章 开始\n原文",
    });
    await ensureAnalysis(f.paths, source.sourceId, "第一章 开始\n原文");
    const prefix = `analyses/${source.sourceId}`,
      dir = path.join(f.paths.library, prefix);
    const metaPath = path.join(dir, "meta.json"),
      tokenPath = path.join(dir, "plan-confirm.json");
    const oldMeta = JSON.parse(await readFile(metaPath, "utf8"));
    const token = JSON.stringify({ token: "confirmed" }) + "\n";
    await atomicWrite(tokenPath, token);
    const entries = [
      { file: `${prefix}/plan.json`, before: null, content: JSON.stringify({ mode: "full" }) },
      { file: `${prefix}/plan.md`, before: null, content: "全量计划\n" },
      {
        file: `${prefix}/meta.json`,
        before: await snapshotFile(metaPath),
        content: JSON.stringify({ ...oldMeta, scope: { mode: "full", chapters: 1 } }) + "\n",
      },
      { file: `${prefix}/plan-confirm.json`, before: await snapshotFile(tokenPath) },
    ];
    await createPlanJournal(f.paths.library, {
      sourceId: source.sourceId,
      clearConfirm: true,
      writes: entries,
    });
    await atomicWrite(path.join(dir, "plan.json"), entries[0].content);
    await writeFile(tokenPath, "作者修改");
    await assert.rejects(
      resumePendingPlan(f.paths.library),
      (e) => e.code === "library_recovery_conflict",
    );
    assert.equal(await readFile(tokenPath, "utf8"), "作者修改");
    await atomicWrite(tokenPath, token);
    await resumePendingPlan(f.paths.library);
    assert.equal(JSON.parse(await readFile(metaPath, "utf8")).scope.mode, "full");
    await assert.rejects(readFile(tokenPath), (e) => e.code === "ENOENT");
  } finally {
    await f.close();
  }
});
test("多个进程同时追加候选时保留正文和留痕", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "并发作品" });
    await setOutline(dir, "c001", { ending: "结束" }, "第一章");
    const ids = [];
    for (let i = 0; i < 4; i++) {
      const candidate = await stageCandidate(dir, {
        chapterId: "c001",
        body: `正文标记-${i}-结束`,
      });
      await markCandidateLinted(dir, candidate.id, 0);
      ids.push(candidate.id);
    }
    const moduleUrl = pathToFileURL(path.resolve("build/fanqie/src/engine/work-store.js")).href;
    const child = `import { acceptCandidate } from ${JSON.stringify(moduleUrl)}; await acceptCandidate(process.argv[1], process.argv[2], 'append');`;
    const run = promisify(execFile);
    await Promise.all(
      ids.map((id) => run(process.execPath, ["--input-type=module", "-e", child, dir, id])),
    );
    const chapter = await readChapter(dir, "c001");
    for (let i = 0; i < 4; i++) assert.ok(chapter.body.includes(`正文标记-${i}-结束`));
    assert.equal((await readLedger(dir)).entries.filter((e) => e.kind === "note").length, 4);
  } finally {
    await f.close();
  }
});
test("损坏资产和非法路径不会被当成空文件覆盖", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "作品" });
    const ledger = path.join(dir, "ledger.json");
    await writeFile(ledger, "{损坏");
    await assert.rejects(writeLedgerEntry(dir, { kind: "note", summary: "不可覆盖" }));
    assert.equal(await readFile(ledger, "utf8"), "{损坏");
    await LibraryPort.ensureLibrary(f.paths);
    const index = path.join(f.paths.library, "index.json");
    await writeFile(index, '{"sources":[],"cards":"坏"}');
    await assert.rejects(
      LibraryPort.importSource(f.paths, { title: "参考", text: "第一章\n内容" }),
    );
    assert.equal(await readFile(index, "utf8"), '{"sources":[],"cards":"坏"}');
    assert.throws(
      () => assertResourceId("../outside"),
      (e) => e.code === "bad_id",
    );
    assert.throws(
      () => assertResourceId("c001:stream"),
      (e) => e.code === "bad_id",
    );
    const outside = path.join(f.root, "outside");
    await mkdir(outside);
    await symlink(outside, path.join(f.root, "linked"));
    await assert.rejects(
      atomicWrite(path.join(f.root, "linked", "asset.json"), "must not write"),
      (e) => e.code === "unsafe_path",
    );
    await assert.rejects(readFile(path.join(outside, "asset.json")), (e) => e.code === "ENOENT");
    await assert.rejects(
      InspirationPort.getSession(f.paths, "../../outside"),
      (e) => e.code === "bad_id",
    );
  } finally {
    await f.close();
  }
});
test("旧章节和只改状态时保留作者正文", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "旧作品" });
    await writeFile(path.join(dir, "chapters", "c001.md"), "旧格式正文。\n第二段。");
    await setOutline(dir, "c001", { ending: "结尾" });
    await updateChapter(dir, {
      id: "c001",
      status: "reviewed",
      expectedRevision: (await readChapter(dir, "c001")).revision,
    });
    const chapter = await readChapter(dir, "c001");
    assert.equal(chapter.body, "旧格式正文。\n第二段。");
    assert.equal(chapter.outline.ending, "结尾");
    assert.equal(chapter.status, "reviewed");
  } finally {
    await f.close();
  }
});
test("候选修改后须重扫，同时采纳只能成功一次", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "作品" });
    await setOutline(dir, "c001", { ending: "结束" }, "第一章");
    const candidate = await stageCandidate(dir, { chapterId: "c001", body: "原候选正文" });
    await markCandidateLinted(dir, candidate.id, 0);
    const bodyPath = path.join(dir, "candidates", `${candidate.id}.md`);
    await writeFile(bodyPath, "修改后的候选正文");
    await assert.rejects(acceptCandidate(dir, candidate.id), (e) => e.code === "lint_required");
    await markCandidateLinted(dir, candidate.id, 0);
    const outcomes = await Promise.allSettled([
      acceptCandidate(dir, candidate.id),
      acceptCandidate(dir, candidate.id),
    ]);
    assert.equal(outcomes.filter((x) => x.status === "fulfilled").length, 1);
    const rejected = outcomes.find((x) => x.status === "rejected");
    assert.equal(rejected.reason.code, "candidate_already_accepted");
    assert.equal((await readChapter(dir, "c001")).body, "修改后的候选正文");
  } finally {
    await f.close();
  }
});
test("章节保存和书源导入发生写入故障后可恢复", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "作品" });
    await setOutline(dir, "c001", { ending: "旧结尾" }, "第一章");
    await LibraryPort.ensureLibrary(f.paths);
    const run = promisify(execFile);
    const storeUrl = pathToFileURL(path.resolve("build/fanqie/src/engine/work-store.js")).href;
    const libUrl = pathToFileURL(path.resolve("build/fanqie/src/engine/ports/library.js")).href;
    const failChapter = `
      import fs from 'node:fs'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
      const dir = process.argv[1], original = fs.promises.rename;
      fs.promises.rename = async (from, to) => { if (to === path.join(dir, 'meta.json')) throw Object.assign(new Error('simulated write failure'), { code: 'EIO' }); return original(from, to); };
      syncBuiltinESMExports(); const { setOutline } = await import(${JSON.stringify(storeUrl)});
      try { await setOutline(dir, 'c001', { ending: '新结尾' }); process.exitCode = 1; }
      catch (e) { if (e.code !== 'recovery_required') throw e; }
    `;
    await run(process.execPath, ["--input-type=module", "-e", failChapter, dir]);
    assert.equal((await inspectPendingChapterSave(dir)).conflict, false);
    await assert.rejects(readWorkMeta(dir), (e) => e.code === "recovery_required");
    await resumePendingChapterSave(dir);
    assert.equal((await readChapter(dir, "c001")).outline.ending, "新结尾");
    const failImport = `
      import fs from 'node:fs'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
      const paths = JSON.parse(process.argv[1]), original = fs.promises.rename;
      fs.promises.rename = async (from, to) => { if (to === path.join(paths.library, 'index.json')) throw Object.assign(new Error('simulated write failure'), { code: 'EIO' }); return original(from, to); };
      syncBuiltinESMExports(); const { LibraryPort } = await import(${JSON.stringify(libUrl)});
      try { await LibraryPort.importSource(paths, { title: '参考书', text: '第一章 开始\\n原文' }); process.exitCode = 1; }
      catch (e) { if (e.code !== 'library_recovery_required') throw e; }
    `;
    await run(process.execPath, ["--input-type=module", "-e", failImport, JSON.stringify(f.paths)]);
    assert.equal((await inspectPendingSource(f.paths.library)).conflict, false);
    const recovered = await resumePendingSource(f.paths.library);
    assert.equal(
      (await LibraryPort.getSource(f.paths, recovered.sourceId)).text,
      "第一章 开始\n原文",
    );
    assert.equal((await LibraryPort.listSources(f.paths)).length, 1);
  } finally {
    await f.close();
  }
});
test("卡采纳中途写入失败后恢复，重试不会生成第二张卡", async () => {
  const f = await fixture();
  try {
    const source = await LibraryPort.importSource(f.paths, {
      title: "参考",
      text: "第一章 开始\n原文",
    });
    const staged = await LibraryPort.stageCard(f.paths, {
      title: "技法",
      sourceId: source.sourceId,
      body: "分析",
      mechanisms: [{ name: "动作", experience: "e", rebuild: "r", discard: "d", failWhen: "失效" }],
    });
    const libUrl = pathToFileURL(path.resolve("build/fanqie/src/engine/ports/library.js")).href;
    const child = `
      import fs from 'node:fs'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
      const paths = JSON.parse(process.argv[1]), candidate = process.argv[2], original = fs.promises.rename;
      fs.promises.rename = async (from, to) => { if (to === path.join(paths.library, 'index.json')) throw Object.assign(new Error('simulated write failure'), { code: 'EIO' }); return original(from, to); };
      syncBuiltinESMExports(); const { LibraryPort } = await import(${JSON.stringify(libUrl)});
      try { await LibraryPort.acceptCard(paths, candidate); process.exitCode = 1; }
      catch (e) { if (e.code !== 'library_recovery_required') throw e; }
    `;
    await promisify(execFile)(process.execPath, [
      "--input-type=module",
      "-e",
      child,
      JSON.stringify(f.paths),
      staged.candId,
    ]);
    assert.equal((await inspectPendingCard(f.paths.library)).conflict, false);
    const recovered = await resumePendingCard(f.paths.library);
    assert.equal((await LibraryPort.listCards(f.paths)).length, 1);
    assert.equal((await LibraryPort.getCard(f.paths, recovered.cardId)).title, "技法");
    await assert.rejects(
      LibraryPort.acceptCard(f.paths, staged.candId),
      (e) => e.code === "candidate_already_accepted",
    );
  } finally {
    await f.close();
  }
});

test("汇编遇到坏章或缺章时保留旧成稿，输出不能指向源资产", async () => {
  const f = await fixture();
  try {
    const { dir, meta } = await createWork(f.paths, { title: "成稿" });
    await updateChapter(dir, { id: "c001", title: "第一章", body: "第一章正文" });
    await updateChapter(dir, { id: "c002", title: "第二章", body: "第二章正文" });
    const result = await assembleManuscript(dir, f.paths);
    const original = await readFile(result.file, "utf8");
    assert.ok(original.includes("第一章正文") && original.includes("第二章正文"));
    const chapter = path.join(dir, "chapters", "c002.md"),
      content = await readFile(chapter, "utf8");
    await writeFile(chapter, "---\n{坏 JSON\n---\n原文");
    await assert.rejects(
      assembleManuscript(dir, f.paths),
      (e) => e.code === "assemble_chapter_unreadable",
    );
    assert.equal(await readFile(result.file, "utf8"), original);
    await rm(chapter);
    await assert.rejects(
      assembleManuscript(dir, f.paths),
      (e) => e.code === "assemble_chapter_unreadable",
    );
    await writeFile(chapter, content);
    const metaBefore = await readFile(path.join(dir, "meta.json"), "utf8");
    await assert.rejects(
      assembleManuscript(dir, f.paths, { outputRel: `works/${meta.key}/meta.json` }),
      /越界/,
    );
    await symlink(dir, path.join(f.paths.manuscripts, "linked-work"), "junction");
    await assert.rejects(
      assembleManuscript(dir, f.paths, { outputRel: "manuscripts/linked-work/meta.json" }),
      /越界/,
    );
    assert.equal(await readFile(path.join(dir, "meta.json"), "utf8"), metaBefore);
  } finally {
    await f.close();
  }
});

test("损坏的分析形状或计划在读取和面板中明确报错", async () => {
  const f = await fixture();
  try {
    const { sourceId } = await LibraryPort.importSource(f.paths, {
      title: "参考",
      text: "第一章 开始\n原文",
    });
    await ensureAnalysis(f.paths, sourceId, "第一章 开始\n原文");
    const dir = path.join(f.paths.library, "analyses", sourceId);
    await writeFile(path.join(dir, "characters.json"), '{"损坏":"应为数组"}');
    await assert.rejects(readAnalysisBundle(f.paths, sourceId), (e) => e.code === "bad_analysis");
    await writeFile(path.join(dir, "plan.json"), "{损坏");
    await assert.rejects(buildLibraryView(f.paths));
    assert.equal(await readFile(path.join(dir, "plan.json"), "utf8"), "{损坏");
  } finally {
    await f.close();
  }
});

test("RC-05 定稿章改章纲或位置须 force，不再被静默降回 drafted", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "定稿结构" });
    await setOutline(dir, "c001", { ending: "交出钥匙" }, "第一章");
    await updateChapter(dir, { id: "c001", body: "她交出了钥匙。" });
    await updateChapter(dir, {
      id: "c001",
      status: "reviewed",
      expectedRevision: (await readChapter(dir, "c001")).revision,
    });
    await updateChapter(dir, { id: "c001", status: "final" });
    const before = await readFile(path.join(dir, "chapters/c001.md"), "utf8");
    await assert.rejects(
      setOutline(dir, "c001", { ending: "没交钥匙" }),
      (e) => e.code === "refuse_restructure_final",
    );
    await assert.rejects(
      updateChapter(dir, { id: "c001", position: 3 }),
      (e) => e.code === "refuse_restructure_final",
    );
    assert.equal(await readFile(path.join(dir, "chapters/c001.md"), "utf8"), before);
    assert.equal((await readChapter(dir, "c001")).status, "final");
    await setOutline(dir, "c001", { ending: "没交钥匙" }, undefined, { force: true });
    assert.equal((await readChapter(dir, "c001")).status, "drafted");
  } finally {
    await f.close();
  }
});

test("A-04 章节位置写入时唯一；新章排到最后一章之后；旧书的重复位置只提示不改号", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "位置" });
    await updateChapter(dir, { id: "c001", body: "一。" });
    await updateChapter(dir, { id: "c005", body: "五。", position: 5 });
    await updateChapter(dir, { id: "c006", body: "六。" });
    assert.equal((await readChapter(dir, "c006")).position, 6, "不再用 length+1 撞到第 3 位");
    await assert.rejects(
      updateChapter(dir, { id: "c002", body: "二。", position: 5 }),
      (e) => e.code === "duplicate_position",
    );
    await assert.rejects(
      updateChapter(dir, { id: "c001", position: 6 }),
      (e) => e.code === "duplicate_position",
    );
    // a legacy book with a duplicate still opens and saves, and the panel reports it
    const metaFile = path.join(dir, "meta.json");
    const meta = JSON.parse(await readFile(metaFile, "utf8"));
    meta.chapters.find((c) => c.id === "c006").position = 5;
    await writeFile(metaFile, JSON.stringify(meta));
    const chapterFile = path.join(dir, "chapters", "c006.md");
    await writeFile(
      chapterFile,
      (await readFile(chapterFile, "utf8")).replace(/"position": 6/, '"position": 5'),
    );
    await updateChapter(dir, { id: "c006", body: "六，改。" });
    const snapshot = await buildPanelSnapshot(dir, f.paths);
    assert.ok(
      snapshot.nextHints.some((h) => h.includes("章节位置重复")),
      snapshot.nextHints.join("\n"),
    );
  } finally {
    await f.close();
  }
});

test("完整修订保留原稿，旧候选不覆盖新稿并提示接续核对", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "修订链" });
    await setOutline(dir, "c001", { ending: "交出钥匙" }, "第一章");
    await updateChapter(dir, { id: "c001", body: "她交出了钥匙。" });
    await setOutline(dir, "c002", { ending: "进门" }, "第二章");
    const stale = await stageCandidate(dir, { chapterId: "c001", body: "旧候选。" });
    await markCandidateLinted(dir, stale.id, 0);
    await updateChapter(dir, {
      id: "c001",
      status: "reviewed",
      expectedRevision: (await readChapter(dir, "c001")).revision,
    });
    await updateChapter(dir, { id: "c001", status: "final" });
    const original = await readFile(path.join(dir, "chapters/c001.md"));
    const revision = (await readChapter(dir, "c001")).revision;
    await assert.rejects(
      updateChapter(dir, { id: "c001", body: "她拒绝交出钥匙。" }),
      (e) => e.code === "refuse_overwrite_final",
    );
    await updateChapter(dir, {
      id: "c001",
      body: "她拒绝交出钥匙。",
      force: true,
      expectedRevision: revision,
    });
    assert.equal((await readChapter(dir, "c001")).status, "drafted");
    const meta = await readWorkMeta(dir),
      impact = meta.revisionImpacts.at(-1);
    assert.equal(impact.nextChapterId, "c002");
    assert.deepEqual(await readFile(path.join(dir, impact.history)), original);
    await assert.rejects(acceptCandidate(dir, stale.id), (e) => e.code === "revision_conflict");
    await updateChapter(dir, {
      id: "c001",
      acknowledgeRevision: true,
      expectedRevision: (await readChapter(dir, "c001")).revision,
    });
    assert.equal(
      (await readWorkMeta(dir)).revisionImpacts.some((impact) => impact.chapterId === "c001"),
      false,
    );
  } finally {
    await f.close();
  }
});

test("定稿章改章纲或顺序（经 force 确认）会降回草稿并失效审读", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "定稿章纲" });
    await setOutline(dir, "c001", { ending: "交出钥匙" }, "第一章");
    await updateChapter(dir, { id: "c001", body: "她交出了钥匙。" });
    const first = await readChapter(dir, "c001");
    await updateChapter(dir, { id: "c001", status: "reviewed", expectedRevision: first.revision });
    const reviewed = await readChapter(dir, "c001");
    await updateChapter(dir, { id: "c001", status: "final", expectedRevision: reviewed.revision });
    const final = await readChapter(dir, "c001");
    assert.equal(final.status, "final");

    // RC-05: since 1.1.1 a structure change on a final chapter needs force (author-confirmed).
    await setOutline(dir, "c001", { ending: "拒绝交出钥匙" }, undefined, { force: true });
    const changed = await readChapter(dir, "c001");
    assert.equal(changed.status, "drafted", "定稿章改章纲必须降回草稿");
    assert.notEqual(changed.revision, final.revision);
    assert.notEqual(changed.review?.revision, changed.revision, "旧审读不能覆盖新版本");
    await assert.rejects(updateChapter(dir, { id: "c001", status: "final" }), /审读/);

    await updateChapter(dir, {
      id: "c001",
      status: "reviewed",
      expectedRevision: changed.revision,
    });
    const again = await readChapter(dir, "c001");
    await updateChapter(dir, { id: "c001", status: "final", expectedRevision: again.revision });
    const positioned = await readChapter(dir, "c001");
    await updateChapter(dir, { id: "c001", position: positioned.position + 1, force: true });
    const moved = await readChapter(dir, "c001");
    assert.equal(moved.status, "drafted", "定稿章改顺序必须降回草稿");
    assert.notEqual(moved.revision, positioned.revision);
  } finally {
    await f.close();
  }
});

test("只有章纲的章第一次写正文不记修订；之后再改正文才记一条", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "首写" });
    await setOutline(dir, "c001", { ending: "交出钥匙" }, "第一章");
    await setOutline(dir, "c002", { ending: "进门" }, "第二章");
    await updateChapter(dir, { id: "c001", body: "她交出了钥匙。" });
    await updateChapter(dir, { id: "c002", body: "他推门进去。" });
    assert.deepEqual((await readWorkMeta(dir)).revisionImpacts ?? [], []);
    await assert.rejects(readdir(path.join(dir, "revisions")), { code: "ENOENT" });
    await updateChapter(dir, { id: "c001", body: "她犹豫后交出了钥匙。" });
    const impacts = (await readWorkMeta(dir)).revisionImpacts;
    assert.equal(impacts.length, 1);
    assert.equal(impacts[0].chapterId, "c001");
    assert.deepEqual(await readdir(path.join(dir, "revisions", "c001")), [
      path.basename(impacts[0].history),
    ]);
  } finally {
    await f.close();
  }
});
test("直接保存先核账本，中断后正文、目录和留痕一并恢复", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "共同提交" });
    await setOutline(dir, "c001", {}, "一");
    await writeFile(path.join(dir, "ledger.json"), "{broken");
    await assert.rejects(updateChapter(dir, { id: "c001", body: "不能写进去" }));
    assert.equal((await readChapter(dir, "c001")).body, "");
    await writeFile(
      path.join(dir, "ledger.json"),
      JSON.stringify({ schemaVersion: 1, entries: [] }),
    );
    const storeUrl = pathToFileURL(path.resolve("build/fanqie/src/engine/work-store.js")).href;
    const child = `
            import fs from 'node:fs'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
            const dir = process.argv[1], original = fs.promises.rename;
            fs.promises.rename = async (from, to) => { if (to === path.join(dir, 'ledger.json')) throw Object.assign(new Error('interrupted ledger'), { code: 'EIO' }); return original(from, to); };
            syncBuiltinESMExports(); const { updateChapter } = await import(${JSON.stringify(storeUrl)});
            try { await updateChapter(dir, { id: 'c001', body: '恢复后的实际正文' }); throw new Error('expected failure'); }
            catch (e) { if (e.code !== 'recovery_required') throw e; }
        `;
    await promisify(execFile)(process.execPath, ["--input-type=module", "-e", child, dir]);
    assert.equal((await inspectPendingChapterSave(dir)).writes.length, 3);
    await resumePendingChapterSave(dir);
    assert.equal((await readChapter(dir, "c001")).body, "恢复后的实际正文");
    const entry = (await readLedger(dir)).entries.at(-1);
    assert.equal(entry.kind, "chapter_save_direct");
    assert.equal(typeof entry.id, "string");
    assert.ok(entry.id.length > 0);
  } finally {
    await f.close();
  }
});

test("坏候选保持可见且面板明确报告不可读", async () => {
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "可见错误" });
    await setOutline(dir, "c001", {}, "一");
    const cand = await stageCandidate(dir, { chapterId: "c001", body: "保留的正文" });
    await writeFile(path.join(dir, "candidates", cand.id + ".json"), "{broken");
    const invalid = await stageCandidate(dir, { chapterId: "c001", body: "结构损坏也需报告" });
    const invalidPath = path.join(dir, "candidates", invalid.id + ".json");
    const invalidMeta = JSON.parse(await readFile(invalidPath, "utf8"));
    await writeFile(invalidPath, JSON.stringify({ ...invalidMeta, chapterId: "../outside" }));
    await assert.rejects(readCandidate(dir, invalid.id));
    const missing = await stageCandidate(dir, { chapterId: "c001", body: "正文不能静默消失" });
    await rm(path.join(dir, "candidates", missing.bodyFile));
    const rows = await listCandidates(dir);
    assert.equal(rows.length, 3);
    assert.ok(rows.every((row) => row.unavailable === true));
    assert.ok(rows.some((row) => row.id === cand.id));
    assert.equal(rows[0].unavailable, true);
    const snapshot = await buildPanelSnapshot(dir, f.paths);
    assert.equal(snapshot.candidates[0].unavailable, true);
    assert.ok(snapshot.nextHints.some((h) => h.includes("不可读")));
  } finally {
    await f.close();
  }
});

test("人工修订使用捕获依据，扫描采纳保留去重来源，节奏变化拒绝应用", async () => {
  const { withWork } = await import("./helpers.mjs");
  const { diagnose, stageRevisionCandidate, bodyHash } =
    await import("../../build/fanqie/src/engine/services/diagnostics.js");
  const { recordBriefBreadcrumb, setFoundation, updateChapter } =
    await import("../../build/fanqie/src/engine/work-store.js");
  const { currentContextBasis } = await import("../../build/fanqie/src/engine/storage/chapters.js");
  const work = await withWork("020 来源闭环");
  try {
    await updateChapter(work.dir, { id: "c001", title: "一", body: "旧正文。" });
    await recordBriefBreadcrumb(work.dir, {
      chapterId: "c001",
      assetIds: [],
      basis: await currentContextBasis(work.dir, "c001"),
    });
    await updateChapter(work.dir, { id: "c001", title: "一", body: "他不禁退后。" });
    const chapter = await readChapter(work.dir, "c001");
    const report = await diagnose(work.dir, {
      kind: "chapter",
      chapter: "c001",
      expectedRevision: chapter.revision,
      bodyHash: bodyHash(chapter.body),
    });
    const input = {
      source: report.source,
      confirm: true,
      requestId: "roundtrip-revision",
      edits: [{ ...report.blocks[0], before: chapter.body, after: "他退到门边。" }],
    };
    const staged = await stageRevisionCandidate(work.dir, input);
    await markCandidateLinted(work.dir, staged.candidateId, 0);
    await acceptCandidate(work.dir, staged.candidateId);
    const saved = await readCandidate(work.dir, staged.candidateId);
    assert.equal(saved.revisionSource.requestId, input.requestId);
    assert.equal(saved.revisionSource.source.bodyHash, report.source.bodyHash);
    assert.equal((await stageRevisionCandidate(work.dir, input)).candidateId, saved.id);
    assert.equal((await readChapter(work.dir, "c001")).body, "他退到门边。");
    const now = await readChapter(work.dir, "c001");
    const next = await diagnose(work.dir, {
      kind: "chapter",
      chapter: "c001",
      expectedRevision: now.revision,
      bodyHash: bodyHash(now.body),
    });
    const pending = await stageRevisionCandidate(work.dir, {
      source: next.source,
      confirm: true,
      requestId: "pace-revision-test",
      edits: [{ ...next.blocks[0], before: now.body, after: "他仍停在门边。" }],
    });
    await setFoundation(work.dir, {}, { pace: "慢燃" });
    await assert.rejects(
      acceptCandidate(work.dir, pending.candidateId),
      (e) => e.code === "context_changed",
    );
  } finally {
    await work.cleanup();
  }
});

test("CRLF 章节保留正文原始换行，快照读取实际文件元数据", async () => {
  const { withWork } = await import("./helpers.mjs");
  const { updateChapter } = await import("../../build/fanqie/src/engine/work-store.js");
  const work = await withWork("CRLF 兼容");
  try {
    await updateChapter(work.dir, { id: "c001", title: "原题", body: "第一段。\n第二段。" });
    const file = path.join(work.dir, "chapters", "c001.md");
    const raw = (await readFile(file, "utf8")).replace(/\n/g, "\r\n").replace("原题", "文件中改题");
    await writeFile(file, raw);
    const chapter = await readChapter(work.dir, "c001");
    assert.equal(chapter.title, "文件中改题");
    assert.equal(chapter.body, "第一段。\r\n第二段。");
    await updateChapter(work.dir, {
      id: "c001",
      status: "drafted",
      expectedRevision: chapter.revision,
    });
    assert.equal((await readChapter(work.dir, "c001")).body, chapter.body);
    const snapshot = await buildPanelSnapshot(work.dir, work.paths);
    assert.equal(snapshot.chapters[0].title, "文件中改题");
    assert.equal(snapshot.chapters[0].wordCount, chapter.wordCount);
    assert.equal(snapshot.totals.words, chapter.wordCount);
  } finally {
    await work.cleanup();
  }
});

test("T130 拒绝的定稿不生成快照，索引不保存摘录且章尾不切断字符", async () => {
  const { readdir } = await import("node:fs/promises");
  const { chapterTail } = await import("../../build/fanqie/src/engine/storage/chapters.js");
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "按需章尾" });
    for (const id of ["c001", "c002", "c003"]) {
      await setOutline(dir, id, { targetWords: 100, pov: "林川" }, id);
      await updateChapter(dir, { id, body: "正文😀😀😀" });
    }
    assert.doesNotMatch(await readFile(path.join(dir, "meta.json"), "utf8"), /"excerpt"/);
    assert.equal(await chapterTail(dir, "c001", 2), "😀😀");
    const count = () =>
      readdir(path.join(dir, ".writer-snapshots")).then(
        (entries) => entries.length,
        (error) => {
          if (error.code === "ENOENT") return 0;
          throw error;
        },
      );
    const before = await count();
    let ch = await readChapter(dir, "c001");
    await assert.rejects(
      updateChapter(dir, { id: "c001", status: "final", expectedRevision: ch.revision }),
      /审读/,
    );
    assert.equal(await count(), before);
    await updateChapter(dir, { id: "c001", status: "reviewed", expectedRevision: ch.revision });
    ch = await readChapter(dir, "c001");
    await updateChapter(dir, { id: "c001", status: "final", expectedRevision: ch.revision });
    assert.equal(await count(), before + 1);
  } finally {
    await f.close();
  }
});
test("T130 二十章元数据不随正文长度膨胀", async () => {
  const f = await fixture();
  try {
    const sizes = [];
    for (const length of [3000, 30000]) {
      const { dir } = await createWork(f.paths, {
        title: "体积验证",
        key: length === 3000 ? "small" : "large",
      });
      for (let n = 1; n <= 20; n++) {
        const id = `c${String(n).padStart(3, "0")}`;
        await setOutline(dir, id, { targetWords: 3000, pov: "林川" }, id);
        await updateChapter(dir, { id, body: "文".repeat(length) });
      }
      sizes.push(Buffer.byteLength(await readFile(path.join(dir, "meta.json"), "utf8")));
    }
    assert.equal(sizes[1] - sizes[0], 20, "每章 wordCount 增加一位数字；正文不进入 meta");
  } finally {
    await f.close();
  }
});

test("T131 200 候选冷热列表等价，外部改写和删除即时可见", async () => {
  const { readJsonCached } = await import("../../build/fanqie/src/engine/file-cache.js");
  const f = await fixture();
  try {
    const { dir } = await createWork(f.paths, { title: "候选缓存" });
    await setOutline(dir, "c001", {}, "一");
    const sample = await stageCandidate(dir, { chapterId: "c001", body: "候选正文" });
    const folder = path.join(dir, "candidates");
    const template = JSON.parse(await readFile(path.join(folder, sample.id + ".json"), "utf8"));
    for (let n = 0; n < 200; n++) {
      const id = `cand-${String(n).padStart(3, "0")}`;
      await writeFile(path.join(folder, id + ".md"), "候选正文");
      await writeFile(
        path.join(folder, id + ".json"),
        JSON.stringify({
          ...template,
          id,
          bodyFile: id + ".md",
          stagedAt: new Date(1700000000000 + n).toISOString(),
        }),
      );
    }
    const cold = await listCandidates(dir);
    assert.equal(cold.length, 201);
    assert.deepEqual(await listCandidates(dir), cold);
    const file = path.join(folder, "cand-000.json"),
      first = await readJsonCached(file);
    first.title = "缓存污染";
    assert.notEqual((await readJsonCached(file)).title, "缓存污染");
    await writeFile(file, JSON.stringify({ ...first, title: "外部更新" }));
    let rows = await listCandidates(dir);
    assert.equal(rows.find((row) => row.id === "cand-000").title, "外部更新");
    assert.notEqual(
      rows.find((row) => row.id === "cand-000").readVersion,
      cold.find((row) => row.id === "cand-000").readVersion,
    );
    await rm(path.join(folder, "cand-000.md"));
    rows = await listCandidates(dir);
    assert.equal(rows.find((row) => row.id === "cand-000").unavailable, true);
  } finally {
    await f.close();
  }
});

test("缓存重试读取期间的文件替换，JSONL 嵌套数据不能污染缓存", async () => {
  const fs = await import("node:fs/promises"),
    { syncBuiltinESMExports } = await import("node:module");
  const { readJsonCachedWithStat, readJsonlCached } =
    await import("../../build/fanqie/src/engine/file-cache.js");
  const f = await fixture(),
    original = fs.default.readFile;
  try {
    const file = path.join(f.root, "race.json");
    await writeFile(file, '{"value":"old"}');
    let replaced = false;
    fs.default.readFile = async (...args) => {
      const text = await original(...args);
      if (args[0] === file && !replaced) {
        replaced = true;
        await writeFile(file, '{"value":"new and longer"}');
      }
      return text;
    };
    syncBuiltinESMExports();
    const result = await readJsonCachedWithStat(file);
    assert.equal(result.value.value, "new and longer");
    assert.equal(result.identity[3], (await fs.stat(file)).size);
    const lines = path.join(f.root, "nested.jsonl");
    await writeFile(lines, '{"nested":{"value":"original"}}\n');
    const rows = await readJsonlCached(lines);
    rows[0].nested.value = "changed";
    assert.equal((await readJsonlCached(lines))[0].nested.value, "original");
  } finally {
    fs.default.readFile = original;
    syncBuiltinESMExports();
    await f.close();
  }
});
