/** Small persistent task facade. DSH owns inference; business stores own manuscripts. */
import path from 'node:path'
import { randomUUID } from 'node:crypto'
import { mkdir, readdir } from 'node:fs/promises'
import { readJson, readText, serialize, sha256 } from '../../core/src/fsx.js'
import { defineWriterTool, sessionCwd, sessionIdOf, WriterError, type HostToolExecution } from '../../dsh-adapter/src/index.js'
import { storeFor, type ToutiaoConfig } from '../../toutiao/src/env.js'
import { ArticleStore, today } from '../../toutiao/src/store.js'
import { validPassingQa } from '../../toutiao/src/tools.js'
import { openWork, worksRoot, readChapter, listWorks } from '../../fanqie/src/zhizhang.js'
import { type FanqieConfig, latestReview } from '../../fanqie/src/env.js'
import { readWorkMeta, listCandidates, readCandidate } from '../../zhizhang/dist/lib/work-store.js'
import type { WorkMeta } from '../../zhizhang/dist/lib/types.js'
import { withResourceLock } from '../../zhizhang/dist/lib/storage/process-lock.js'
import { assertSafeAncestors, atomicWrite } from '../../zhizhang/dist/lib/storage/primitives.js'

export type Mode = 'toutiao' | 'fanqie'
export type Intent = 'create' | 'continue' | 'revise' | 'review' | 'export'
export type ReviewMode = 'quick' | 'editor' | 'manual'
export interface Task {
  schema: 1; id: string; mode: Mode; intent: Intent; goal: string; cwd: string; sessionId: string
  target: { root?: string; article?: string; work?: string; chapter?: string; dir?: string; base?: string }
  creationKey?: string; autoArticle?: boolean; articleLine?: string; articleGenre?: string; baseRevision?: string
  review: ReviewMode; status: 'running' | 'needs_input' | 'reviewing' | 'ready_for_acceptance' | 'completed' | 'failed' | 'cancelled'
  step: 'prepare' | 'write' | 'review' | 'revise' | 'deliver'; next: string
  revision?: string; artifact?: string; error?: string; note?: string
  reviewBaseline?: string; reviewPending?: boolean
  attempts: number; maxRounds: number; updatedAt: string; createdAt: string
  continuity?: { revision: string; text: string; accepted: boolean }
}
export interface TaskConfig {
  toutiao: ToutiaoConfig; fanqie: FanqieConfig
  workflow?: { review?: ReviewMode; maxAutoRevisionRounds?: number }
}
const intents: Intent[] = ['create','continue','revise','review','export']
const reviews: ReviewMode[] = ['quick','editor','manual']
const stages = ['prepare','write','review','revise','deliver'] as const
const S = (description: string) => ({ type: 'string' as const, description })
const E = (values: string[], description: string) => ({ ...S(description), enum: values })
const str = (v: unknown) => typeof v === 'string' ? v.trim() : ''
export const TASK_BRIEF = `# 写作任务
用户提出写作/续写/改稿/审读目标时，先 writer_run，恢复用 writer_resume。持续执行返回的 next 与 route，不要每一步等待用户催促；产物立即用现有业务工具保存。生成由 DSH 会话完成，不把“任务已建立”当作“稿件已完成”。每次业务阶段完成、需用户输入、出错或结束前用 writer_checkpoint 记录，再 writer_status 核实。单任务只绑定一篇文章或一章；创建对象后立即 checkpoint 绑定，之后不允许换书换章。小说工具明确传 work 和 chapter；如果任务 target.base 有值，各小说工具同时传 working_dir=target.base。默认一份主候选、一轮编辑；自动返修达到上限就呈交作者。审读、采纳、定稿的既有门禁继续有效。作者有原稿时从修改/审读开始。manual 仍须作者审阅并走原定稿/交稿接口，不伪造通过。编辑角色只审读，不调用任务写入工具。新事实/人物变化/伏笔用 writer_checkpoint continuity 提交待确认摘要；作者确认后才可用原设定工具写入正式资产。`

