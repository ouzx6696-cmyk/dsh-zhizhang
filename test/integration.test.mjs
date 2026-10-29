import { test } from 'node:test'
import assert from 'node:assert/strict'
import { readFile, writeFile, mkdir } from 'node:fs/promises'
import path from 'node:path'
import { importModule, BUILD, ROOT, fakeHost, tempDir } from './helpers.mjs'
const { apply } = await importModule(path.join(BUILD,'app/src/index.js'))
const store = await importModule(path.join(BUILD,'zhizhang/dist/lib/work-store.js'))
const { writerHooks, readWriterReview } = await importModule(path.join(BUILD,'zhizhang/dist/lib/writer-hooks.js'))
const { openWork, worksRoot } = await importModule(path.join(BUILD,'fanqie/src/zhizhang.js'))
const { withPluginConfig, openWork: originalOpen } = await importModule(path.join(BUILD,'zhizhang/dist/tools/context.js'))
const { Config: ZConfig } = await importModule(path.join(BUILD,'zhizhang/dist/index.js'))
const tick = () => new Promise(r=>setTimeout(r,30))
async function setup() {
 const root=await tempDir('writer-integration-');const host=fakeHost(); const sent=[]
 const get=host.root.ctx.get
 host.root.ctx.get=n=>n==='sessionController'?{prompt:async (req,signal)=>{assert.equal(signal.aborted,false);sent.push(req);return {accepted:true}}}:get(n)
 apply(host.root.ctx,{compatibilityEntry:true,panel:false,zhizhang:{storageRoot:root},fanqie:{requireEditorPass:true}})
 const main=host.agent('main-'+root,root)
 await host.call(main,'fanqie_enable');await host.call(main,'zhizhang_enable')
 await host.call(main,'zhizhang_project_create',{key:'book',title:'测试书'})
 await tick()
 const dir=path.join(root,'works/book');return {root,host,main,dir,sent}
}
test('兼容模式保留旧小说入口',async()=>{
 const f=await setup();assert.deepEqual([...f.host.root.tools.keys()].sort(),['fanqie_enable','toutiao_enable','zhizhang_enable'])
})
test('番茄选择作品与织章当前会话选择一致',async()=>{
 const f=await setup();await f.host.call(f.main,'zhizhang_project_create',{key:'second',title:'第二本'})
 const cfg=ZConfig['~standard'].validate({storageRoot:f.root}).value
 const exec={agent:f.main};const original=await withPluginConfig(cfg,()=>originalOpen(exec,{}))
 const selected=await openWork(worksRoot(cfg,exec));assert.equal(selected.dir,original.dir);assert.equal(selected.key,'second')
 const get=f.main.ctx.get
 f.main.ctx.get=name=>name==='workingDirectory'?{get:()=>f.root}:get(name)
 f.main.session.header.cwd=path.join(f.root,'different-header')
 assert.equal(store.storagePaths({agent:f.main},{rootDir:'.zhizhang'},undefined).base,path.join(f.root,'.zhizhang'))
})
test('投递为普通queue用户消息，编辑子会话不抢占主会话',async()=>{
 const f=await setup();const editor=f.host.agent('editor',f.root);editor.session.header.origin='subagent'
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
 const write=async patch=>writeFile(path.join(folder,'latest.json'),JSON.stringify({body_sha256:hash,verdict:'通过',hard_issues:[],reread_full:true,by:'editor',...patch}))
 for(const invoke of [()=>store.saveChapter(f.dir,{id:'c001',title:'第一章',body,status:'final'}),()=>store.updateChapter(f.dir,{id:'c001',status:'final'})]) {
  for(const patch of [{body_sha256:'old'},{verdict:'未通过'},{hard_issues:[{}]},{reread_full:false},{by:'writer'}]) {await write(patch);await assert.rejects(invoke,/编辑回报/)}
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
 const {createPanelApiHandler}=await importModule(path.join(BUILD,'zhizhang/dist/lib/http-api.js'))
 const {createServer}=await import('node:http');const server=createServer(createPanelApiHandler({storageRoot:f.root}));await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
 const url=`http://127.0.0.1:${server.address().port}/api/dsh-zhizhang`
 let res=await fetch(url+'/chapter/finalize',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({work:'book',chapter:'c001',confirm:true,expectedRevision:ch.revision})})
 assert.equal(res.status,409);assert.equal((await res.json()).code,'GATE_DENIED');assert.notEqual((await store.readChapter(f.dir,'c001')).status,'final')
 res=await fetch(url+'/writer/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({work:'book',chapter:'c001',action:'review',confirm:true})});assert.equal(res.status,200);assert.equal(f.sent[0].sessionId,f.main.session.id)
 res=await fetch(url+'/writer/action',{method:'POST',headers:{'content-type':'application/json'},body:JSON.stringify({work:'book',chapter:'c001',action:'review'})});assert.equal(res.status,400)
})

test('小说任务：配置路径、章节绑定、待确认变化与本机任务页闭环',async t=>{
 const f=await setup()
 await store.saveChapter(f.dir,{id:'c001',title:'第一章',body:'已有正文，不重新生成。'})
 const {Tasks}=await importModule(path.join(BUILD,'app/src/tasks.js'))
 const {taskPanel}=await importModule(path.join(BUILD,'app/src/task-panel.js'))
 const tasks=new Tasks({toutiao:{},fanqie:{zhizhang:{storageRoot:f.root}}})
 const exec={name:'writer_run',arguments:{},agent:f.main}
 tasks.bind(exec,'fanqie')
 const task=await tasks.run(exec,'fanqie',{goal:'审读第一章',intent:'review',work:'book',chapter:'c001'})
 const context=await tasks.context(task)
 assert.equal(context.chapter.body,'已有正文，不重新生成。')
 assert.equal(task.target.dir,f.dir)
 const wrong=await tasks.guard({...exec,name:'zhizhang_chapter_save',arguments:{work:'book',chapter:'c002'}})
 assert.equal(wrong.kind,'deny')
 await tasks.checkpoint(exec,{task_id:task.id,continuity:'新增人物状态，待作者核对'})
 assert.equal((await tasks.get(f.root,task.id)).continuity.accepted,false)
 const {createServer}=await import('node:http')
 const routes=taskPanel(tasks,f.host.root.ctx)
 const server=createServer((req,res)=>{const route=routes.find(r=>r.path===new URL(req.url,'http://localhost').pathname);if(route)route.handler(req,res);else {res.statusCode=404;res.end()}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
 const url=`http://127.0.0.1:${server.address().port}`
 const page=await (await fetch(url+`/writer?cwd=${encodeURIComponent(f.root)}&id=${task.id}`)).text()
 assert.match(page,/已有正文，不重新生成/)
 assert.match(page,/待作者确认/)
 const denied=await fetch(url+'/writer/action',{method:'POST',body:new URLSearchParams({action:'cancel',cwd:f.root,id:task.id})})
 assert.equal(denied.status,403)
 const token=page.match(/name="token" value="([a-f0-9]+)"/)[1]
 const posted=await fetch(url+'/writer/action',{method:'POST',body:new URLSearchParams({token,action:'memory',cwd:f.root,id:task.id,revision:task.revision}),redirect:'manual'})
 assert.equal(posted.status,303)
 assert.equal((await tasks.get(f.root,task.id)).continuity.accepted,true)

 // 直接审阅走小说原有审阅声明，审读任务不把旧回报当成本次结果。
 const chapter=await store.readChapter(f.dir,'c001')
 await store.updateChapter(f.dir,{id:'c001',status:'reviewed',expectedRevision:chapter.revision})
 const manual=await tasks.run(exec,'fanqie',{goal:'作者重新审阅',intent:'review',work:'book',chapter:'c001',review:'manual'})
 assert.equal(manual.status,'reviewing')
 const tools=tasks.tools('fanqie')
 const resumed=f.host.agent('manual-resume',f.root)
 tasks.bind({name:'fanqie_enable',arguments:{},agent:resumed},'fanqie')
 const transfer=tools.find(tool=>tool.name==='writer_resume')
 await transfer.execute({task_id:manual.id},{name:'writer_resume',arguments:{},agent:resumed})
 const conflict=await tasks.guard({...exec,name:'zhizhang_chapter_save',arguments:{work:'book',chapter:'c001'}})
 assert.equal(conflict.kind,'deny')

 // 新书恢复始终指向预留目录，不因中断创建另一本。
 const freshTask=await tasks.run(exec,'fanqie',{goal:'新建一本书',intent:'create'})
 const invalid=await tasks.guard({...exec,name:'zhizhang_project_create',arguments:{title:'新书',key:freshTask.creationKey}})
 assert.equal(invalid.kind,'deny')
 const created=await f.host.call(f.main,'zhizhang_project_create',{title:'新书',key:freshTask.creationKey,strict_key:true})
 assert.match(created,/已创建作品/)
 const recovered=await tasks.mutate(f.root,freshTask.id,async task=>{await tasks.refresh(task)})
 assert.equal(recovered.target.work,freshTask.creationKey)
 const duplicate=await tasks.guard({...exec,name:'zhizhang_project_create',arguments:{title:'新书',key:freshTask.creationKey,strict_key:true}})
 assert.equal(duplicate.kind,'deny')
})

test('审读历史按真实时间排序，旧时区格式与新回报都可读取',async()=>{
 const f=await setup()
 const { saveReview,latestReview }=await importModule(path.join(BUILD,'fanqie/src/env.js'))
 const base={work:'book',work_title:'测试书',chapter:'c001',chapter_title:'第一章',body_sha256:'x',verdict:'通过',hard_issues:[],levels:[],optional:[],reread_full:true,changed_scope:'未改',strengths:'',by:'editor'}
 await saveReview({},undefined,{...base,at:'2026-10-29T10:00:00+08:00',strengths:'旧回报'},f.dir)
 await saveReview({},undefined,{...base,at:'2026-10-29T03:00:00.000Z',strengths:'新回报'},f.dir)
 assert.equal((await latestReview({},undefined,'book','c001',f.dir)).strengths,'新回报')
})

test('续章从选中章节继续，同一作品有多个会话时要求明确选择',async()=>{
 const f=await setup()
 await store.saveChapter(f.dir,{id:'c001',title:'第一章',body:'第一章正文'})
 await store.saveChapter(f.dir,{id:'c002',title:'第二章',body:'第二章正文'})
 await f.host.call(f.main,'zhizhang_project_open',{work:'book'})
 await tick()
 await writerHooks.dispatch({base:f.root,dir:f.dir,work:'book',chapter:'c001',action:'continue'})
 assert.match(f.sent.at(-1).content[0].text,/目标章节 c002/)
 const other=f.host.agent('main-second',f.root)
 await f.host.call(other,'fanqie_enable')
 await f.host.call(other,'zhizhang_enable')
 await f.host.call(other,'zhizhang_project_open',{work:'book'})
 await tick()
 await assert.rejects(()=>writerHooks.dispatch({base:f.root,dir:f.dir,work:'book',chapter:'c001',action:'continue'}),/多个主会话/)
})

test('工作台路由由宿主注册，真实 HTTP 保留访问与方法边界',async t=>{
 const host=fakeHost(),routes=new Map(),get=host.root.ctx.get
 host.root.ctx.get=name=>name==='webServer'?{register(route){routes.set(route.path,route.handler);return()=>routes.delete(route.path)}}:get(name)
 apply(host.root.ctx,{})
 const expected=['/writer','/writer/action','/writer/toutiao','/writer/toutiao/api/adopt',
  '/api/dsh-zhizhang','/api/dsh-zhizhang/health','/api/dsh-zhizhang/diagnostics/capabilities',
  '/api/dsh-zhizhang/diagnostics/scan','/api/dsh-zhizhang/diagnostics/stage',
  '/api/dsh-zhizhang/projects','/api/dsh-zhizhang/works','/api/dsh-zhizhang/snapshot',
  '/api/dsh-zhizhang/library','/api/dsh-zhizhang/report','/api/dsh-zhizhang/inspiration',
  '/api/dsh-zhizhang/chapter','/api/dsh-zhizhang/candidate','/api/dsh-zhizhang/candidate/accept',
  '/api/dsh-zhizhang/chapter/review','/api/dsh-zhizhang/chapter/finalize',
  '/api/dsh-zhizhang/writer/action','/api/dsh-zhizhang/revision/acknowledge','/api/dsh-zhizhang/unify/prepare']
 assert.deepEqual([...routes.keys()].sort(),expected.sort())
 const {createServer}=await import('node:http')
 const server=createServer((req,res)=>{const route=routes.get(new URL(req.url,'http://localhost').pathname);if(route)route(req,res);else {res.statusCode=404;res.end()}})
 await new Promise(resolve=>server.listen(0,'127.0.0.1',resolve));t.after(()=>server.close())
 const root=`http://127.0.0.1:${server.address().port}`
 for(const target of ['/writer','/writer/toutiao','/api/dsh-zhizhang/health','/api/dsh-zhizhang/diagnostics/capabilities']){
  const response=await fetch(root+target);assert.equal(response.status,200,target)
 }
 const {request}=await import('node:http')
 const badHost=await new Promise((resolve,reject)=>{
  const req=request(root+'/writer',{headers:{host:'untrusted.example'}},res=>{res.resume();resolve(res.statusCode)})
  req.on('error',reject);req.end()
 })
 assert.equal(badHost,403)
 assert.equal((await fetch(root+'/writer/toutiao',{headers:{origin:'http://untrusted.example'}})).status,403)
 assert.equal((await fetch(root+'/writer/action')).status,405)
 assert.equal((await fetch(root+'/writer/action',{method:'POST',body:'action=cancel'})).status,403)
 assert.equal((await fetch(root+'/api/dsh-zhizhang/candidate/accept')).status,405)
})
