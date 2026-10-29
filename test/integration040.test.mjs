import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { BUILD, ROOT, fakeHost, tempDir } from './helpers.mjs'
const { apply } = await import(path.join(BUILD,'app/src/index.js'))
const store = await import(path.join(BUILD,'zhizhang/dist/lib/work-store.js'))
const { writerHooks, readWriterReview } = await import(path.join(BUILD,'zhizhang/dist/lib/writer-hooks.js'))
const { openWork, worksRoot } = await import(path.join(BUILD,'fanqie/src/zhizhang.js'))
const { withPluginConfig, openWork: originalOpen } = await import(path.join(BUILD,'zhizhang/dist/tools/context.js'))
const { Config: ZConfig } = await import(path.join(BUILD,'zhizhang/dist/index.js'))
const tick = () => new Promise(r=>setTimeout(r,30))
async function setup() {
 const root=await tempDir('writer040-');const host=fakeHost(); const sent=[]
 const get=host.root.ctx.get
 host.root.ctx.get=n=>n==='sessionController'?{prompt:async (req,signal)=>{assert.equal(signal.aborted,false);sent.push(req);return {accepted:true}}}:get(n)
 apply(host.root.ctx,{panel:false,zhizhang:{storageRoot:root},fanqie:{requireEditorPass:true}})
 const main=host.agent('main040-'+root,root)
 await host.call(main,'fanqie_enable');await host.call(main,'zhizhang_enable')
 await host.call(main,'zhizhang_project_create',{key:'book',title:'测试书'})
 await tick()
 const dir=path.join(root,'works/book');return {root,host,main,dir,sent}
}
test('单配置注册三个入口，织章源码及47项原测试完整保留',async()=>{
 const f=await setup();assert.deepEqual([...f.host.root.tools.keys()].sort(),['fanqie_enable','toutiao_enable','zhizhang_enable'])
 const baseline=JSON.parse(await readFile(path.join(ROOT,'docs/zhizhang-original-tests.json'),'utf8')); const {createHash}=await import('node:crypto');for(const [name,hash] of Object.entries(baseline)) assert.equal(createHash('sha256').update(await readFile(path.join(ROOT,'packages/zhizhang/test',name))).digest('hex'),hash)
})
test('番茄选择作品与织章当前会话选择一致',async()=>{
 const f=await setup();await f.host.call(f.main,'zhizhang_project_create',{key:'second',title:'第二本'})
 const cfg=ZConfig['~standard'].validate({storageRoot:f.root}).value
 const exec={agent:f.main};const original=await withPluginConfig(cfg,()=>originalOpen(exec,{}))
 const selected=await openWork(worksRoot(cfg,exec));assert.equal(selected.dir,original.dir);assert.equal(selected.key,'second')
})
test('投递为普通queue用户消息，编辑子会话不抢占主会话',async()=>{
 const f=await setup();const editor=f.host.agent('editor040',f.root);editor.session.header.origin='subagent'
 await f.host.call(editor,'fanqie_enable',{role:'editor'});await f.host.call(editor,'zhizhang_enable');await f.host.call(editor,'zhizhang_project_open',{work:'book'});await tick()
 await writerHooks.dispatch({base:f.root,dir:f.dir,work:'book',chapter:'c001',action:'review'})
 assert.equal(f.sent.length,1);assert.equal(f.sent[0].sessionId,f.main.session.id);assert.equal(f.sent[0].mode,'queue');assert.equal(f.sent[0].content[0].type,'text');assert.match(f.sent[0].content[0].text,/独立编辑子代理/)
 await assert.rejects(()=>writerHooks.dispatch({base:f.root+'-other',dir:f.dir+'-other',work:'book',chapter:'c001',action:'continue'}),/没有可投递/)
})
test('共享存储定稿门禁：对话save和面板update均拒绝缺失、旧版、未通过回报',async()=>{
 const f=await setup();const body='正文内容。';await store.saveChapter(f.dir,{id:'c001',title:'第一章',body})
 const ch=await store.readChapter(f.dir,'c001');await store.updateChapter(f.dir,{id:'c001',status:'reviewed',expectedRevision:ch.revision})
 const folder=path.join(f.dir,'writer-reviews/c001');await mkdir(folder,{recursive:true})
 const hash=(await import('node:crypto')).createHash('sha256').update(body).digest('hex')
 const write=async patch=>writeFile(path.join(folder,'latest.json'),JSON.stringify({body_sha256:hash,verdict:'通过',hard_issues:[],reread_full:true,...patch}))
 for(const invoke of [()=>store.saveChapter(f.dir,{id:'c001',title:'第一章',body,status:'final'}),()=>store.updateChapter(f.dir,{id:'c001',status:'final'})]) {
  for(const patch of [{body_sha256:'old'},{verdict:'未通过'},{hard_issues:[{}]},{reread_full:false}]) {await write(patch);await assert.rejects(invoke,/编辑回报/)}
 }
 await write({});await store.updateChapter(f.dir,{id:'c001',status:'final'});assert.equal((await store.readChapter(f.dir,'c001')).status,'final');assert.equal((await readWriterReview(f.dir,'c001',body)).fresh,true)
})
test('统一linter保留织章结果并附forge体检，删除独立工具',async()=>{
 const f=await setup();const result=await f.host.call(f.main,'zhizhang_style_lint',{text:'他不由得看向门口。\n\n'+'长'.repeat(180)+'。'})
 assert.equal(typeof result,'string');assert.match(result,/forge 正文体检/);assert.match(result,/超长段：1/);assert.equal(f.main.scope.tools.has('fanqie_manuscript_lint'),false)
 const forge=result.split('## forge')[1];assert.doesNotMatch(forge,/高频AI虚词泛滥：不由得/,'织章已报的同位置命中不重复附加')
})
test('真实面板HTTP定稿也受回报门禁，按钮接口投递到主会话',async t=>{
 const f=await setup();await store.saveChapter(f.dir,{id:'c001',title:'第一章',body:'面板正文。'})
 let ch=await store.readChapter(f.dir,'c001');await store.updateChapter(f.dir,{id:'c001',status:'reviewed',expectedRevision:ch.revision});ch=await store.readChapter(f.dir,'c001')
 const {createPanelApiHandler}=await import(path.join(BUILD,'zhizhang/dist/lib/http-api.js'))
 const {createServer}=await import('node:http');const server=createServer(createPanelApiHandler({storageRoot:f.root}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
 const url=`http://127.0.0.1:${server.address().port}/api/dsh-zhizhang`
 let res=await fetch(url+'/chapter/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({work:'book',chapter:'c001',confirm:true,expectedRevision:ch.revision})})
 assert.equal(res.status,409);assert.equal((await res.json()).code,'GATE_DENIED');assert.notEqual((await store.readChapter(f.dir,'c001')).status,'final')
 res=await fetch(url+'/writer/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({work:'book',chapter:'c001',action:'review',confirm:true})});assert.equal(res.status,200);assert.equal(f.sent[0].sessionId,f.main.session.id)
 res=await fetch(url+'/writer/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({work:'book',chapter:'c001',action:'review'})});assert.equal(res.status,400)
})