export class Tasks {
  readonly sessions = new Map<string, { mode: Mode; cwd: string; taskId?: string }>()
  readonly roots = new Set<string>()
  constructor(readonly config: TaskConfig) {}
  folder(cwd: string) { return path.join(path.resolve(cwd), '.writer', 'tasks') }
  file(cwd: string, id: string) {
    if (!/^[a-f0-9-]{36}$/.test(id)) throw new WriterError('INVALID_ARGS','任务 id 不合法')
    return path.join(this.folder(cwd), id + '.json')
  }
  async save(t: Task) { t.updatedAt = new Date().toISOString(); await atomicWrite(this.file(t.cwd,t.id), JSON.stringify(t,null,2)); this.roots.add(t.cwd) }
  bind(exec: HostToolExecution, mode: Mode) {
    const cwd = path.resolve(sessionCwd(exec)); this.roots.add(cwd)
    const id = sessionIdOf(exec), existing = this.sessions.get(id)
    if (!existing || existing.cwd !== cwd || existing.mode !== mode) this.sessions.set(id, {mode,cwd})
  }
  async list(cwd: string) {
    let names: string[]
    try { names = await readdir(this.folder(cwd)) } catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return []; throw e }
    const rows = await Promise.all(names.filter(n=>/^[a-f0-9-]{36}\.json$/.test(n)).map(n=>readJson<Task>(path.join(this.folder(cwd),n))))
    return rows.filter((t): t is Task => !!t).sort((a,b)=>b.updatedAt.localeCompare(a.updatedAt))
  }
  async get(cwd: string, id: string) {
    const t = await readJson<Task>(this.file(cwd,id))
    if (!t || t.schema !== 1 || t.cwd !== path.resolve(cwd)) throw new WriterError('NOT_FOUND','没有这个任务')
    return t
  }
  activate(t: Task) { const s=this.sessions.get(t.sessionId); if(s && s.cwd===t.cwd && s.mode===t.mode)s.taskId=t.id }
  async current(exec: HostToolExecution, id?: string) {
    const cwd = path.resolve(sessionCwd(exec)), binding = this.sessions.get(sessionIdOf(exec))
    const selected=id||binding?.taskId
    const t = selected ? await this.get(cwd,selected) : (await this.list(cwd)).find(t=>t.sessionId === sessionIdOf(exec) && (!binding || t.mode === binding.mode) && t.status !== 'cancelled' && t.status !== 'completed')
    if (!t) throw new WriterError('NOT_FOUND','没有当前任务；先 writer_run，或指定 task_id 恢复历史任务')
    if (binding && t.mode !== binding.mode) throw new WriterError('CONFLICT','任务属于另一写作模式，请在对应模式的新会话恢复')
    return t
  }
  async mutate(cwd: string, id: string, fn: (t: Task)=>Promise<void>) {
    const folder = this.folder(cwd)
    await assertSafeAncestors(path.join(folder, '.task-check'))
    await mkdir(folder, { recursive: true })
    return withResourceLock(folder, async()=>{const t=await this.get(cwd,id); await fn(t); await this.save(t); return t})
  }
  async dispatchFailed(task: Task, error: unknown) {
    await this.mutate(task.cwd,task.id,async t=>{
      t.status='failed'
      t.error=error instanceof Error ? error.message : String(error)
      t.next='会话投递未确认，请查看主会话与已存产物后恢复；不会自动重复投递。'
    })
  }
  execution(t: Task): HostToolExecution { return { name: 'writer_context', arguments: {}, agent: {session:{id:t.sessionId,header:{cwd:t.cwd}}} } }
  private async reviewMarker(t: Task): Promise<string | undefined> {
    if (t.mode === 'toutiao' && t.target.root && t.target.article) {
      const m = await new ArticleStore(t.target.root).get(t.target.article)
      return sha256(JSON.stringify(m.qa.at(-1) ?? null))
    }
    if (t.mode === 'fanqie' && t.target.work && t.target.dir && t.target.chapter) {
      const w = await openWork(worksRoot(this.config.fanqie.zhizhang ?? {},this.execution(t),t.target.base),t.target.work)
      if (!w.chapters.some(c=>c.id===t.target.chapter)) return sha256(JSON.stringify({report:null,authorReview:null}))
      const chapter = await readChapter(w,t.target.chapter)
      const report = await latestReview(this.config.fanqie,undefined,w.key,chapter.id,w.dir)
      return sha256(JSON.stringify({report:report ?? null,authorReview:chapter.review ?? null}))
    }
    return undefined
  }
  async beginReview(t: Task, review: ReviewMode) {
    t.review = review
    t.reviewBaseline = await this.reviewMarker(t)
    t.reviewPending = true
  }
  async refresh(t: Task) {
    let pendingCandidate = false
    let reviewDone = false
    const held = ['failed','needs_input'].includes(t.status) ? {status:t.status,next:t.next} : undefined
    if (t.status === 'cancelled') return
    if(t.mode==='fanqie' && !t.target.work && t.creationKey){
      const found=(await listWorks(worksRoot(this.config.fanqie.zhizhang??{},this.execution(t),t.target.base))).find(w=>w.key===t.creationKey)
      if(found)t.target={...t.target,work:found.key,dir:found.dir}
    }
    if (t.mode === 'toutiao' && t.target.article && t.target.root) {
      const store = new ArticleStore(t.target.root)
      let m
      try { m = await store.get(t.target.article) } catch(e) {
        if (!(e instanceof WriterError) || e.code !== 'NOT_FOUND' || !t.autoArticle) throw e
        m = await store.create(t.target.article.slice(11), {date:t.target.article.slice(0,10),titleHint:t.goal.slice(0,100),line:t.articleLine??'资讯线',genre:t.articleGenre??'长图文'})
      }
      t.autoArticle=false
      const draft = store.currentDraft(m)
      if (m.current_rev > 0 && !draft) throw new WriterError('CONFLICT', '文章记录缺少当前稿件版本，请检查文章目录。')
      const actual = draft ? sha256(await store.readDraft(m.id, m.current_rev)) : undefined
      t.revision = actual
      t.artifact = draft ? store.draftPath(m.id,m.current_rev) : undefined
      if (draft && actual !== draft.sha256) {
        t.status='needs_input';t.step='review';t.next='当前稿件被外部修改，请将内容保存为新版本并重新质检。';return
      }
      const qa = await validPassingQa(store,m)
      const lastQa = m.qa.at(-1)
      reviewDone = !!(lastQa && draft && lastQa.rev === m.current_rev && lastQa.sha256 === actual && lastQa.card_sha256 === await store.cardSha(m.id) && (t.review !== 'editor' || lastQa.by === 'editor'))
      if (m.status === '已交稿') {t.step='deliver';t.status='completed';t.next='已由作者采用，可导出；新需求另建任务。'}
      else if (m.delivered && qa.ok && m.status === '已验收') {t.step='deliver';t.status='ready_for_acceptance';t.next='展示终稿、标题、出处和交稿单，等待作者在头条写作台采用。'}
      else if (qa.ok) {t.step='deliver';t.status='running';t.next='按原状态流程送验收并生成交稿单、记台账；不替作者发布。'}
      else if (draft) {t.step=t.intent==='revise' && !t.note?'revise':'review';t.status='reviewing';t.next=t.review==='manual'?'展示当前稿与待核实项，等待作者审阅；原 QA 门禁仍须通过。':'加载 s5-editing / s6-qa，完成编辑并运行 toutiao_qa_check；只修明确问题。'}
      else {t.step='prepare';t.next='补齐立项卡与可核实来源，保存主标题和备选标题，然后写一份初稿。'}
    } else if (t.mode === 'fanqie' && t.target.work && t.target.dir) {
      const w = await openWork(worksRoot(this.config.fanqie.zhizhang ?? {}, this.execution(t),t.target.base),t.target.work)
      if (w.dir !== t.target.dir) throw new WriterError('CONFLICT','作品路径已改变，请核对存储配置')
      if (!t.target.chapter) {t.next='选择或创建目标章节，并用 writer_checkpoint chapter 绑定。';return}
      if (!w.chapters.some(c=>c.id===t.target.chapter)) {t.step='prepare';t.next='先用章纲工具创建已绑定的章节，不另建任务；完成后重新 writer_status。';return}
      const ch = await readChapter(w,t.target.chapter)
      t.revision = ch.bodySha256
      t.artifact = ch.body.trim() ? `chapter:${w.key}/${ch.id}` : undefined
      const review = await latestReview(this.config.fanqie,undefined,w.key,ch.id,w.dir)
      const catalog = await listCandidates(w.dir)
      if (catalog.some((c: any) => c.unavailable)) throw new WriterError('CONFLICT', '候选稿目录存在无法读取的记录，请先检查后再继续。')
      const candidates = catalog.filter((c: any)=>c.chapterId===ch.id && !c.acceptedAt)
      pendingCandidate = candidates.length > 0
      const authorReview = ch.review?.revision === ch.revision && ch.review.result === 'pass' && ch.status === 'reviewed'
      reviewDone = !!(review?.body_sha256===ch.bodySha256 && review.reread_full && (t.review!=='editor' || review.by==='editor') || t.review==='manual' && authorReview)
      if (ch.status==='final' && !(t.intent==='revise' && pendingCandidate)) {t.step='deliver';t.status='completed';t.next='本章已定稿。展示待确认连续性变化；续章请另建 continue 任务，绑定下一章。'}
      else if (candidates.length) {t.step='deliver';t.status='ready_for_acceptance';t.next='已有未采纳候选，先展示候选与原稿差异并等待作者采纳；不要重复生成。'}
      else if (!ch.body.trim()) {t.step='write';t.status='running';t.next='先章纲检查与 zhizhang_chapter_brief，再写一个主候选，经原流程审阅采纳。'}
      else if (t.review==='manual' && authorReview && !this.config.fanqie.requireEditorPass) {t.step='deliver';t.status='ready_for_acceptance';t.next='作者已声明审读当前版本；定稿时仍会核对正文和章节依赖。'}
      else if (review?.body_sha256 === ch.bodySha256 && review.verdict==='通过' && review.reread_full && Array.isArray(review.hard_issues) && !review.hard_issues.length && (!this.config.fanqie.requireEditorPass || review.by === 'editor')) {t.step='deliver';t.status='ready_for_acceptance';t.next='审读回报对应当前正文；展示结果，按织章原审读流程与作者确认完成定稿。'}
      else if (this.config.fanqie.requireEditorPass && review?.body_sha256 === ch.bodySha256 && review.by !== 'editor') {t.step='review';t.status='reviewing';t.next='严格模式需要独立编辑审读当前正文；写手自检不能代替编辑回报。'}
      else {t.step=t.intent==='revise' && !t.note || review?.body_sha256===ch.bodySha256 && review.verdict!=='通过'?'revise':'review';t.status='reviewing';t.next=t.review==='manual'?'请作者阅读当前正文并通过原面板审读、定稿；不会自动声明已审阅。':t.step==='revise'?'按当前有效回报的硬伤定点生成修订候选；旧回报只作参考，改后重审。':'按四类硬伤审读当前版本，提交 fanqie_review_report；表达建议不触发无限改稿。'}
    } else {t.step='prepare';t.next=t.mode==='toutiao'?'已有素材则直接立项，不强制找热点；创建文章后立即 checkpoint article 绑定。':'新书先加载规划方法，创建作品后 checkpoint work；已有作品则先选书选章。'}
    if (t.intent==='revise' && t.revision && (!t.baseRevision || t.revision===t.baseRevision) && !t.attempts && !pendingCandidate) {t.status='running';t.step='revise';t.next='按作者目标定点修订当前稿，保存修订版后 checkpoint revised=true，再复查。'}
    if (t.reviewPending) {
      const marker = await this.reviewMarker(t)
      if (marker && t.reviewBaseline && marker !== t.reviewBaseline && reviewDone) t.reviewPending = false
      else if (marker) {if(!t.reviewBaseline)t.reviewBaseline=marker;t.step='review';t.status='reviewing';t.next=t.review==='manual'?'等待作者审阅当前版本；必要的业务质检仍须完成。':'对当前版本执行本次审读并保存回报。'}
    }
    if (t.intent==='review' && reviewDone && !t.reviewPending) {t.status='completed';t.next='当前版本审读已完成；采纳、交稿或定稿仍由作者决定。'}
    if (held && t.status!=='completed') {t.status=held.status;t.next=held.next}
    const initialUserRevision = t.intent==='revise' && t.attempts===0 && (!t.baseRevision || t.revision===t.baseRevision)
    if (t.attempts>=t.maxRounds && t.step==='revise' && !initialUserRevision) {t.status='needs_input';t.next='已达到自动返修上限。展示未解决问题，请作者决定是否继续。'}
  }
  route(t: Task) {
    return t.mode==='toutiao'
      ? ['toutiao_feedback_read / toutiao_ledger_show；仅找题需 toutiao_hot_fetch', 'toutiao_card_set → toutiao_headline_set', 'toutiao_draft_stage', 'toutiao_edit_record → toutiao_draft_stage → toutiao_qa_check', 'toutiao_status → toutiao_delivery_save → toutiao_ledger_add；作者采用']
      : ['选书选章 → writer_run 写作包', 'fanqie_outline_check → zhizhang_chapter_brief', 'zhizhang_candidate_stage → 作者确认采纳', 'fanqie_review_report → fanqie_ledger_check', '按硬伤编辑候选 → 对比采纳 → 重审', '原审读/作者确认定稿 → 待确认连续性变化 → 新续章任务']
  }
  async context(t: Task) {
    if (t.mode==='toutiao') {
      const store = new ArticleStore(t.target.root!)
      const feedback = (await readText(store.feedbackPath))?.slice(-10000) ?? ''
      if (!t.target.article) return {feedback,recent:(await store.list()).slice(0,12).map(m=>({id:m.id,title:m.title_hint,status:m.status}))}
      const m=await store.get(t.target.article)
      const current=m.current_rev?await store.readDraft(m.id,m.current_rev):''
      const previous=m.current_rev>1?await store.readDraft(m.id,m.current_rev-1):''
      return {feedback,article:m,card:await store.readCard(m.id),body:current,previousBody:previous}
    }
    if (!t.target.work) return {works:await listWorks(worksRoot(this.config.fanqie.zhizhang??{},this.execution(t),t.target.base)),creationKey:t.creationKey,instruction:t.creationKey?'新书用 zhizhang_project_create，key 必须为 '+t.creationKey+'，strict_key 必须为 true；创建后 checkpoint 绑定作品。':'选择现有作品，用 checkpoint 绑定。'}
    const w=await openWork(worksRoot(this.config.fanqie.zhizhang??{},this.execution(t),t.target.base),t.target.work), meta=await readWorkMeta(w.dir) as WorkMeta
    const chapter=t.target.chapter?w.chapters.find(c=>c.id===t.target.chapter):undefined
    const previous=chapter?w.chapters.filter(c=>c.position<chapter.position).slice(-2):[]
    const relevant = new Set(previous.map(c => c.id))
    if (chapter) relevant.add(chapter.id)
    const planning = meta.planning ? {
      book: meta.planning.book,
      volumes: meta.planning.volumes.filter(v => v.chapters.some(id => relevant.has(id))),
      acts: meta.planning.acts?.filter(v => v.chapters.some(id => relevant.has(id))),
    } : undefined
    const continuity = meta.continuity ? {
      finalized: meta.continuity.finalized.filter(v => relevant.has(v.chapterId)),
      working: meta.continuity.working.filter(v => relevant.has(v.chapterId)),
    } : undefined
    return {work:{key:w.key,title:w.title},foundation:meta.foundation,planning,continuity,
      chapter:chapter?await readChapter(w,chapter.id):null,
      previous:await Promise.all(previous.map(async(c,i)=>{const row=await readChapter(w,c.id);return {id:row.id,title:row.title,revision:row.bodySha256,body:i===previous.length-1?row.body:row.body.slice(-2500)}})),
      review:chapter?await latestReview(this.config.fanqie,undefined,w.key,chapter.id,w.dir):null,
      candidates:chapter?await Promise.all((await listCandidates(w.dir)).filter((c:any)=>c.chapterId===chapter.id&&!c.acceptedAt).map((c:any)=>readCandidate(w.dir,c.id))):[],
      instruction:'人物认知/地点/伏笔以已采纳正文为准；计划不等于已发生。根基过长时按本章相关人物选择，不编造缺失状态。章纲缺项先给补全建议。'}
  }
  async run(exec: HostToolExecution, mode: Mode, a: Record<string,unknown>) {
    return serialize(this.folder(sessionCwd(exec))+':'+sessionIdOf(exec),async()=>{const t=await this.runTask(exec,mode,a);this.activate(t);return t})
  }
  private async runTask(exec: HostToolExecution, mode: Mode, a: Record<string,unknown>) {
    const goal=str(a.goal); if(!goal) throw new WriterError('INVALID_ARGS','请提供写作目标')
    const intent=(str(a.intent)||'create') as Intent, review=(str(a.review)||this.config.workflow?.review||'quick') as ReviewMode
    if(!intents.includes(intent)||!reviews.includes(review)) throw new WriterError('INVALID_ARGS','任务类型或审读模式不合法')
    const cwd=path.resolve(sessionCwd(exec)), at=new Date().toISOString()
    const base = str(a.working_dir) ? path.resolve(cwd,str(a.working_dir)) : undefined
    const existing=(await this.list(cwd)).find(t=>t.mode===mode && t.intent===intent && t.goal===goal && t.sessionId===sessionIdOf(exec) && !['cancelled','completed'].includes(t.status) && (!base||t.target.base===base) && (!str(a.article)||t.target.article===str(a.article)) && (!str(a.work)||t.target.work===str(a.work)) && (!str(a.chapter)||t.target.chapter===str(a.chapter)))
    if(existing) {
      const refreshed=await this.mutate(cwd,existing.id,async t=>{await this.refresh(t)})
      if(refreshed.status!=='completed')return refreshed
    }
    const t:Task={schema:1,id:randomUUID(),mode,intent,goal,cwd,sessionId:sessionIdOf(exec),target:{},review,status:'running',step:'prepare',next:'',attempts:0,maxRounds:this.config.workflow?.maxAutoRevisionRounds??2,createdAt:at,updatedAt:at}
    if(mode==='toutiao') {
      t.target.root=storeFor(this.config.toutiao,exec).root;t.target.article=str(a.article)||undefined
      if(t.target.article) await new ArticleStore(t.target.root).get(t.target.article)
      else if(intent==='create') {
        t.autoArticle=true;t.articleLine=str(a.line)||'资讯线';t.articleGenre=str(a.format)||'长图文'
        if (!['资讯线','故事线'].includes(t.articleLine) || !['长图文','短图文','微头条'].includes(t.articleGenre)) throw new WriterError('INVALID_ARGS','头条内容线或体裁不合法')
        t.target.article=`${today()}-writer-${t.id.slice(0,8)}`;await this.save(t)
      }
    }
    else if(str(a.work)) {
      const w=await openWork(worksRoot(this.config.fanqie.zhizhang??{},exec,base),str(a.work)); t.target={work:w.key,dir:w.dir,base:w.base}
      let ch=str(a.chapter)
      if(!ch && intent==='continue') {const pending=w.chapters.find(c=>c.status!=='final');ch=pending?.id ?? `c${String((w.chapters.at(-1)?.position??0)+1).padStart(3,'0')}`}
      if(ch) t.target.chapter=w.chapters.find(c=>c.id===ch||String(c.position)===ch||c.title===ch)?.id??ch
    }
    if(mode==='fanqie' && !t.target.work && base)t.target.base=base
    if(mode==='fanqie' && intent==='create' && !t.target.work){t.creationKey='book-'+t.id.slice(0,8);await this.save(t)}
    if (intent==='review') await this.beginReview(t,review)
    await this.refresh(t);t.baseRevision=t.revision;await this.save(t);return t
  }
  async checkpoint(exec: HostToolExecution, a: Record<string,unknown>) {
    const current=await this.current(exec,str(a.task_id)||undefined)
    return this.mutate(current.cwd,current.id,async t=>{
      if(t.sessionId!==sessionIdOf(exec)) throw new WriterError('CONFLICT','先 writer_resume 接管此任务')
      if(t.status==='cancelled' || t.status==='completed' && !str(a.continuity)) throw new WriterError('CONFLICT','已结束任务不能推进；新工作请新建任务')
      if(str(a.article)) {if(t.mode!=='toutiao'||t.target.article&&t.target.article!==str(a.article)) throw new WriterError('CONFLICT','任务不能切换文章');await new ArticleStore(t.target.root!).get(str(a.article));t.target.article=str(a.article)}
      if(str(a.work)) {if(t.mode!=='fanqie') throw new WriterError('CONFLICT','模式不匹配');const w=await openWork(worksRoot(this.config.fanqie.zhizhang??{},exec,t.target.base),str(a.work));if(t.target.work&&(t.target.work!==w.key||t.target.dir!==w.dir)) throw new WriterError('CONFLICT','任务不能换作品');t.target.work=w.key;t.target.dir=w.dir;t.target.base=w.base}
      if(str(a.chapter)) {if(t.mode!=='fanqie'||!t.target.work||t.target.chapter&&t.target.chapter!==str(a.chapter)) throw new WriterError('CONFLICT','先绑定作品，且不能更换章节');t.target.chapter=str(a.chapter)}
      if(t.reviewPending && !t.reviewBaseline) t.reviewBaseline=await this.reviewMarker(t)
      if(a.revised===true && str(a.note) && t.note!==str(a.note)) t.attempts++
      if(str(a.note)) t.note=str(a.note)
      await this.refresh(t)
      if(str(a.continuity)) t.continuity={revision:t.revision??'',text:str(a.continuity).slice(0,16000),accepted:false}
      if(str(a.status)) {
        if(!['needs_input','failed','cancelled'].includes(str(a.status))) throw new WriterError('INVALID_ARGS','状态仅可显式设为 needs_input/failed/cancelled；完成状态由真实产物判断')
        t.status=a.status as Task['status'];t.error=t.status==='failed'?str(a.note):undefined;t.next=str(a.note)||t.next
      }
    })
  }
  async guard(exec: HostToolExecution) {
    if (!this.sessions.has(sessionIdOf(exec)) || !/^(toutiao_|zhizhang_|fanqie_)/.test(exec.name) || /_(enable|list|get|read|show|check|brief|lint|map|scan)$/.test(exec.name)) return undefined
    let t: Task
    try { t = await this.current(exec) } catch(e) {
      if(e instanceof WriterError && e.code==='NOT_FOUND') {
        if (this.sessions.get(sessionIdOf(exec))?.taskId) return {kind:'deny' as const,reason:'绑定任务不存在，请先重新选择任务。',info:{name:'WriterTask',code:'TARGET_CONFLICT'}}
        return undefined
      }
      throw e
    }
    if (t.sessionId!==sessionIdOf(exec)) return {kind:'deny' as const,reason:'此任务已转到其他会话，请先确认后再继续。',info:{name:'WriterTask',code:'TARGET_CONFLICT'}}
    if(t.creationKey && !t.target.work) t=await this.mutate(t.cwd,t.id,async current=>{await this.refresh(current)})
    const a=exec.arguments as Record<string,unknown>
    const deny=(reason:string)=>({kind:'deny' as const,reason,info:{name:'WriterTask',code:'TARGET_CONFLICT'}})
    if(exec.name==='zhizhang_project_create' && t.creationKey && str(a.key)!==t.creationKey)return deny('新书必须使用任务预留 key：'+t.creationKey)
    if(exec.name==='zhizhang_project_create' && t.creationKey && a.strict_key!==true)return deny('新书必须设置 strict_key=true，以便安全恢复预留作品。')
    if(t.status==='cancelled')return deny('任务已取消')
    if(t.mode==='toutiao' && t.target.article && a.id && a.id!==t.target.article) return deny('当前任务绑定文章 '+t.target.article+'；请另建任务处理其他文章')
    if(t.mode==='toutiao' && t.target.article && exec.name==='toutiao_article_create') return deny('任务已绑定文章，不要重复创建；继续处理 '+t.target.article)
    if(t.mode==='fanqie' && t.target.work) {
      if(exec.name==='zhizhang_project_create')return deny('任务已绑定作品，不要重复开书')
      const w=await openWork(worksRoot(this.config.fanqie.zhizhang??{},exec,str(a.working_dir)||undefined),str(a.work)||undefined)
      if(w.key!==t.target.work||w.dir!==t.target.dir) return deny('操作目标与任务绑定作品不一致')
      if(t.target.chapter) {
        const ids=[a.candidate,a.parent,...(Array.isArray(a.candidate_ids)?a.candidate_ids:[])].filter((id): id is string=>typeof id==='string'&&!!id)
        for(const id of ids){const candidate=await readCandidate(w.dir,id);if(candidate.chapterId!==t.target.chapter)return deny('候选所属章节与任务目标不一致')}
      }
      if(t.target.chapter && a.chapter) {
        const id=w.chapters.find(c=>c.id===a.chapter||c.title===a.chapter||String(c.position)===a.chapter)?.id??a.chapter
        if(id!==t.target.chapter) return deny('操作章节与任务绑定章节不一致')
      }
    }
    return undefined
  }
  tools(mode: Mode) {
    const taskId = { task_id: S('任务 id；省略取当前会话未完成任务') }
    return [
      defineWriterTool<Record<string, unknown>>({
        name: 'writer_run',
        description: '开始写作任务，返回绑定目标、实际进度、上下文和执行路线；继续由 DSH Agent 执行业务工具。',
        properties: {
          goal: S('目标与素材'), intent: E(intents, 'create/continue/revise/review/export'),
          article: S('已有文章 id'), work: S('作品 key'), chapter: S('章节 id/序号'),
          working_dir: S('小说存储根；缺省使用配置'), line: E(['资讯线','故事线'], '头条内容线'),
          format: E(['长图文','短图文','微头条'], '头条体裁'), review: E(reviews, '审读方式'),
        },
        required: ['goal'],
        run: async (args, exec) => {
          const task = await this.run(exec, mode, args)
          return { task, context: await this.context(task), route: this.route(task), workbench: '/writer' }
        },
      }),
      defineWriterTool<Record<string, unknown>>({
        name: 'writer_status',
        description: '读取任务并从实际稿件与回报校准进度；list=true 列出当前工作区的任务。',
        properties: { ...taskId, list: { type: 'boolean' } },
        run: async (args, exec) => {
          if (args.list) return { tasks: (await this.list(sessionCwd(exec))).filter(task => task.mode === mode) }
          const current = await this.current(exec, str(args.task_id) || undefined)
          const task = await this.mutate(current.cwd, current.id, async task => { await this.refresh(task) })
          return { task }
        },
      }),
      defineWriterTool<Record<string, unknown>>({
        name: 'writer_resume',
        description: '在当前主会话恢复任务，依据已存产物继续；原会话不能继续写入被接管的任务。',
        properties: taskId,
        run: async (args, exec) => {
          const current = await this.current(exec, str(args.task_id) || undefined)
          const task = await this.mutate(current.cwd, current.id, async task => {
            if (task.status === 'cancelled') throw new WriterError('CONFLICT', '任务已取消')
            task.sessionId = sessionIdOf(exec)
            task.status = 'running'
            delete task.error
            await this.refresh(task)
          })
          this.activate(task)
          return { task, context: await this.context(task), route: this.route(task) }
        },
      }),
      defineWriterTool<Record<string, unknown>>({
        name: 'writer_checkpoint',
        description: '保存阶段信息、绑定新建对象、记录连续性候选或阻塞；完成状态依据真实产物判断。',
        properties: {
          ...taskId, article: S('文章 id'), work: S('作品 key'), chapter: S('章节 id'),
          note: S('完成内容/问题/修改说明'), status: E(['needs_input','failed','cancelled'], '需人工介入时传'),
          revised: { type: 'boolean', description: '本轮已返修，note 写唯一轮次说明' },
          continuity: S('新事实、人物状态、伏笔变化的待确认摘要'),
        },
        run: async (args, exec) => ({ task: await this.checkpoint(exec, args) }),
      }),
      defineWriterTool<Record<string, unknown>>({
        name: 'writer_review',
        description: '选择审读路线并返回当前版本；由 DSH Agent 实际审读并保存回报，不自动声明通过。',
        properties: { ...taskId, review: E(reviews, 'quick/editor/manual') },
        run: async (args, exec) => {
          const current = await this.current(exec, str(args.task_id) || undefined)
          const task = await this.mutate(current.cwd, current.id, async task => {
            if (task.sessionId !== sessionIdOf(exec)) throw new WriterError('CONFLICT', '先 writer_resume 接管此任务')
            const review = (str(args.review) || task.review) as ReviewMode
            if (!reviews.includes(review)) throw new WriterError('INVALID_ARGS', '审读模式无效')
            await this.beginReview(task, review)
            task.status = 'running'
            await this.refresh(task)
          })
          const instruction = task.review === 'editor'
            ? '派 DSH 编辑子代理，明确作品/文章、章节、正文版本；失败时请作者选择其他审阅方式。'
            : task.review === 'manual'
              ? '展示当前稿与差异，请作者审阅。'
              : '当前 Agent 快速自检，保存对应业务回报；须符合原 QA/定稿规则。'
          return { task, context: await this.context(task), instruction }
        },
      }),
      defineWriterTool<Record<string, unknown>>({
        name: 'writer_export',
        description: '导出当前稿为 Markdown 或 TXT；不发布到外部平台。',
        properties: { ...taskId, format: E(['md','txt'], '导出格式') },
        run: async (args, exec) => {
          const task = await this.current(exec, str(args.task_id) || undefined)
          return this.export(task, str(args.format) || 'md')
        },
      }),
    ]
  }
  async export(t:Task,format:string) {
    if(!['md','txt'].includes(format))throw new WriterError('INVALID_ARGS','格式只支持 md/txt')
    await this.refresh(t)
    const context=await this.context(t) as any
    const body=t.mode==='toutiao'?context.body:context.chapter?.body
    if(!body)throw new WriterError('NOT_FOUND','当前任务还没有可导出的已存正文；候选请先在工作台审阅')
    const title=t.mode==='toutiao'?context.article.headlines.main||context.article.title_hint:context.chapter.title
    const hasTitle = /^\s*#\s+/.test(body)
    const text=format==='md' ? `${hasTitle ? body : `# ${title}\n\n${body}`}\n`
      : `${hasTitle ? body.replace(/^(\s*)#\s+/, '$1') : `${title}\n\n${body}`}\n`
    const file=path.join(t.cwd,'.writer','exports',`${t.id}-${sha256(body).slice(0,12)}.${format}`)
    await atomicWrite(file,text)
    const final = t.mode==='toutiao'
      ? context.article.status==='已交稿' && context.article.drafts.find((d: {rev:number})=>d.rev===context.article.current_rev)?.sha256===sha256(body)
      : context.chapter?.status==='final'
    return {file,content:text,status:t.status,revision:t.revision,final}
  }
}
export { stages }
