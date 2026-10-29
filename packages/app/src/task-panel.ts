/** Local task surface; same-origin token, registered roots and explicit session selection. */
import type { IncomingMessage, ServerResponse } from 'node:http'
import { randomBytes, timingSafeEqual } from 'node:crypto'
import { isLocalPanelRequest } from '../../core/src/http.js'
import { promptWriterSession, type HostContext } from '../../dsh-adapter/src/index.js'
import { type Tasks, type Task, stages } from './tasks.js'
const token=randomBytes(24).toString('hex')
const esc=(s:unknown)=>String(s??'').replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]!))
const labels={prepare:'准备',write:'写作',review:'审读',revise:'修改',deliver:'交付'}
const statuses={running:'进行中',needs_input:'需要作者决定',reviewing:'待审读',ready_for_acceptance:'待作者验收',completed:'已完成',failed:'执行失败',cancelled:'已取消'}
const style=`body{font:15px/1.7 system-ui,sans-serif;color:#242424;background:#f7f7f5;margin:0}main{max-width:1100px;margin:auto;padding:24px}h1{font-size:23px}h2{font-size:18px}a{color:#275d99}nav,.row{display:flex;gap:12px;flex-wrap:wrap}section{background:white;border:1px solid #ddd;border-radius:9px;padding:18px;margin:16px 0}pre{white-space:pre-wrap;overflow-wrap:anywhere;font:inherit}button,select,input,textarea{font:inherit;padding:8px;border:1px solid #bbb;border-radius:5px}button{cursor:pointer}textarea{display:block;width:95%;min-height:100px}label{display:block;margin:10px 0}.muted{color:#666}.columns{display:grid;grid-template-columns:1fr 1fr;gap:16px}.step{padding:4px 10px;background:#eee;border-radius:5px}.active{background:#dceafa;font-weight:bold}@media(max-width:650px){.columns{grid-template-columns:1fr}main{padding:12px}}`
const page=(body:string)=>`<!doctype html><html lang="zh-CN"><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>写作 Agent</title><style>${style}</style><main><h1>写作 Agent</h1><nav><a href="/writer">最近任务</a><a href="/writer?mode=toutiao">头条写作</a><a href="/writer?mode=fanqie">番茄小说</a><a href="/writer/toutiao">头条稿件与采用</a></nav>${body}</main><script>document.querySelectorAll('form').forEach(f=>{f.addEventListener('submit',()=>{f.querySelectorAll('button').forEach(b=>{b.disabled=true;b.textContent='正在提交…'})});const select=f.querySelector('select[name=session]');if(select){const update=()=>f.querySelectorAll('[data-mode-fields]').forEach(el=>{el.hidden=el.dataset.modeFields!==select.selectedOptions[0]?.dataset.mode});select.addEventListener('change',update);update()}});</script></html>`
const hidden=(name:string,value:unknown)=>`<input type="hidden" name="${name}" value="${esc(value)}">`
const form=(t:Task,action:string,label:string,extra='')=>`<form method="post" action="/writer/action">${hidden('token',token)}${hidden('cwd',t.cwd)}${hidden('id',t.id)}${hidden('action',action)}${extra}<button>${label}</button></form>`
function send(res:ServerResponse,status:number,body:string,type='text/html; charset=utf-8') {res.writeHead(status,{'content-type':type,'cache-control':'no-store','x-content-type-options':'nosniff','x-frame-options':'SAMEORIGIN','referrer-policy':'same-origin'});res.end(body)}
async function body(req:IncomingMessage) {
 let size=0;const chunks:Buffer[]=[]
 for await(const chunk of req){const b=Buffer.from(chunk);size+=b.length;if(size>65536)throw new Error('请求过大');chunks.push(b)}
 return new URLSearchParams(Buffer.concat(chunks).toString('utf8'))
}
export function taskPanel(tasks:Tasks,ctx:HostContext) {
 async function view(req:IncomingMessage,res:ServerResponse) {
  if(!isLocalPanelRequest(req))return send(res,403,'forbidden')
  if(req.method!=='GET')return send(res,405,'GET required')
  try {
   const u=new URL(req.url??'/','http://localhost'),cwd=u.searchParams.get('cwd'),id=u.searchParams.get('id')
   if(cwd&&id){
    if(!tasks.roots.has(cwd))return send(res,404,page('<p>请先在对应项目会话启用写作模式。</p>'))
    const t=await tasks.mutate(cwd,id,async t=>{await tasks.refresh(t)}),c=await tasks.context(t) as any
    const text=t.mode==='toutiao'?c.body:c.chapter?.body
    const old=t.mode==='toutiao'?c.previousBody:c.candidates?.[0]?.body
    const sessions=[...tasks.sessions].filter(([,s])=>s.cwd===t.cwd&&s.mode===t.mode)
    const select=`<label>投递主会话 <select name="session" required>${sessions.map(([id])=>`<option ${id===t.sessionId?'selected':''} value="${esc(id)}">${esc(id)}</option>`).join('')}</select></label>`
    const actions=['completed','cancelled'].includes(t.status)?'':(sessions.length ? form(t,'resume','继续任务',select)+form(t,'review','快速审读',select+hidden('review','quick'))+form(t,'review','独立编辑',select+hidden('review','editor'))+form(t,'review','作者审阅',select+hidden('review','manual'))+form(t,'cancel','取消任务') : '<p>请先在对应项目的主会话启用该写作模式。</p>'+form(t,'cancel','取消任务'))
    const review=t.mode==='toutiao'?JSON.stringify(c.article?.qa?.slice(-1),null,2):JSON.stringify(c.review,null,2)
    return send(res,200,page(`<section><h2>${esc(t.goal)}</h2><p>${t.mode==='toutiao'?'头条':'小说'} · ${esc(t.target.article||c.work?.title||t.target.work||'尚未绑定作品')} ${esc(t.target.chapter)} · ${statuses[t.status]}</p><div class="row">${stages.map(s=>`<span class="step ${s===t.step?'active':''}">${labels[s]}</span>`).join('')}</div><p>${esc(t.next)}</p><p><a href="/writer?cwd=${encodeURIComponent(t.cwd)}&id=${t.id}">刷新任务进度</a></p>${t.error?`<p role="alert">${esc(t.error)}</p>`:''}<div class="row">${actions}${form(t,'export-md','导出 Markdown')}${form(t,'export-txt','导出 TXT')}</div></section><section><h2>正文与版本</h2><p class="muted">当前版本 ${esc(t.revision||'尚无正文')}；修订 ${t.attempts}/${t.maxRounds} 轮</p><div class="columns"><div><h3>当前正文</h3><pre>${esc(text||'正文尚未保存。继续任务后由 DSH Agent 生成并保存。')}</pre></div><div><h3>${t.mode==='toutiao'?'上一版本':'待采纳候选'}</h3><pre>${esc(old||'暂无对照版本')}</pre></div></div></section><section><h2>审读与问题</h2><pre>${esc(review||'尚无审读回报')}</pre></section>${t.continuity?`<section><h2>连续性变化（${t.continuity.accepted?'作者已确认':'待作者确认'}）</h2><pre>${esc(t.continuity.text)}</pre>${t.continuity.accepted?'':form(t,'memory','确认这份变化摘要',hidden('revision',t.continuity.revision))}<p class="muted">确认保留在任务中；正式设定仍须通过原作品工具更新，不自动覆盖。</p></section>`:''}<p class="muted">采纳与定稿在小说工作台完成；头条采用在头条稿件页完成。任务状态由实际产物校准。更新时间 ${esc(t.updatedAt)}</p>`))
   }
   const mode=u.searchParams.get('mode')
   const sessions=[...tasks.sessions].filter(([,s])=>!mode||s.mode===mode)
   const rows=(await Promise.all([...tasks.roots].map(c=>tasks.list(c)))).flat().filter(t=>!mode||t.mode===mode).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
   const start=`<section><h2>开始写作</h2>${sessions.length?`<form method="post" action="/writer/action">${hidden('token',token)}${hidden('action','start')}<label>写作模式与主会话 <select name="session">${sessions.map(([id,s])=>`<option data-mode="${s.mode}" value="${esc(id)}">${s.mode==='toutiao'?'头条':'番茄'} · ${esc(s.cwd)} · ${esc(id)}</option>`).join('')}</select></label><label>目标与素材<textarea name="goal" required maxlength="30000" placeholder="写什么、修改什么，或提供素材"></textarea></label><label>任务类型 <select name="intent"><option value="create">新建</option><option value="continue">续写</option><option value="revise">修改</option><option value="review">审读</option></select></label><label>已有作品 key / 文章 id <input name="target"></label><div data-mode-fields="fanqie"><label>章节 id（小说，可选）<input name="chapter"></label><label>小说存储根（可选）<input name="working_dir"></label></div><div data-mode-fields="toutiao"><label>头条内容线 <select name="line"><option>资讯线</option><option>故事线</option></select></label><label>头条体裁 <select name="format"><option>长图文</option><option>短图文</option><option>微头条</option></select></label></div><button>开始任务</button></form>`:'<p>请先在 DSH 主会话启用头条或番茄写作。恢复旧项目时，在该项目会话重新启用即可读取原任务。</p>'}</section>`
   return send(res,200,page(start+`<section><h2>最近任务</h2>${rows.length?rows.map(t=>`<p><a href="/writer?cwd=${encodeURIComponent(t.cwd)}&id=${t.id}">${esc(t.goal)}</a> · ${t.mode==='toutiao'?'头条':'番茄'} · ${statuses[t.status]}<br><span class="muted">${esc(t.target.work||t.target.article)} ${esc(t.target.chapter)} · ${esc(t.next)}</span></p>`).join(''):'暂无任务。旧文章和小说仍保留在原工作台。'}</section>`))
  }catch(e){return send(res,409,page(`<p role="alert">${esc(e instanceof Error?e.message:e)}</p>`))}
 }
 async function action(req:IncomingMessage,res:ServerResponse) {
  if(!isLocalPanelRequest(req))return send(res,403,'forbidden')
  if(req.method!=='POST')return send(res,405,'POST required')
  try {
   const f=await body(req),a=Buffer.from(f.get('token')??''),b=Buffer.from(token)
   if(a.length!==b.length||!timingSafeEqual(a,b))return send(res,403,'bad token')
   const action=f.get('action'),sid=f.get('session')??''
   let t:Task
   if(action==='start') {
    const s=tasks.sessions.get(sid);if(!s)throw new Error('请重新选择已启用的主会话')
    const exec={name:'writer_panel',arguments:{},agent:{session:{id:sid,header:{cwd:s.cwd}}}}
    t=await tasks.run(exec,s.mode,{goal:f.get('goal'),intent:f.get('intent'),...(s.mode==='toutiao'?{article:f.get('target'),line:f.get('line'),format:f.get('format')}:{work:f.get('target'),chapter:f.get('chapter'),working_dir:f.get('working_dir')})} as Record<string,unknown>)
   }else{
    const cwd=f.get('cwd')??'';if(!tasks.roots.has(cwd))throw new Error('项目未登记，请先启用对应写作模式')
    t=await tasks.get(cwd,f.get('id')??'')
   }
   if(action?.startsWith('export-')){const format=action.slice(7);const result=await tasks.export(t,format);res.setHeader('content-disposition',`attachment; filename="writer-${t.id}.${format}"`);return send(res,200,result.content,'text/plain; charset=utf-8')}
   if(action==='cancel'){t=await tasks.mutate(t.cwd,t.id,async t=>{t.status='cancelled';t.next='任务已取消；已有稿件保留。'});}
   else if(action==='memory'){t=await tasks.mutate(t.cwd,t.id,async t=>{await tasks.refresh(t);if(!t.continuity||t.continuity.revision!==f.get('revision')||t.revision!==f.get('revision'))throw new Error('正文版本已变化，请重新提取连续性变化');t.continuity.accepted=true;});}
   else {
    if(!['start','resume','review'].includes(action??''))throw new Error('未知操作')
    const session=tasks.sessions.get(sid);if(!session||session.cwd!==t.cwd||session.mode!==t.mode)throw new Error('请选择本项目、对应模式的主会话')
    t=await tasks.mutate(t.cwd,t.id,async t=>{if(['cancelled','completed'].includes(t.status))throw new Error('任务已结束');t.sessionId=sid;if(action==='resume' && t.attempts>=t.maxRounds)t.maxRounds=t.attempts+1;t.status='running';if(action==='review'){const r=f.get('review');if(!['quick','editor','manual'].includes(r??''))throw new Error('审读模式无效');await tasks.beginReview(t,r as Task['review']);}delete t.error;await tasks.refresh(t);})
    tasks.activate(t)
    try {await promptWriterSession(ctx,sid,`继续写作任务 ${t.id}。请先调用 writer_resume(task_id="${t.id}")，核对目标：${JSON.stringify(t.target)}。本次目标：${t.goal}。${action==='review'?'随后调用 writer_review，review='+t.review+'。':''}按返回 next 连续执行并保存阶段产物，结束前 checkpoint。不得另建重复稿件；采纳定稿仍须作者确认。`)}
    catch(e){await tasks.dispatchFailed(t,e);throw e}
   }
   res.writeHead(303,{location:`/writer?cwd=${encodeURIComponent(t.cwd)}&id=${t.id}`,'cache-control':'no-store'});res.end()
  }catch(e){return send(res,409,page(`<p role="alert">${esc(e instanceof Error?e.message:e)}</p><p><a href="/writer">返回任务</a></p>`))}
 }
 return [{path:'/writer',handler:(req:IncomingMessage,res:ServerResponse)=>{void view(req,res)}},{path:'/writer/action',handler:(req:IncomingMessage,res:ServerResponse)=>{void action(req,res)}}]
}
