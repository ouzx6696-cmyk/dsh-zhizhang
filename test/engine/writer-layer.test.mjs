/** 写作层与引擎的衔接：会话追踪与投递、定稿条件（requireEditorPass）、单章审读信息、forge 正文体检、写作台路由组合、浏览器端区块。 */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { EventEmitter } from "node:events";
import { Script } from "node:vm";
import { saveChapter, setOutline, readChapter, ensureStorage } from "../../build/fanqie/src/engine/store.js";
import { setPromptSink, sessionFor, rememberSession, __resetSessions } from "../../build/core/src/sessions.js";
import { buildDeliveryPrompt, pickNextChapter } from "../../build/fanqie/src/workbench/delivery.js";
import { fanqieApi } from "../../build/fanqie/src/workbench/api.js";
import { createWorkbenchHandler } from "../../build/workbench/src/server.js";
import { bodyFingerprint, saveReview } from "../../build/fanqie/src/review.js";
import { auditTools } from "../../build/fanqie/src/engine/tools/audit.js";
import { worksTools } from "../../build/fanqie/src/engine/tools/works.js";
import { setPluginConfig } from "../../build/fanqie/src/engine/tools/context.js";
import { jpost, servePanel, withWork } from "./helpers.mjs";

const mainExec = (cwd, id = "s-main", depth = 0) => ({ agent: { session: { id, header: { cwd, delegationDepth: depth } } } });
const get = (api, route) => fetch(`${api}${route}`);

test("主会话追踪：子代理会话不覆盖，按数据根记录并落盘", async () => {
    __resetSessions();
    const work = await withWork("追踪");
    try {
        await ensureStorage(mainExec(work.base), { storageRoot: work.base });
        assert.equal((await sessionFor(work.base)).sessionId, "s-main");
        await ensureStorage(mainExec(work.base, "s-editor", 1), { storageRoot: work.base });
        rememberSession(work.base, { agent: { session: { id: "s-child", header: {} }, options: { subagentDepth: 1 } } });
        assert.equal((await sessionFor(work.base)).sessionId, "s-main");
        await new Promise(r => setTimeout(r, 50));
        __resetSessions();
        assert.equal((await sessionFor(work.base)).sessionId, "s-main", "重启后从 DSH_HOME 记录恢复");
    }
    finally {
        await work.cleanup();
    }
});

test("写作台投递：能力探测、缺会话、缺宿主、成功投递三种动作", async () => {
    __resetSessions();
    const work = await withWork("投递");
    const server = await servePanel({ storageRoot: work.base });
    const sent = [];
    try {
        await setOutline(work.dir, "c001", { ending: "门开了" }, "第一章");
        await saveChapter(work.dir, { id: "c001", title: "第一章", body: "她推开门。" });
        await setOutline(work.dir, "c002", { ending: "雨停了" }, "第二章");
        let caps = await (await get(server.api, "/diagnostics/capabilities")).json();
        assert.equal(caps.deliver, false);
        assert.match(caps.deliverReason, /会话控制服务/);
        assert.equal((await jpost(server.api, "/agent/deliver", { work: work.key, action: "continue", confirm: true })).status, 503);
        setPromptSink({ prompt: async (sessionId, text, requestId) => { sent.push({ sessionId, text, requestId }); } });
        caps = await (await get(server.api, "/diagnostics/capabilities")).json();
        assert.equal(caps.deliver, false);
        assert.match(caps.deliverReason, /还没有会话/);
        assert.equal((await jpost(server.api, "/agent/deliver", { work: work.key, action: "continue", confirm: true })).status, 409);
        await ensureStorage(mainExec(work.base), { storageRoot: work.base });
        caps = await (await get(server.api, "/diagnostics/capabilities")).json();
        assert.equal(caps.deliver, true);
        assert.deepEqual(caps.deliverActions, ["continue", "review", "revise"]);
        assert.equal((await jpost(server.api, "/agent/deliver", { work: work.key, action: "continue" })).status, 400, "须明确确认");
        assert.equal((await jpost(server.api, "/agent/deliver", { work: work.key, action: "rm -rf", confirm: true })).status, 400);
        assert.equal((await jpost(server.api, "/agent/deliver", { work: work.key, action: "review", confirm: true })).status, 400, "审读须指明章节");
        const ok = await jpost(server.api, "/agent/deliver", { work: work.key, action: "continue", confirm: true, requestId: "wb-test-000001" });
        assert.equal(ok.status, 200);
        const body = await ok.json();
        assert.equal(body.chapterId, "c002");
        assert.equal(sent.at(-1).sessionId, "s-main");
        assert.equal(sent.at(-1).requestId, "wb-test-000001");
        assert.match(sent.at(-1).text, /续写《投递》第 2 章「第二章」/);
        assert.match(sent.at(-1).text, /上一章第 1 章「第一章」/);
        assert.match(sent.at(-1).text, /不要定稿/);
        assert.equal((await jpost(server.api, "/agent/deliver", { work: work.key, action: "review", chapter: "c001", confirm: true, note: "重点看结尾" })).status, 200);
        assert.match(sent.at(-1).text, /派编辑子代理审读/);
        assert.match(sent.at(-1).text, /作者附言：重点看结尾/);
        setPromptSink({ prompt: async () => { throw Object.assign(new Error("prompt rejected"), { code: "session/agent-busy" }); } });
        const busy = await jpost(server.api, "/agent/deliver", { work: work.key, action: "revise", chapter: "c001", confirm: true });
        assert.equal(busy.status, 502);
        assert.equal((await busy.json()).code, "session/agent-busy");
    }
    finally {
        await server.close();
        await work.cleanup();
    }
});

