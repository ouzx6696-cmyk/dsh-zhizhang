/** HTTP contracts and the one generated-client boundary. Pure state lives in domain tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { EventEmitter } from "node:events";
import { networkInterfaces } from "node:os";
import { readFile, writeFile } from "node:fs/promises";
import { Script } from "node:vm";
import { saveChapter, setOutline, stageCandidate, markCandidateLinted, recordBriefBreadcrumb, readChapter, updateChapter } from "../dist/lib/store.js";
import { createPanelApiHandler } from "../dist/lib/http-api.js";
import { initialState, reducer, bodyKey } from "../src/client/state.js";
import { jpost, servePanel, withWork } from "./helpers.mjs";
const script = new Script(await readFile("dist/client.js", "utf8"));
function loadedClient(extra = {}) {
    let descriptor;
    const react = { createElement: (type, props, ...children) => ({ type, props, children }), Component: class {}, Fragment: "fragment", memo: component => component };
    script.runInNewContext({ window: { __ModuleLoader__: { load: value => { descriptor = value; } } }, URL, AbortController, setTimeout, clearTimeout, ...extra });
    assert.equal(descriptor.id, 'dsh-zhizhang');
    return descriptor.factory(id => { if (id === "react") return react; throw new Error("unexpected module " + id); });
}
function fakeRequest(options) {
    const req = new EventEmitter();
    req.method = options.method ?? "GET";
    req.url = options.url ?? "/api/dsh-zhizhang/works";
    req.headers = { host: "localhost", ...options.headers };
    req.socket = { remoteAddress: options.remoteAddress ?? "127.0.0.1" };
    const res = { status: 0, payload: null, writeHead(status) { this.status = status; }, end(body) { this.payload = JSON.parse(body); } };
    return { req, res };
}
function lanAddress() {
    for (const interfaces of Object.values(networkInterfaces()))
        for (const item of interfaces ?? [])
            if (!item.internal && item.family === "IPv4")
                return item.address;
    return "192.168.1.9";
}

test("真实快照按版本使正文和候选失效，写作台不扫描无关库", async () => {
    const work = await withWork("面板读取"), server = await servePanel({ storageRoot: work.base });
    try {
        await saveChapter(work.dir, { id: "c001", title: "一", body: "门外有人。" });
        const candidate = await stageCandidate(work.dir, { chapterId: "c001", body: "候选正文。" });
        const snapshot = async scope => (await (await fetch(server.api + '/snapshot?work=' + encodeURIComponent(work.key) + '&scope=' + scope)).json());
        let state = { ...initialState(), work: work.key, mode: 'novel' };
        const first = await snapshot('work');
        assert.equal('library' in first.snapshot, false);
        assert.equal('inspiration' in first.snapshot, false);
        assert.equal('body' in first.snapshot.chapters[0], false);
        assert.equal('body' in first.snapshot.candidates[0], false);
        state = reducer(state, {type:'snapshot', selection:0, data:first, signature:'first'});
        const key = bodyKey(state, 'chapter'), chapter = await readChapter(work.dir, 'c001');
        state = reducer(state, {type:'body', slot:'chapter', value:{key, status:'ready',body:chapter.body, meta:chapter}});
        const loaded = await (await fetch(server.api + '/chapter?work=' + encodeURIComponent(work.key) + '&id=c001')).json();
        assert.equal(loaded.body, chapter.body);
        await updateChapter(work.dir, {id:'c001',status:'reviewed',expectedRevision:chapter.revision,reviewResult:'pass'});
        state = reducer(state,{type:'snapshot',selection:0,data:await snapshot('work'),signature:'reviewed'});
        assert.equal(state.chapter.status, 'idle');
        assert.notEqual(bodyKey(state,'chapter'), key);
        const reviewedKey = bodyKey(state, 'chapter');
        await saveChapter(work.dir,{id:'c001',title:'一',body:'窗外无人。'});
        state = reducer(state,{type:'snapshot',selection:0,data:await snapshot('work'),signature:'body'});
        assert.notEqual(bodyKey(state,'chapter'),reviewedKey);
        const candidateVersion = first.snapshot.candidates[0].readVersion;
        await writeFile(work.dir+'/candidates/'+candidate.id+'.md','候选外部改稿。');
        const changed = await snapshot('work');
        assert.notEqual(changed.snapshot.candidates[0].readVersion,candidateVersion);
        const metaPath = work.dir+'/candidates/'+candidate.id+'.json';
        await writeFile(metaPath,JSON.stringify({...JSON.parse(await readFile(metaPath,'utf8')),note:'说明已改'}));
        assert.notEqual((await snapshot('work')).snapshot.candidates[0].readVersion,changed.snapshot.candidates[0].readVersion);
        const all = await snapshot('all');
        assert.ok(all.snapshot.library && all.snapshot.inspiration);
    } finally { await server.close(); await work.cleanup(); }
});

test("HTTP 采纳、审读和定稿调用共同作品操作", async () => {
    const work = await withWork("面板采纳");
    const server = await servePanel({ storageRoot: work.base });
    try {
        await setOutline(work.dir, "c001", { ending: "门开了" }, "第一章");
        await recordBriefBreadcrumb(work.dir, { chapterId: "c001", assetIds: [] });
        const candidate = await stageCandidate(work.dir, { chapterId: "c001", body: "她推开门。" });
        await markCandidateLinted(work.dir, candidate.id, 0);
        for (const confirm of [undefined, 1, "true"]) {
            const response = await jpost(server.api, "/candidate/accept", { work: work.key, candidate: candidate.id, confirm });
            assert.equal(response.status, 400);
            assert.equal((await response.json()).code, "confirm_required");
        }
        const invalid = await jpost(server.api, "/candidate/accept", { work: work.key, candidate: candidate.id, confirm: true, mode: "merge" });
        assert.equal((await invalid.json()).code, "bad_mode");
        const accepted = await jpost(server.api, "/candidate/accept", { work: work.key, candidate: candidate.id, confirm: true });
        assert.equal(accepted.status, 200);
        assert.equal((await readChapter(work.dir, "c001")).body, "她推开门。");
        const request = {work:work.key,chapter:'c001',expectedRevision:(await readChapter(work.dir,'c001')).revision,confirm:true};
        assert.equal((await jpost(server.api,'/chapter/review',{...request,expectedRevision:'stale'})).status,409);
        assert.equal((await jpost(server.api,'/chapter/finalize',request)).status,409);
        assert.equal((await jpost(server.api,'/chapter/review',request)).status,200);
        assert.equal((await jpost(server.api,'/chapter/finalize',request)).status,200);
        assert.equal((await readChapter(work.dir,'c001')).status,'final');
    }
    finally {
        await server.close();
        await work.cleanup();
    }
});

test("面板拒绝不可信来源、非 JSON 写入和未授权局域网访问", async () => {
    const work = await withWork("面板安全");
    const server = await servePanel({ storageRoot: work.base });
    try {
        const wrongType = await fetch(`${server.api}/candidate/accept`, { method: "POST", headers: { "content-type": "text/plain" }, body: "x" });
        assert.equal(wrongType.status, 415);
        assert.equal((await fetch(`${server.api}/works`, { headers: { origin: "http://evil.example" } })).status, 403);
        const rebound = fakeRequest({ headers: { host: "rebind.example", origin: "http://rebind.example" } });
        await createPanelApiHandler({ storageRoot: work.base })(rebound.req, rebound.res);
        assert.equal(rebound.res.status, 403);
        const tokenless = fakeRequest({ headers: { host: "localhost" } });
        await createPanelApiHandler({ storageRoot: work.base, panelToken: "secret" })(tokenless.req, tokenless.res);
        assert.equal(tokenless.res.status, 403);
        const local = lanAddress();
        const deny = fakeRequest({ remoteAddress: local });
        await createPanelApiHandler({ storageRoot: work.base })(deny.req, deny.res);
        assert.equal(deny.res.status, 403);
        const config = { storageRoot: work.base, allowLanPanel: true, panelHosts: ["panel.lan"], panelToken: "test-token" };
        const blocked = fakeRequest({ remoteAddress: local, headers: { host: "panel.lan:80" } });
        await createPanelApiHandler(config)(blocked.req, blocked.res);
        assert.equal(blocked.res.status, 403);
        const allowed = fakeRequest({ remoteAddress: local, headers: { host: "panel.lan:80", "x-zhizhang-token": "test-token" } });
        await createPanelApiHandler(config)(allowed.req, allowed.res);
        assert.notEqual(allowed.res.status, 403);
        const wrongMethod = await fetch(server.api+'/diagnostics/stage');
        assert.equal(wrongMethod.status,405);
        const badInput = await jpost(server.api,'/diagnostics/stage',{work:work.key,confirm:true,requestId:'invalid-source',source:null,edits:[]});
        assert.equal(badInput.status,400);
        const tooLarge = await jpost(server.api,'/diagnostics/scan',{padding:'x'.repeat(64001)});
        assert.equal(tooLarge.status,413);
        assert.equal((await tooLarge.json()).code,'body_too_large');
        const {req,res} = fakeRequest({method:'POST',url:'/api/dsh-zhizhang/diagnostics/scan',headers:{'content-type':'application/json'}});
        const pending = createPanelApiHandler({storageRoot:work.base})(req,res);
        req.emit('aborted');
        await pending;
        assert.equal(res.status,400);
        assert.equal(res.payload.code,'request_aborted');
        assert.equal(req.listenerCount('data'),0);

        const rateHandler = createPanelApiHandler({storageRoot:work.base});
        for (let i=0;i<21;i++) {
            const limited = fakeRequest({method:'POST',url:'/api/dsh-zhizhang/not-found'});
            await rateHandler(limited.req,limited.res);
            if(i===20) assert.equal(limited.res.status,429);
        }

    }
    finally {
        await server.close();
        await work.cleanup();
    }
});

test("客户端按当前 DSH 席位协议登记界面，错误交由宿主管理", () => {
    const client = loadedClient(), components = new Map();
    assert.deepEqual([...client.inject], ['slots']);
    const mount = () => {
        const names=[];
        client.apply({slots:{inject:(_name, factory)=>factory(),register:(spec, component)=>{names.push(spec.name);components.set(spec.name,component);}}});
        return names;
    };
    assert.deepEqual(mount(), ['main','sidebar.panellist','plugins.detail.section']);
    assert.deepEqual(mount(), ['main','sidebar.panellist','plugins.detail.section']);
    const Detail = components.get('plugins.detail.section');
    assert.notEqual(Detail({subject:{kind:'bundle',pkg:{name:'dsh-zhizhang'}}}),null);
    assert.equal(Detail({subject:{kind:'bundle',pkg:{name:'other'}}}),null);
});

test("客户端请求超时覆盖响应正文，取消后的 JSON 不回填", async (t) => {
    const { request } = await import("../src/client/api.js");
    t.mock.method(globalThis, "fetch", async (_url, { signal }) => ({ ok: true, status: 200, json: () => new Promise((_resolve, reject) => signal.addEventListener("abort", () => reject(new Error("aborted")), { once: true })) }));
    await assert.rejects(request("/chapter", { timeoutMs: 10 }), e => e.code === "timeout");
    const ctrl = new AbortController();
    const pending = request("/chapter", { timeoutMs: 1000, signal: ctrl.signal });
    await new Promise(resolve => setImmediate(resolve));
    ctrl.abort();
    await assert.rejects(pending, e => e.code === "aborted");
});


test("新的正文渲染以文本节点保留换行与 Markdown 结构", async()=>{
    const render = loadedClient().__testing.Manuscript;
    const flatten=x=>Array.isArray(x)?x.map(flatten).join(''):typeof x==='string'?x:x?.type==='br'?'\n':x?.children?flatten(x.children):'';
    const tree=render({text:'# 标题\r\n\r\n**门外**有人。\r\n<script>\r\n\r\n> 引用\r\n\r\n```\r\n**原样**\r\n```'});
    const visible=flatten(tree);
    assert.ok(visible.includes('门外有人。\n<script>'));assert.ok(visible.includes('**原样**'));
    assert.equal(flatten(render({text:'😀a',issues:[{start:0,end:1,id:'unicode',category:'rhythm',hint:'signal'}]})),'😀a');
    const overlapping = render({text:'他不禁退后。',annotationId:'reader-1',issues:[
        {start:0,end:6,id:'outer',category:'lazy_emotion',hint:'外层'},
        {start:1,end:3,id:'inner',category:'cliche_syntax',hint:'内层'},
    ]});
    const marks=[];
    const visit=node=>{if(Array.isArray(node))node.forEach(visit);else if(node&&typeof node==='object'){if(node.type==='mark')marks.push(node);visit(node.children);}};
    visit(overlapping);
    assert.ok(marks.some(mark=>mark.props['data-issue-ids']==='outer inner'));
    assert.ok(marks.some(mark=>mark.props['aria-describedby']==='reader-1-issue-outer reader-1-issue-inner'));
    assert.equal(tree.children.flat()[0].type,'h1');assert.ok(!JSON.stringify(tree).includes('dangerouslySetInnerHTML'));
});


test('诊断修订 HTTP 绑定来源、幂等请求及损坏目录边界', async () => {
    const { bodyHash } = await import('../dist/lib/services/diagnostics.js');
    const { unlink } = await import('node:fs/promises');
    const work = await withWork('修订边界'), server = await servePanel({storageRoot:work.base});
    try {
        await saveChapter(work.dir,{id:'c001',title:'一',body:'门外有人。'});
        const chapter = await readChapter(work.dir,'c001');
        const response = await jpost(server.api,'/diagnostics/scan',{work:work.key,chapter:'c001',kind:'chapter',expectedRevision:chapter.revision,bodyHash:bodyHash(chapter.body)});
        assert.equal(response.status,200);
        const report = await response.json();
        assert.equal('basis' in report.source,false);
        const edit = {...report.blocks[0],before:chapter.body,after:'门外无人。'};
        const input = {work:work.key,source:report.source,confirm:true,requestId:'canonical-request',edits:[edit]};
        const first = await (await jpost(server.api,'/diagnostics/stage',input)).json();
        assert.equal(first.ok,true);
        const reorder = object => Object.fromEntries(Object.entries(object).reverse());
        const second = await (await jpost(server.api,'/diagnostics/stage',{...input,source:reorder(report.source),edits:[reorder(edit)]})).json();
        assert.equal(second.candidateId,first.candidateId);
        assert.equal(second.reused,true);
        assert.equal((await readChapter(work.dir,'c001')).body,chapter.body);
        const conflict = await jpost(server.api,'/diagnostics/stage',{...input,edits:[{...edit,after:'窗外无人。'}]});
        assert.equal(conflict.status,409);
        assert.equal((await conflict.json()).code,'request_conflict');
        const wrongWork = await jpost(server.api,'/diagnostics/stage',{...input,source:{...report.source,workIdentity:'0'.repeat(64)}});
        assert.equal((await wrongWork.json()).code,'source_changed');
        const damaged = work.dir+'/candidates/damaged.json';
        await writeFile(damaged,'{');
        const blocked = await jpost(server.api,'/diagnostics/stage',{...input,requestId:'another-request'});
        assert.equal((await blocked.json()).code,'candidate_unavailable');
        await unlink(damaged);
        await saveChapter(work.dir,{id:'c001',title:'一',body:'章节已变化。'});
        const stale = await jpost(server.api,'/diagnostics/stage',{...input,requestId:'another-request'});
        assert.equal((await stale.json()).code,'source_changed');
    } finally {await server.close();await work.cleanup();}
});
