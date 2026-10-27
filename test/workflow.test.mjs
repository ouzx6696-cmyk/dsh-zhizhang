/** The writing product's main path and author-controlled decisions. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, readFile, rm, stat, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { __testing, apply } from "../dist/index.js";
import { LibraryPort, InspirationPort, MultiDraftPort, setPortConfig, resetPortConfig } from "../dist/lib/ports/index.js";
import { ensureStorage, createWork, setOutline, stageCandidate, readCandidate, buildPanelSnapshot, readChapter, readWorkMeta, resolveWorkDir } from "../dist/lib/store.js";
import { methodsTools } from "../dist/tools/methods.js";
import { inspirationTools } from "../dist/tools/inspiration.js";
import { PLUGIN_VERSION } from "../dist/lib/version.js";
const BOOK = [
    "第1章 差三罐", "凌晨两点，屏幕上的数字比昨天少了三罐咖啡。他把时间戳抄在纸条上。",
    "第2章 四秒", "他调出监控回放，侧窗的人影只用了四秒。",
].join("\n");
const tools = new Map(__testing.tools.map(tool => [tool.name, tool.execute]));
async function setup() {
    const root = await mkdtemp(path.join(tmpdir(), "zhizhang-workflow-"));
    const paths = await ensureStorage({}, { storageRoot: root });
    const run = async (name, args = {}) => {
        const tool = tools.get(name);
        assert.ok(tool, `missing tool ${name}`);
        return await tool({ ...args, working_dir: root }, {});
    };
    return { root, paths, run, close: () => rm(root, { recursive: true, force: true }) };
}
function id(text, expression) {
    const found = text.match(expression)?.[1];
    assert.ok(found, text);
    return found;
}
function cardInput(sourceId) {
    return {
        title: "差数引出疑问", sourceId, axis: "craft", layer: "scene", dimension: "hook",
        body: "用可核对的细节引出疑问。",
        mechanisms: [{ name: "差数", experience: "三罐", rebuild: "换成其他差数", discard: "便利店", failWhen: "差数无后果" }],
        humanFeel: { writerCraft: "重数后再开口", craftRange: "近景", characterState: "怀疑", stateOnPage: "停半拍", allowedEdges: "一句噪音", failAsTemplate: "句句解释" },
        readerWant: "差数缘由", emotionArc: "平静到起疑", dramaticUnit: "盘点差数",
        replaceables: ["数字"], mustNotCopy: ["人物"], evidence: [{ quote: "屏幕上的数字比昨天少了三罐咖啡", chapter: 1 }],
        transfer: "其他可核对的差异", failWhen: "差数无后果",
    };
}
test("拆书证据经明确采纳进入规划，正文经扫描采纳后供续章使用", async () => {
    const f = await setup();
    try {
        const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考书", text: BOOK });
        const fact = await f.run("zhizhang_library_facts_stage", { source: sourceId, facts: { n: 1, events: [{ desc: "盘点少了三罐", quote: "屏幕上的数字比昨天少了三罐咖啡" }], readingLevel: "正文已读" } });
        assert.match(fact, /已记录 1 章/);
        const candidate = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
        const { cardId } = await LibraryPort.acceptCard(f.paths, candidate.candId);
        const card = await LibraryPort.getCard(f.paths, cardId);
        assert.equal(card.readingEvidence.chapters[0].readingLevel, "正文已读");
        assert.match(card.readingEvidence.note, /不证明/);
        await assert.rejects(LibraryPort.acceptCard(f.paths, candidate.candId), (e) => e.code === "candidate_already_accepted");
        const session = await InspirationPort.startSession(f.paths, { goal: "新故事", cardIds: [cardId], craftOnly: true, pace: "慢燃" });
        const foundation = await InspirationPort.stageEmit(f.paths, session.sessionId, { kind: "foundation", payload: { planned: "追查差数" } });
        await InspirationPort.acceptEmit(f.paths, foundation.candId, { workKey: "新作", apply: true });
        const outline = await InspirationPort.stageEmit(f.paths, session.sessionId, { kind: "outline", payload: { chapter: "c001", title: "第一章", ending: "她把门推开。" } });
        await InspirationPort.acceptEmit(f.paths, outline.candId, { workKey: "新作", apply: true });
        const dir = await resolveWorkDir(f.paths, "新作");
        assert.equal((await readWorkMeta(dir)).pace, "慢燃");
        await f.run("zhizhang_chapter_brief", { work: "新作", chapter: "c001" });
        const body = "夜班第七天，她查完账，把门推开。";
        const staged = await f.run("zhizhang_candidate_stage", { work: "新作", chapter: "c001", content: body });
        const candId = id(staged, /(cand-[a-z0-9]+)/);
        assert.match(await f.run("zhizhang_candidate_accept", { work: "新作", candidate: candId }), /lint_required/);
        await f.run("zhizhang_style_lint", { work: "新作", candidate: candId });
        assert.match(await f.run("zhizhang_candidate_accept", { work: "新作", candidate: candId }), /已采纳/);
        assert.equal((await readChapter(dir, "c001")).body, body);
        await f.run("zhizhang_outline_set", { work: "新作", chapter: "c002", ending: "他翻开账本。" });
        assert.ok((await f.run("zhizhang_chapter_brief", { work: "新作", chapter: "c002" })).includes(body));
    }
    finally {
        await f.close();
    }
});
test("全量阅读须明确同意且确认参数不能变化，原计划保持可用", async () => {
    const f = await setup();
    try {
        const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考", text: BOOK });
        await f.run("zhizhang_library_plan", { source: sourceId });
        const planPath = path.join(f.paths.library, "analyses", sourceId, "plan.json");
        const before = await readFile(planPath, "utf8");
        const cost = await f.run("zhizhang_library_plan", { source: sourceId, mode: "full", reset: true, batch_chars: 4000 });
        const token = id(cost, /confirm_token：(fp-[a-z0-9-]+)/);
        assert.equal(await readFile(planPath, "utf8"), before);
        const refused = await f.run("zhizhang_library_plan", { source: sourceId, mode: "full", confirm_full: true, confirm_token: token, batch_chars: 8000 });
        assert.match(refused, /bad_confirm_token/);
        assert.equal(await readFile(planPath, "utf8"), before);
        await f.run("zhizhang_library_plan", { source: sourceId, mode: "full", confirm_full: true, confirm_token: token, batch_chars: 4000 });
        assert.equal(JSON.parse(await readFile(planPath, "utf8")).mode, "full");
    }
    finally {
        await f.close();
    }
});
test("暂存后的书源变化须重新核对，未声明的阅读程度不推断为已读", async () => {
    const f = await setup();
    try {
        const { sourceId } = await LibraryPort.importSource(f.paths, { title: "参考", text: BOOK });
        const staged = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
        const sourcePath = path.join(f.paths.library, "sources", `${sourceId}.txt`);
        await writeFile(sourcePath, BOOK + "\n作者修改。", "utf8");
        await assert.rejects(LibraryPort.acceptCard(f.paths, staged.candId), (e) => e.code === "source_changed");
        const fresh = await LibraryPort.stageCard(f.paths, cardInput(sourceId));
        const { cardId } = await LibraryPort.acceptCard(f.paths, fresh.candId);
        assert.equal((await LibraryPort.getCard(f.paths, cardId)).readingEvidence.chapters[0].readingLevel, "未声明");
    }
    finally {
        await f.close();
    }
});
test("显式授权和定稿保护不接受字符串代替布尔值", async () => {
    const f = await setup();
    try {
        const { sessionId } = await InspirationPort.startSession(f.paths, { goal: "测试" });
        const staged = await InspirationPort.stageEmit(f.paths, sessionId, { kind: "foundation", payload: { planned: "计划" } });
        assert.equal((await InspirationPort.acceptEmit(f.paths, staged.candId, { workKey: "作品", apply: "true" })).applied, false);
        await assert.rejects(resolveWorkDir(f.paths, "作品"), (e) => e.code === "work_not_found");
        await f.run("zhizhang_project_create", { title: "作品" });
        await f.run("zhizhang_outline_set", { work: "作品", chapter: "c001", ending: "结束" });
        assert.match(await f.run("zhizhang_chapter_save", { work: "作品", chapter: "c001", content: "夜".repeat(300), confirm_bypass: "true" }), /bypass_confirm_required/);
        await f.run("zhizhang_chapter_save", { work: "作品", chapter: "c001", content: "已定稿正文", confirm_bypass: true });
        await f.run("zhizhang_chapter_save", { work: "作品", chapter: "c001", status: "final" });
        const candId = id(await f.run("zhizhang_candidate_stage", { work: "作品", chapter: "c001", content: "替换内容" }), /(cand-[a-z0-9]+)/);
        await f.run("zhizhang_style_lint", { work: "作品", candidate: candId });
        assert.match(await f.run("zhizhang_candidate_accept", { work: "作品", candidate: candId, force: "false", skip_brief: true }), /refuse_overwrite_final/);
        assert.equal((await readChapter(await resolveWorkDir(f.paths, "作品"), "c001")).body, "已定稿正文");
    }
    finally {
        await f.close();
    }
});
test("插件按需挂载，构建产物可加载", async () => {
    const shell = [], mounted = [], sections = [];
    const agent = { tools: { register: (t) => mounted.push(t) }, get: () => ({ section: (s) => { sections.push(s); return () => { }; } }) };
    apply({ tools: { register: (t) => shell.push(t) }, get: agent.get }, {});
    assert.deepEqual(shell.map(t => t.name), ["zhizhang_enable"]);
    const exec = { agent: { ctx: agent, session: { id: "test", header: { cwd: process.cwd() } } } };
    await shell[0].execute({}, exec);
    await shell[0].execute({}, exec);
    assert.equal(mounted.length, __testing.tools.length);
    assert.equal(sections.length, 1);
    const pkg = JSON.parse(await readFile(path.resolve("package.json"), "utf8"));
    assert.equal(PLUGIN_VERSION, pkg.version);
    assert.equal(typeof apply, "function");
    assert.equal((await stat(path.resolve("dist/client.js"))).isFile(), true);
});
test("多草稿默认关闭，开启后统一稿仍只是候选", async () => {
    const f = await setup();
    try {
        const { dir, meta } = await createWork(f.paths, { title: "作品" });
        await setOutline(dir, "c001", { ending: "结束" }, "第一章");
        assert.match(await f.run("zhizhang_candidate_unify_brief", { work: meta.key, chapter: "c001" }), new RegExp(MultiDraftPort.disabledCode));
        setPortConfig({ multiDraftEnabled: true });
        const first = await stageCandidate(dir, { chapterId: "c001", body: "甲稿" });
        const second = await stageCandidate(dir, { chapterId: "c001", body: "乙稿" });
        const staged = await f.run("zhizhang_candidate_unify_stage", { work: meta.key, content: "统一稿", candidate_ids: [first.id, second.id] });
        const candidate = await readCandidate(dir, id(staged, /(cand-[a-z0-9]+)/));
        assert.deepEqual(candidate.unifyOf, [first.id, second.id]);
        assert.equal((await readChapter(dir, "c001")).body, "");
    }
    finally {
        resetPortConfig();
        await f.close();
    }
});
test("全书、卷、幕规划仅在采纳后进入对应章节并保留来源", async () => {
    const f = await setup();
    try {
        const { dir, meta } = await createWork(f.paths, { title: "作品" });
        await setOutline(dir, "c001", { ending: "门开了" }, "第一章");
        const { sessionId } = await InspirationPort.startSession(f.paths, { goal: "悬疑慢燃", pace: "慢燃" });
        const book = await InspirationPort.stageEmit(f.paths, sessionId, { kind: "book_plan", payload: { content: "全书计划" } });
        assert.equal((await readWorkMeta(dir)).planning, undefined);
        await InspirationPort.acceptEmit(f.paths, book.candId, { workKey: meta.key, apply: true });
        const vol = await InspirationPort.stageEmit(f.paths, sessionId, { kind: "volume_plan", payload: { id: "v1", title: "一卷", content: "卷计划", chapters: ["c001"] } });
        await InspirationPort.acceptEmit(f.paths, vol.candId, { workKey: meta.key, apply: true });
        const act = await InspirationPort.stageEmit(f.paths, sessionId, { kind: "act_plan", payload: { id: "a1", title: "一幕", content: "幕计划", volumeId: "v1", chapters: ["c001"] } });
        await InspirationPort.acceptEmit(f.paths, act.candId, { workKey: meta.key, apply: true });
        const tool = methodsTools().find(t => t.name === "zhizhang_chapter_brief");
        const brief = await tool.execute({ chapter: "c001", work: meta.key, working_dir: f.root, skip_cards: true }, {});
        for (const expected of ["全书计划", "卷计划", "幕计划", "悬疑慢燃", "不证明实际阅读"])
            assert.ok(brief.includes(expected), expected);
        const panel = await buildPanelSnapshot(dir, f.paths, { includeHtml: false });
        assert.equal(panel.inspiration.planning.volumes.length, 1);
        assert.equal(panel.inspiration.planning.acts.length, 1);
        const status = inspirationTools().find(t => t.name === "zhizhang_inspire_status");
        const history = await status.execute({ work: meta.key, history: true, working_dir: f.root }, {});
        assert.ok(history.includes(book.candId));
        assert.ok(history.includes(vol.candId));
        const detail = await status.execute({ candidate: act.candId, working_dir: f.root }, {});
        assert.ok(detail.includes("幕计划"));
    }
    finally {
        await f.close();
    }
});