test("下一章选择：第一章没正文的，否则新的一章", async () => {
    assert.equal(pickNextChapter([{ id: "a", position: 1, status: "final", wordCount: 100 }, { id: "b", position: 2, status: "planned" }]).id, "b");
    assert.equal(pickNextChapter([{ id: "a", position: 1, status: "planned", wordCount: 100 }, { id: "b", position: 2, status: "planned", wordCount: 0 }]).id, "b");
    assert.equal(pickNextChapter([{ id: "a", position: 1, status: "drafted", wordCount: 100 }]), undefined);
    const work = await withWork("空书");
    try {
        const p = await buildDeliveryPrompt(work.dir, { action: "continue" });
        assert.match(p.text, /新的一章（第 1 章/);
        await assert.rejects(buildDeliveryPrompt(work.dir, { action: "continue", chapter: "nope" }), /没有这一章/);
    }
    finally {
        await work.cleanup();
    }
});

test("定稿条件：requireEditorPass 时写作台与工具两条路径都要当前正文的通过回报；单章读取带审读信息", async () => {
    __resetSessions();
    const work = await withWork("门禁");
    const server = await servePanel({ storageRoot: work.base, requireEditorPass: true });
    try {
        await setOutline(work.dir, "c001", { ending: "门开了" }, "第一章");
        await saveChapter(work.dir, { id: "c001", title: "第一章", body: "她推开门。" });
        let chapter = await (await get(server.api, `/chapter?work=${encodeURIComponent(work.key)}&id=c001`)).json();
        assert.equal(chapter.writer.editorReview, null);
        assert.equal(chapter.writer.requireEditorPass, true);
        assert.match(chapter.writer.finalizeBlocked, /还没有编辑审读回报/);
        const request = { work: work.key, chapter: "c001", expectedRevision: (await readChapter(work.dir, "c001")).revision, confirm: true };
        assert.equal((await jpost(server.api, "/chapter/review", request)).status, 200, "作者审读声明不受定稿条件影响");
        const after = { ...request, expectedRevision: (await readChapter(work.dir, "c001")).revision };
        const blocked = await jpost(server.api, "/chapter/finalize", after);
        assert.equal(blocked.status, 409);
        assert.equal((await blocked.json()).code, "writer_finalize_blocked");
        setPluginConfig({ storageRoot: work.base, requireEditorPass: true });
        const save = worksTools().find(t => t.name === "fanqie_chapter_save");
        assert.match(await save.execute({ work: work.key, chapter: "c001", status: "final" }, mainExec(work.base)), /还没有编辑审读回报/);
        assert.notEqual((await readChapter(work.dir, "c001")).status, "final");
        const body = (await readChapter(work.dir, "c001")).body;
        const review = (verdict, sha) => saveReview(work.dir, { work: work.key, work_title: "门禁", chapter: "c001", chapter_title: "第一章", body_sha256: sha, verdict, hard_issues: [], levels: [], optional: [], reread_full: true, changed_scope: "未改", strengths: "", by: "editor", at: new Date().toISOString() });
        await review("通过", bodyFingerprint("旧正文"));
        chapter = await (await get(server.api, `/chapter?work=${encodeURIComponent(work.key)}&id=c001`)).json();
        assert.equal(chapter.writer.editorReview.stale, true);
        assert.match(chapter.writer.finalizeBlocked, /旧正文/);
        await new Promise(r => setTimeout(r, 5));
        await review("通过", bodyFingerprint(body));
        chapter = await (await get(server.api, `/chapter?work=${encodeURIComponent(work.key)}&id=c001`)).json();
        assert.equal(chapter.writer.editorReview.verdict, "通过");
        assert.equal(chapter.writer.finalizeBlocked, undefined);
        assert.equal((await jpost(server.api, "/chapter/finalize", after)).status, 200);
    }
    finally {
        setPluginConfig({});
        await server.close();
        await work.cleanup();
    }
});

