/** User assets: recovery, compatibility, concurrency and offline backup. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, rm, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import { pathToFileURL } from "node:url";
import { ensureStorage, createWork, readWorkMeta, readChapter, readCandidate, readLedger, setOutline, stageCandidate, markCandidateLinted, atomicWrite, appendLedger, updateChapter, acceptCandidate, assertResourceId, assembleManuscript, listCandidates, buildPanelSnapshot } from "../dist/lib/store.js";
import { buildLibraryView } from "../dist/lib/panel-enrich.js";
import { InspirationPort, LibraryPort } from "../dist/lib/ports/index.js";
import { snapshotFile } from "../dist/lib/storage/accept-journal.js";
import { createInspirationJournal, inspectPendingInspiration, resumePendingInspiration } from "../dist/lib/storage/inspiration-journal.js";
import { createChapterJournal, createWorkRecordJournal, inspectPendingChapterSave, resumePendingChapterSave } from "../dist/lib/storage/chapter-journal.js";
import { createSourceJournal, inspectPendingSource, resumePendingSource } from "../dist/lib/storage/source-journal.js";
import { createDiscardJournal, resumePendingDiscard } from "../dist/lib/storage/discard-journal.js";
import { createAnalysisJournal, resumePendingAnalysis } from "../dist/lib/storage/analysis-journal.js";
import { createPlanJournal, resumePendingPlan } from "../dist/lib/storage/plan-journal.js";
import { inspectPendingCard, resumePendingCard } from "../dist/lib/storage/card-journal.js";
import { ensureAnalysis, readAnalysisBundle } from "../dist/lib/ports/analysis.js";
async function fixture() {
    const root = await mkdtemp(path.join(tmpdir(), "zhizhang-rebuild-"));
    const paths = await ensureStorage({}, { storageRoot: root });
    return { root, paths, close: () => rm(root, { recursive: true, force: true }) };
}
test("灵感应用中断后保护作者修改并恢复原操作", async () => {
    const f = await fixture();
    try {
        const { dir, meta } = await createWork(f.paths, { title: "作品" });
        const { sessionId } = await InspirationPort.startSession(f.paths, { goal: "目标" });
        const { candId } = await InspirationPort.stageEmit(f.paths, sessionId, { kind: "foundation", payload: { planned: "主线" } });
        const metaPath = path.join(dir, "meta.json"), candPath = path.join(f.paths.inspiration, "candidates", `${candId}.json`);
        const oldMeta = await readFile(metaPath, "utf8"), oldCandidate = await readFile(candPath, "utf8");
        const nextMeta = JSON.parse(oldMeta);
        nextMeta.foundation.planned = "主线";
        const candidate = JSON.parse(oldCandidate);
        candidate.status = "accepted";
        candidate.appliedWorkKey = meta.key;
        const writes = [
            { target: "work", file: "meta.json", before: await snapshotFile(metaPath), content: JSON.stringify(nextMeta) + "\n" },
            { target: "inspiration", file: `candidates/${candId}.json`, before: await snapshotFile(candPath), content: JSON.stringify(candidate) + "\n" },
        ];
        await createInspirationJournal(f.paths, { workKey: meta.key, candidateId: candId, writes });
        await atomicWrite(metaPath, writes[0].content);
        await assert.rejects(readWorkMeta(dir), (e) => e.code === "recovery_required");
        await writeFile(candPath, "作者修改");
        assert.equal((await inspectPendingInspiration(f.paths)).conflict, true);
        await assert.rejects(resumePendingInspiration(f.paths), (e) => e.code === "inspiration_recovery_conflict");
        assert.equal(await readFile(candPath, "utf8"), "作者修改");
        await atomicWrite(candPath, oldCandidate);
        await resumePendingInspiration(f.paths);
        assert.equal((await readWorkMeta(dir)).foundation.planned, "主线");
        assert.equal(JSON.parse(await readFile(candPath, "utf8")).status, "accepted");
    }
    finally {
        await f.close();
    }
});
test("章节、候选与留痕中断后不覆盖作者修改", async () => {
    const f = await fixture();
    try {
        const { dir } = await createWork(f.paths, { title: "作品" });
        await setOutline(dir, "c001", { ending: "原结尾" }, "第一章");
        const chapter = path.join(dir, "chapters", "c001.md"), meta = path.join(dir, "meta.json");
        const oldChapter = await readFile(chapter, "utf8"), oldMeta = await readFile(meta, "utf8");
        const nextMeta = JSON.parse(oldMeta);
        nextMeta.title = "改后标题";
        const writes = [
            { file: "chapters/c001.md", before: await snapshotFile(chapter), content: oldChapter + "新正文\n" },
            { file: "meta.json", before: await snapshotFile(meta), content: JSON.stringify(nextMeta) + "\n" },
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
        const ledgerPath = path.join(dir, "ledger.json"), crumbPath = path.join(dir, "brief-crumbs.json");
        const oldLedger = await readFile(ledgerPath, "utf8"), nextLedger = JSON.parse(oldLedger);
        nextLedger.entries.push({ id: "brief-record", chapterId: "c001", kind: "brief_seen" });
        const crumb = JSON.stringify({ entries: [{ chapterId: "c001", assetIds: [] }] }) + "\n";
        await createWorkRecordJournal(dir, { kind: "brief", chapterId: "c001", writes: [
                { file: "brief-crumbs.json", before: await snapshotFile(crumbPath), content: crumb },
                { file: "ledger.json", before: await snapshotFile(ledgerPath), content: JSON.stringify(nextLedger) + "\n" },
            ] });
        await atomicWrite(crumbPath, crumb);
        await writeFile(ledgerPath, "作者修改");
        await assert.rejects(resumePendingChapterSave(dir), (e) => e.code === "recovery_conflict");
        assert.equal(await readFile(ledgerPath, "utf8"), "作者修改");
        await atomicWrite(ledgerPath, oldLedger);
        await resumePendingChapterSave(dir);
        assert.equal((await readLedger(dir)).entries.filter((e) => e.id === "brief-record").length, 1);
        const id = "cand-recovery", bodyPath = path.join(dir, "candidates", `${id}.md`), candPath = path.join(dir, "candidates", `${id}.json`);
        const disk = JSON.stringify({ id, chapterId: "c001", bodyFile: `${id}.md`, stagedAt: new Date().toISOString() }) + "\n";
        await createWorkRecordJournal(dir, { kind: "stage", chapterId: "c001", candidateId: id, writes: [
                { file: `candidates/${id}.md`, before: null, content: "候选原文" },
                { file: `candidates/${id}.json`, before: null, content: disk },
            ] });
        await atomicWrite(bodyPath, "候选原文");
        await resumePendingChapterSave(dir);
        assert.equal((await readCandidate(dir, id)).body, "候选原文");
        const beforeLintLedger = await readFile(ledgerPath, "utf8");
        const lintLedger = JSON.parse(beforeLintLedger);
        lintLedger.entries.push({ id: "lint-record", kind: "style_lint" });
        await createWorkRecordJournal(dir, { kind: "lint", chapterId: "c001", candidateId: id, writes: [
                { file: `candidates/${id}.json`, before: await snapshotFile(candPath), content: JSON.stringify({ ...JSON.parse(disk), lintPassToken: "token" }) + "\n" },
                { file: "ledger.json", before: await snapshotFile(ledgerPath), content: JSON.stringify(lintLedger) + "\n" },
            ] });
        await writeFile(ledgerPath, "作者修改");
        await assert.rejects(resumePendingChapterSave(dir), (e) => e.code === "recovery_conflict");
        assert.equal(await readFile(ledgerPath, "utf8"), "作者修改");
        await atomicWrite(ledgerPath, beforeLintLedger);
        await resumePendingChapterSave(dir);
        assert.equal((await readCandidate(dir, id)).lintPassToken, "token");
    }
    finally {
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
        await createSourceJournal(f.paths.library, { sourceId, text, metaContent: JSON.stringify({ id: sourceId, title: "参考", excerptPath: `${sourceId}.txt` }) + "\n", indexBefore: (await snapshotFile(indexPath)), indexContent: JSON.stringify(nextIndex) + "\n" });
        await atomicWrite(path.join(f.paths.library, "sources", `${sourceId}.txt`), text);
        await writeFile(indexPath, "作者修改");
        await assert.rejects(resumePendingSource(f.paths.library), (e) => e.code === "library_recovery_conflict");
        assert.equal(await readFile(indexPath, "utf8"), "作者修改");
        await atomicWrite(indexPath, oldIndex);
        await resumePendingSource(f.paths.library);
        const stage = await LibraryPort.stageCard(f.paths, { title: "技法", sourceId, body: "分析", mechanisms: [{ name: "动作", experience: "e", rebuild: "r", discard: "d", failWhen: "失效" }] });
        const { cardId } = await LibraryPort.acceptCard(f.paths, stage.candId);
        const cardPath = path.join(f.paths.library, "cards", `${cardId}.json`), oldCard = await readFile(cardPath, "utf8");
        const idx = JSON.parse(await readFile(indexPath, "utf8"));
        idx.cards = idx.cards.filter((x) => x.id !== cardId);
        const content = JSON.stringify(idx) + "\n";
        await createDiscardJournal(f.paths.library, { cardId, indexBefore: (await snapshotFile(indexPath)), cardBefore: await snapshotFile(cardPath), indexContent: content });
        await atomicWrite(indexPath, content);
        await writeFile(cardPath, "作者修改");
        await assert.rejects(resumePendingDiscard(f.paths.library), (e) => e.code === "library_recovery_conflict");
        assert.equal(await readFile(cardPath, "utf8"), "作者修改");
        await atomicWrite(cardPath, oldCard);
        await resumePendingDiscard(f.paths.library);
        assert.equal((await LibraryPort.listCards(f.paths)).length, 0);
    }
    finally {
        await f.close();
    }
});
test("离线备份拒绝覆盖并能发现备份内容变化", async () => {
    const root = await mkdtemp(path.join(tmpdir(), "zhizhang-backup-"));
    try {
        const source = path.join(root, "source"), output = path.join(root, "backup");
        await mkdir(source);
        await writeFile(path.join(source, "chapter.md"), "作者正文");
        const run = promisify(execFile);
        const script = path.resolve("scripts/backup.mjs");
        await run(process.execPath, [script, "--source", source, "--output", output]);
        await run(process.execPath, [script, "--verify", output]);
        await assert.rejects(run(process.execPath, [script, "--source", source, "--output", output]));
        await assert.rejects(run(process.execPath, [script, "--source", source, "--output", path.join(source, "inside")]));
        await writeFile(path.join(output, "root-1", "chapter.md"), "备份被改动");
        await assert.rejects(run(process.execPath, [script, "--verify", output]));
        assert.equal(await readFile(path.join(source, "chapter.md"), "utf8"), "作者正文");
    }
    finally {
        await rm(root, { recursive: true, force: true });
    }
});
test("拆书分析恢复时保护被修改的元数据", async () => {
    const f = await fixture();
    try {
        const source = await LibraryPort.importSource(f.paths, { title: "参考", text: "第一章 开始\n原文" });
        await ensureAnalysis(f.paths, source.sourceId, "第一章 开始\n原文");
        const prefix = `analyses/${source.sourceId}`, metaPath = path.join(f.paths.library, prefix, "meta.json");
        const factsPath = path.join(f.paths.library, prefix, "chapters.jsonl");
        const oldMeta = await readFile(metaPath, "utf8"), nextMeta = JSON.parse(oldMeta);
        nextMeta.stage = "facts";
        const facts = JSON.stringify({ n: 1, events: [{ desc: "动作", quote: "原文" }] }) + "\n";
        await createAnalysisJournal(f.paths.library, { sourceId: source.sourceId, dataFile: "chapters.jsonl", writes: [
                { file: `${prefix}/chapters.jsonl`, before: await snapshotFile(factsPath), content: facts },
                { file: `${prefix}/meta.json`, before: await snapshotFile(metaPath), content: JSON.stringify(nextMeta) + "\n" },
            ] });
        await atomicWrite(factsPath, facts);
        await writeFile(metaPath, "作者修改");
        await assert.rejects(resumePendingAnalysis(f.paths.library), (e) => e.code === "library_recovery_conflict");
        assert.equal(await readFile(metaPath, "utf8"), "作者修改");
        await atomicWrite(metaPath, oldMeta);
        await resumePendingAnalysis(f.paths.library);
        assert.equal((await readAnalysisBundle(f.paths, source.sourceId)).chapters.length, 1);
    }
    finally {
        await f.close();
    }
});
test("阅读计划恢复时保护被修改的确认凭据", async () => {
    const f = await fixture();
    try {
        const source = await LibraryPort.importSource(f.paths, { title: "参考", text: "第一章 开始\n原文" });
        await ensureAnalysis(f.paths, source.sourceId, "第一章 开始\n原文");
        const prefix = `analyses/${source.sourceId}`, dir = path.join(f.paths.library, prefix);
        const metaPath = path.join(dir, "meta.json"), tokenPath = path.join(dir, "plan-confirm.json");
        const oldMeta = JSON.parse(await readFile(metaPath, "utf8"));
        const token = JSON.stringify({ token: "confirmed" }) + "\n";
        await atomicWrite(tokenPath, token);
        const entries = [
            { file: `${prefix}/plan.json`, before: null, content: JSON.stringify({ mode: "full" }) },
            { file: `${prefix}/plan.md`, before: null, content: "全量计划\n" },
            { file: `${prefix}/meta.json`, before: await snapshotFile(metaPath), content: JSON.stringify({ ...oldMeta, scope: { mode: "full", chapters: 1 } }) + "\n" },
            { file: `${prefix}/plan-confirm.json`, before: await snapshotFile(tokenPath) },
        ];
        await createPlanJournal(f.paths.library, { sourceId: source.sourceId, clearConfirm: true, writes: entries });
        await atomicWrite(path.join(dir, "plan.json"), entries[0].content);
        await writeFile(tokenPath, "作者修改");
        await assert.rejects(resumePendingPlan(f.paths.library), (e) => e.code === "library_recovery_conflict");
        assert.equal(await readFile(tokenPath, "utf8"), "作者修改");
        await atomicWrite(tokenPath, token);
        await resumePendingPlan(f.paths.library);
        assert.equal(JSON.parse(await readFile(metaPath, "utf8")).scope.mode, "full");
        await assert.rejects(readFile(tokenPath), (e) => e.code === "ENOENT");
    }
    finally {
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
            const candidate = await stageCandidate(dir, { chapterId: "c001", body: `正文标记-${i}-结束` });
            await markCandidateLinted(dir, candidate.id, 0);
            ids.push(candidate.id);
        }
        const moduleUrl = pathToFileURL(path.resolve("dist/lib/store.js")).href;
        const child = `import { acceptCandidate } from ${JSON.stringify(moduleUrl)}; await acceptCandidate(process.argv[1], process.argv[2], 'append');`;
        const run = promisify(execFile);
        await Promise.all(ids.map(id => run(process.execPath, ["--input-type=module", "-e", child, dir, id])));
        const chapter = await readChapter(dir, "c001");
        for (let i = 0; i < 4; i++)
            assert.ok(chapter.body.includes(`正文标记-${i}-结束`));
        assert.equal((await readLedger(dir)).entries.filter((e) => e.kind === "note").length, 4);
    }
    finally {
        await f.close();
    }
});
test("损坏资产和非法路径不会被当成空文件覆盖", async () => {
    const f = await fixture();
    try {
        const { dir } = await createWork(f.paths, { title: "作品" });
        const ledger = path.join(dir, "ledger.json");
        await writeFile(ledger, "{损坏");
        await assert.rejects(appendLedger(dir, { kind: "note", summary: "不可覆盖" }));
        assert.equal(await readFile(ledger, "utf8"), "{损坏");
        await LibraryPort.ensureLibrary(f.paths);
        const index = path.join(f.paths.library, "index.json");
        await writeFile(index, '{"sources":[],"cards":"坏"}');
        await assert.rejects(LibraryPort.importSource(f.paths, { title: "参考", text: "第一章\n内容" }));
        assert.equal(await readFile(index, "utf8"), '{"sources":[],"cards":"坏"}');
        assert.throws(() => assertResourceId("../outside"), (e) => e.code === "bad_id");
        assert.throws(() => assertResourceId("c001:stream"), (e) => e.code === "bad_id");
        const outside = path.join(f.root, "outside");
        await mkdir(outside);
        await symlink(outside, path.join(f.root, "linked"));
        await assert.rejects(atomicWrite(path.join(f.root, "linked", "asset.json"), "must not write"), e => e.code === "unsafe_path");
        await assert.rejects(readFile(path.join(outside, "asset.json")), e => e.code === "ENOENT");
        await assert.rejects(InspirationPort.getSession(f.paths, "../../outside"), (e) => e.code === "bad_id");
    }
    finally {
        await f.close();
    }
});
test("旧章节和只改状态时保留作者正文", async () => {
    const f = await fixture();
    try {
        const { dir } = await createWork(f.paths, { title: "旧作品" });
        await writeFile(path.join(dir, "chapters", "c001.md"), "旧格式正文。\n第二段。");
        await setOutline(dir, "c001", { ending: "结尾" });
        await updateChapter(dir, { id: "c001", status: "reviewed", expectedRevision: (await readChapter(dir, "c001")).revision });
        const chapter = await readChapter(dir, "c001");
        assert.equal(chapter.body, "旧格式正文。\n第二段。");
        assert.equal(chapter.outline.ending, "结尾");
        assert.equal(chapter.status, "reviewed");
    }
    finally {
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
        const outcomes = await Promise.allSettled([acceptCandidate(dir, candidate.id), acceptCandidate(dir, candidate.id)]);
        assert.equal(outcomes.filter(x => x.status === "fulfilled").length, 1);
        const rejected = outcomes.find(x => x.status === "rejected");
        assert.equal(rejected.reason.code, "candidate_already_accepted");
        assert.equal((await readChapter(dir, "c001")).body, "修改后的候选正文");
    }
    finally {
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
        const storeUrl = pathToFileURL(path.resolve("dist/lib/store.js")).href;
        const libUrl = pathToFileURL(path.resolve("dist/lib/ports/library.js")).href;
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
        assert.equal((await LibraryPort.getSource(f.paths, recovered.sourceId)).text, "第一章 开始\n原文");
        assert.equal((await LibraryPort.listSources(f.paths)).length, 1);
    }
    finally {
        await f.close();
    }
});
test("卡采纳中途写入失败后恢复，重试不会生成第二张卡", async () => {
    const f = await fixture();
    try {
        const source = await LibraryPort.importSource(f.paths, { title: "参考", text: "第一章 开始\n原文" });
        const staged = await LibraryPort.stageCard(f.paths, { title: "技法", sourceId: source.sourceId, body: "分析", mechanisms: [{ name: "动作", experience: "e", rebuild: "r", discard: "d", failWhen: "失效" }] });
        const libUrl = pathToFileURL(path.resolve("dist/lib/ports/library.js")).href;
        const child = `
      import fs from 'node:fs'; import path from 'node:path'; import { syncBuiltinESMExports } from 'node:module';
      const paths = JSON.parse(process.argv[1]), candidate = process.argv[2], original = fs.promises.rename;
      fs.promises.rename = async (from, to) => { if (to === path.join(paths.library, 'index.json')) throw Object.assign(new Error('simulated write failure'), { code: 'EIO' }); return original(from, to); };
      syncBuiltinESMExports(); const { LibraryPort } = await import(${JSON.stringify(libUrl)});
      try { await LibraryPort.acceptCard(paths, candidate); process.exitCode = 1; }
      catch (e) { if (e.code !== 'library_recovery_required') throw e; }
    `;
        await promisify(execFile)(process.execPath, ["--input-type=module", "-e", child, JSON.stringify(f.paths), staged.candId]);
        assert.equal((await inspectPendingCard(f.paths.library)).conflict, false);
        const recovered = await resumePendingCard(f.paths.library);
        assert.equal((await LibraryPort.listCards(f.paths)).length, 1);
        assert.equal((await LibraryPort.getCard(f.paths, recovered.cardId)).title, "技法");
        await assert.rejects(LibraryPort.acceptCard(f.paths, staged.candId), (e) => e.code === "candidate_already_accepted");
    }
    finally {
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
        const chapter = path.join(dir, "chapters", "c002.md"), content = await readFile(chapter, "utf8");
        await writeFile(chapter, "---\n{坏 JSON\n---\n原文");
        await assert.rejects(assembleManuscript(dir, f.paths), e => e.code === "assemble_chapter_unreadable");
        assert.equal(await readFile(result.file, "utf8"), original);
        await rm(chapter);
        await assert.rejects(assembleManuscript(dir, f.paths), e => e.code === "assemble_chapter_unreadable");
        await writeFile(chapter, content);
        const metaBefore = await readFile(path.join(dir, "meta.json"), "utf8");
        await assert.rejects(assembleManuscript(dir, f.paths, { outputRel: `works/${meta.key}/meta.json` }), /越界/);
        await symlink(dir, path.join(f.paths.manuscripts, "linked-work"), "junction");
        await assert.rejects(assembleManuscript(dir, f.paths, { outputRel: "manuscripts/linked-work/meta.json" }), /越界/);
        assert.equal(await readFile(path.join(dir, "meta.json"), "utf8"), metaBefore);
    } finally { await f.close(); }
});

test("损坏的分析形状或计划在读取和面板中明确报错", async () => {
    const f = await fixture();
    try {
        const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考", text: "第一章 开始\n原文" });
        await ensureAnalysis(f.paths, sourceId, "第一章 开始\n原文");
        const dir = path.join(f.paths.library, "analyses", sourceId);
        await writeFile(path.join(dir, "characters.json"), '{"损坏":"应为数组"}');
        await assert.rejects(readAnalysisBundle(f.paths, sourceId), e => e.code === "bad_analysis");
        await writeFile(path.join(dir, "plan.json"), "{损坏");
        await assert.rejects(buildLibraryView(f.paths));
        assert.equal(await readFile(path.join(dir, "plan.json"), "utf8"), "{损坏");
    } finally { await f.close(); }
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
        await updateChapter(dir, { id: "c001", status: "reviewed", expectedRevision: (await readChapter(dir, "c001")).revision });
        await updateChapter(dir, { id: "c001", status: "final" });
        const original = await readFile(path.join(dir, "chapters/c001.md"));
        const revision = (await readChapter(dir, "c001")).revision;
        await assert.rejects(updateChapter(dir, { id: "c001", body: "她拒绝交出钥匙。" }), e => e.code === "refuse_overwrite_final");
        await updateChapter(dir, { id: "c001", body: "她拒绝交出钥匙。", force: true, expectedRevision: revision });
        assert.equal((await readChapter(dir, "c001")).status, "drafted");
        const meta = await readWorkMeta(dir), impact = meta.revisionImpacts.at(-1);
        assert.equal(impact.nextChapterId, "c002");
        assert.deepEqual(await readFile(path.join(dir, impact.history)), original);
        await assert.rejects(acceptCandidate(dir, stale.id), e => e.code === "revision_conflict");
        const fresh = await stageCandidate(dir, { chapterId: "c001", body: "她把钥匙收回口袋。" });
        await markCandidateLinted(dir, fresh.id, 0);
        await acceptCandidate(dir, fresh.id);
        const snapshot = await buildPanelSnapshot(dir, f.paths);
        assert.ok(snapshot.nextHints.some(h => h.includes("c001") && h.includes("c002")));
        const shipped = await assembleManuscript(dir, f.paths);
        assert.match(await readFile(typeof shipped === "string" ? shipped : shipped.file, "utf8"), /她把钥匙收回口袋/);
    } finally { await f.close(); }
});

test("直接保存先核账本，中断后正文、目录和留痕一并恢复", async () => {
    const f = await fixture();
    try {
        const { dir } = await createWork(f.paths, { title: "共同提交" });
        await setOutline(dir, "c001", {}, "一");
        await writeFile(path.join(dir, "ledger.json"), "{broken");
        await assert.rejects(updateChapter(dir, { id: "c001", body: "不能写进去" }));
        assert.equal((await readChapter(dir, "c001")).body, "");
        await writeFile(path.join(dir, "ledger.json"), JSON.stringify({ schemaVersion: 1, entries: [] }));
        const storeUrl = pathToFileURL(path.resolve("dist/lib/store.js")).href;
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
        assert.equal((await readLedger(dir)).entries.at(-1).kind, "chapter_save_direct");
    } finally { await f.close(); }
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
        assert.ok(rows.every(row => row.unavailable === true));
        assert.ok(rows.some(row => row.id === cand.id));
        assert.equal(rows[0].unavailable, true);
        const snapshot = await buildPanelSnapshot(dir, f.paths);
        assert.equal(snapshot.candidates[0].unavailable, true);
        assert.ok(snapshot.nextHints.some(h => h.includes("不可读")));
    } finally { await f.close(); }
});
