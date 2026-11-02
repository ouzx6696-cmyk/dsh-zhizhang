import path from "node:path";
/** HTTP contracts and the one generated-client boundary. Pure state lives in domain tests. */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFile, writeFile } from "node:fs/promises";
import { saveChapter, setOutline, stageCandidate, markCandidateLinted, recordBriefBreadcrumb, readChapter, updateChapter } from "../../build/fanqie/src/engine/store.js";
import { initialState, reducer, bodyKey } from "../../packages/workbench/src/client/fanqie/state.js";
import { jpost, servePanel, withWork, loadComponents } from "./helpers.mjs";
test("真实快照按版本使正文和候选失效，写作台不扫描无关库", async () => {
    const work = await withWork("面板读取"), server = await servePanel({ storageRoot: work.base });
    try {
        await saveChapter(work.dir, { id: "c001", title: "一", body: "门外有人。" });
        const candidate = await stageCandidate(work.dir, { chapterId: "c001", body: "候选正文。" });
        const snapshot = async scope => (await (await fetch(server.api + '/snapshot?work=' + encodeURIComponent(work.key) + '&scope=' + scope)).json());
        let state = { ...initialState(), work: work.key, view: 'chapters' };
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
        const basis = await readChapter(work.dir, 'c001');
        const edit = {work: work.key, chapter: 'c001', body: '作者明确修订', expectedRevision: basis.revision};
        assert.equal((await jpost(server.api, '/chapter/save', edit)).status, 409);
        assert.equal((await readChapter(work.dir, 'c001')).body, basis.body);
        assert.equal((await jpost(server.api, '/chapter/save', {...edit, force: true})).status, 200);
        assert.equal((await readChapter(work.dir, 'c001')).status, 'drafted');

    }
    finally {
        await server.close();
        await work.cleanup();
    }
});


test("桌面请求取消后不回填结果，预先取消不发送 IPC", async () => {
    const { createDesktopAdapter } = await import('../../build/workbench/src/adapters/desktop.js');
    let settle, requests=0;
    const adapter = createDesktopAdapter({request:()=>{requests++;return new Promise(resolve=>{settle=resolve})}});
    const ctrl = new AbortController();
    const pending = adapter.fanqie.chapter('root','work','c001',ctrl.signal);
    ctrl.abort();
    settle({status:200,data:{body:'旧响应'}});
    await assert.rejects(pending,error=>error.code==='aborted');
    await assert.rejects(adapter.fanqie.chapter('root','work','c001',ctrl.signal),error=>error.code==='aborted');
    assert.equal(requests,1);
});

test("新的正文渲染以文本节点保留换行与 Markdown 结构", async()=>{
    const react = { createElement: (type, props, ...children) => ({ type, props, children }), Component: class {}, Fragment: 'fragment', memo: component => component };
    const render = loadComponents(react).Manuscript;
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
    const { bodyHash } = await import('../../build/fanqie/src/engine/services/diagnostics.js');
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

test("仪表盘按保存版本统计七天字数增加，不重复计算旧稿", async () => {
    const { writingActivity } = await import("../../build/fanqie/src/engine/dashboard-query.js");
    const { mkdir } = await import("node:fs/promises");
    const work = await withWork("字数统计");
    try {
        await mkdir(path.join(work.dir,"revisions","c001"),{recursive:true});
        const version = (date,words) => `---\n${JSON.stringify({updatedAt:date,wordCount:words})}\n---\n\n正文\n`;
        await writeFile(path.join(work.dir,"revisions","c001","old.md"),version(new Date(2026,9,26,1).toISOString(),80));
        await writeFile(path.join(work.dir,"revisions","c001","draft.md"),version(new Date(2026,9,30,1).toISOString(),100));
        await writeFile(path.join(work.dir,"chapters","c001.md"),version(new Date(2026,10,2,1).toISOString(),140));
        const result = await writingActivity(work.dir,[{id:"c001"}],new Date(2026,10,2,12));
        assert.equal(result.days.length,7);
        assert.equal(result.days.find(day=>day.date==="2026-10-30").words,20);
        assert.equal(result.days.at(-1).words,40);
        assert.equal(result.days.reduce((sum,day)=>sum+day.words,0),60);
    } finally { await work.cleanup(); }
});