test("forge 正文体检：章节与纯文本扫描后都追加在语感雷达之后", async () => {
    const work = await withWork("体检");
    try {
        setPluginConfig({ storageRoot: work.base });
        await setOutline(work.dir, "c001", { ending: "门开了" }, "第一章");
        await saveChapter(work.dir, { id: "c001", title: "第一章", body: "她推开门。他的嘴角勾起一抹弧度。" });
        const lint = auditTools().find(t => t.name === "fanqie_style_lint");
        const chapter = await lint.execute({ work: work.key, chapter: "c001" }, mainExec(work.base));
        assert.match(chapter, /### forge 正文体检（\d+ 处，仅提示回看位置）/);
        assert.match(chapter, /\d+ 字 · \d+ 段/);
        const plain = await lint.execute({ text: "他笑了笑。" }, mainExec(work.base));
        assert.match(plain, /### forge 正文体检/);
    }
    finally {
        setPluginConfig({});
        await work.cleanup();
    }
});

test("写作台路由组合：各模式按路径分派，同一套访问校验，未知路径 404", async () => {
    const seen = [];
    const fake = { routes: ["/api/writer/toutiao/articles"], async handle(ctx) { if (ctx.path !== "/api/writer/toutiao/articles") return false; seen.push(ctx.method); ctx.json(200, { ok: true, n: 1 }); return true; } };
    const { routes, handler } = createWorkbenchHandler({}, [fake, fanqieApi({})]);
    assert.ok(routes.includes("/api/writer/toutiao/articles") && routes.includes("/api/writer/agent/deliver"));
    const call = (p, method = "GET", extra = {}) => new Promise((resolve) => {
        const req = Object.assign(new EventEmitter(), { method, url: p, headers: { host: "127.0.0.1:1", ...extra }, socket: { remoteAddress: "127.0.0.1" } });
        const res = { status: 0, headersSent: false, writeHead(s) { this.status = s; }, setHeader() { }, end(b) { resolve({ status: this.status, body: JSON.parse(b) }); } };
        void handler(req, res);
        setImmediate(() => req.emit("end"));
    });
    assert.deepEqual((await call("/api/writer/toutiao/articles")).body, { ok: true, n: 1 });
    assert.equal((await call("/api/writer/toutiao/articles", "GET", { origin: "http://evil.example" })).status, 403);
    assert.equal((await call("/api/writer/nope")).status, 404);
    assert.deepEqual(seen, ["GET"]);
});

test("写作台“写作 Agent”区块：按能力与回报渲染按钮", async () => {
    const script = new Script(await readFile("build/client.js", "utf8"));
    let descriptor;
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
    const react = { createElement: h, Component: class { }, Fragment: "fragment", memo: c => c, useState: v => [typeof v === "function" ? v() : v, () => { }], useCallback: f => f, useMemo: f => f(), useEffect: () => { }, useRef: v => ({ current: v }) };
    script.runInNewContext({ window: { __ModuleLoader__: { load: v => { descriptor = v; } } }, URL, AbortController, setTimeout, clearTimeout });
    const { WriterAgent } = descriptor.factory(() => react).__testing;
    const texts = (node) => node == null || typeof node === "boolean" ? [] : typeof node === "string" || typeof node === "number" ? [String(node)] : Array.isArray(node) ? node.flatMap(texts) : typeof node.type === "function" ? texts(node.type({ ...node.props, children: node.children })) : texts(node.children ?? node.props?.children);
    const buttons = (node, out = []) => { if (!node || typeof node !== "object") return out; if (Array.isArray(node)) { node.forEach(n => buttons(n, out)); return out; } if (typeof node.type === "function") return buttons(node.type({ ...node.props, children: node.children }), out); if (node.type === "button") out.push(node); buttons(node.children, out); return out; };
    const off = WriterAgent({ state: { deliver: { caps: { deliver: false, reason: "没有会话" } } }, actions: {}, chapterId: "c001", writer: null, bodyReady: true });
    assert.ok(texts(off).join("").includes("暂时不能投递到对话：没有会话"));
    assert.ok(buttons(off).every(b => b.props.disabled));
    const failed = WriterAgent({ state: { deliver: { caps: { deliver: true } } }, actions: {}, chapterId: "c001", writer: { editorReview: { verdict: "未通过", stale: false, hardIssues: 2, levels: 1, at: "2026-10-28T12:00:00Z" }, requireEditorPass: true }, bodyReady: true });
    const text = texts(failed).join("");
    assert.ok(text.includes("未通过") && text.includes("四类硬伤 2 处") && text.includes("定稿前须有当前版本"));
    assert.deepEqual(buttons(failed).map(b => texts(b)[0]), ["续写下一章", "派编辑审读本章", "按回报修改"]);
    assert.ok(buttons(failed).every(b => !b.props.disabled));
    const passed = WriterAgent({ state: { deliver: { caps: { deliver: true } } }, actions: {}, chapterId: "c001", writer: { editorReview: { verdict: "通过", stale: false } }, bodyReady: true });
    assert.deepEqual(buttons(passed).map(b => texts(b)[0]), ["续写下一章", "派编辑审读本章"]);
});

test("写作台今日头条模式：按状态与质检渲染采用和写作 Agent 按钮", async () => {
    const script = new Script(await readFile("build/client.js", "utf8"));
    let descriptor;
    const h = (type, props, ...children) => ({ type, props: props || {}, children: children.flat() });
    const react = { createElement: h, Component: class { }, Fragment: "fragment", memo: c => c, useState: v => [typeof v === "function" ? v() : v, () => { }], useCallback: f => f, useMemo: f => f(), useEffect: () => { }, useRef: v => ({ current: v }), useId: () => "id" };
    script.runInNewContext({ window: { __ModuleLoader__: { load: v => { descriptor = v; } } }, URL, AbortController, setTimeout, clearTimeout });
    const { ToutiaoSide } = descriptor.factory(() => react).__testing;
    const texts = (node) => node == null || typeof node === "boolean" ? [] : typeof node === "string" || typeof node === "number" ? [String(node)] : Array.isArray(node) ? node.flatMap(texts) : typeof node.type === "function" ? texts(node.type({ ...node.props, children: node.children })) : texts(node.children ?? node.props?.children);
    const buttons = (node, out = []) => { if (!node || typeof node !== "object") return out; if (Array.isArray(node)) { node.forEach(n => buttons(n, out)); return out; } if (typeof node.type === "function") return buttons(node.type({ ...node.props, children: node.children }), out); if (node.type === "button") out.push(node); buttons(node.children, out); return out; };
    const article = (over) => ({ title: "秋柿", status: "初稿待改", line: "资讯线", genre: "长图文", returnRounds: 0, maxReturnRounds: 2, card: { present: true, 主问题: "柿子为什么涩" }, headlines: { main: "秋柿", alts: [] }, qa: [], qaValid: false, qaProblem: "当前版本还没跑质检", draft: { rev: 1 }, history: [], adoptable: false, ...over });
    const tt = (a, off = "") => ({ detail: { status: "ready", article: a }, busy: "", deliverOff: off, notices: [], doneAt: {}, actions: {} });
    const none = ToutiaoSide({ tt: { detail: { status: "idle", article: null }, busy: "", deliverOff: "", notices: [], actions: {} } });
    const labels = (node) => buttons(node).map(b => texts(b)[0]);
    assert.deepEqual(labels(none), ["新写一篇"]);
    const draft = ToutiaoSide({ tt: tt(article()) });
    assert.deepEqual(labels(draft), ["采用（标记为已交稿）", "继续推进", "派编辑红笔", "新写一篇"]);
    assert.equal(buttons(draft)[0].props.disabled, true, "未验收不能采用");
    const failed = ToutiaoSide({ tt: tt(article({ qa: [{ rev: 1, score: 70, pass: false, hardGates: ["标点"] }] })) });
    assert.ok(texts(failed).join("").includes("70 分 · 未过线") && texts(failed).join("").includes("硬闸：标点"));
    assert.ok(labels(failed).includes("按质检修改"));
    const ready = ToutiaoSide({ tt: tt(article({ status: "已验收", qa: [{ rev: 1, score: 90, pass: true, hardGates: [] }], qaValid: true, adoptable: true })) });
    assert.equal(buttons(ready)[0].props.disabled, false);
    assert.ok(!labels(ready).includes("按质检修改"));
    const off = ToutiaoSide({ tt: tt(article(), "暂时不能发到对话：没有会话") });
    assert.ok(buttons(off).slice(1).every(b => b.props.disabled));
    assert.ok(texts(off).join("").includes("没有会话"));
    const done = ToutiaoSide({ tt: tt(article({ status: "已交稿" })) });
    assert.deepEqual(labels(done), ["新写一篇"]);
});

