/** 头条工具集（dev-plan T1.4–T1.8）。全部返回结构化 JSON；业务失败返回 ok:false。 */
import { appendFile, mkdir } from 'node:fs/promises'
import {
  defineWriterTool, WriterError, type HostContext, type HostToolDefinition, type HostToolExecution, type JsonSchemaNode,
} from '../../dsh-adapter/src/index.js'
import { atomicWrite, readJson, readText, sha256 } from '../../core/src/fsx.js'
import type { GateEngine } from '../../gates/src/index.js'
import { checkCard } from './card.js'
import { bridge, storeFor, type ToutiaoConfig } from './env.js'
import { getMethod, METHOD_FILES } from './methods.js'
import {
  canTransition, MAX_RETURN_ROUNDS, nowIso, STATUSES, STOP_LINE, today, type ArticleMeta, type Status,
} from './store.js'

export const TITLE_MAX = 34

const S = (description: string): JsonSchemaNode => ({ type: 'string', description })
const I = (description: string): JsonSchemaNode => ({ type: 'integer', description })
const B = (description: string): JsonSchemaNode => ({ type: 'boolean', description })
const E = (values: readonly string[], description: string): JsonSchemaNode => ({ type: 'string', enum: [...values], description })
const ID = S('文章 id（YYYY-MM-DD-slug，toutiao_article_create 返回）')

function reqStr(args: Record<string, unknown>, key: string): string {
  const v = args[key]
  if (typeof v !== 'string' || !v.trim()) throw new WriterError('INVALID_ARGS', `参数 ${key} 必填`)
  return v.trim()
}
function optStr(args: Record<string, unknown>, key: string): string | undefined {
  const v = args[key]
  if (v === undefined || v === null) return undefined
  if (typeof v !== 'string') throw new WriterError('INVALID_ARGS', `参数 ${key} 必须是字符串`)
  return v.trim()
}

export interface ToolDeps {
  config: ToutiaoConfig
  host?: HostContext
  /** 门禁引擎（工具内复核作者确认用） */
  gates: () => GateEngine | undefined
  /** 本会话角色：writer 主写手（默认）/ editor 编辑子代理 */
  role?: Role
}

export type Role = 'writer' | 'editor'

/** 编辑角色可见的工具：只能读稿、改稿（记为 editor 版）、记红笔、跑质检；不能改状态、出交稿单、记台账 */
export const EDITOR_TOOLS = new Set([
  'toutiao_method_get', 'toutiao_rules', 'toutiao_article_list', 'toutiao_article_get', 'toutiao_draft_get',
  'toutiao_draft_stage', 'toutiao_edit_record', 'toutiao_qa_check', 'toutiao_feedback_read',
])

function summary(m: ArticleMeta) {
  const cur = m.drafts.find(d => d.rev === m.current_rev)
  const lastQa = m.qa[m.qa.length - 1]
  return {
    id: m.id, status: m.status, line: m.line, genre: m.genre, current_rev: m.current_rev,
    chars: cur?.chars ?? 0, headline: m.headlines.main || m.title_hint, return_rounds: m.return_rounds,
    last_qa: lastQa ? { rev: lastQa.rev, score: lastQa.score, pass: lastQa.pass } : null,
    delivered: m.delivered, updated_at: m.updated_at,
  }
}

/** 当前版本是否有仍然有效（稿件与立项卡都未改）的过线质检 */
export async function validPassingQa(store: ReturnType<typeof storeFor>, m: ArticleMeta) {
  const q = store.latestQaFor(m)
  if (!q) return { ok: false as const, reason: '当前版本还没跑质检（toutiao_qa_check）' }
  const cardSha = await store.cardSha(m.id)
  if (q.card_sha256 !== cardSha) return { ok: false as const, reason: '立项卡在质检后改过，请重跑 toutiao_qa_check' }
  if (!q.pass) return { ok: false as const, reason: `当前版本质检未过线（${q.score} 分${q.hard_gates.length ? '，硬闸：' + q.hard_gates.join('、') : ''}）` }
  return { ok: true as const, qa: q }
}

export function createToutiaoTools(deps: ToolDeps): HostToolDefinition[] {
  const { config } = deps
  const st = (exec: HostToolExecution) => storeFor(config, exec, deps.host)

  return [
    defineWriterTool<{ id: string }>({
      name: 'toutiao_method_get',
      description: '按步骤取头条写作方法或语料（Skill 第二、三级）。开每一步前先取对应方法。',
      properties: { id: E(Object.keys(METHOD_FILES), '方法或语料 id') },
      required: ['id'],
      async run(args) {
        return await getMethod(reqStr(args, 'id'))
      },
    }),

    defineWriterTool({
      name: 'toutiao_rules',
      description: '打印现行质检规则（规则唯一来源 rules.py 生成）。只在需要解释分数或规则时调用。',
      properties: {},
      async run(_a, exec) {
        const r = await bridge(config, ['rules'], { signal: exec.signal })
        return { rules_version: r.rules_version, markdown: r.markdown }
      },
    }),

    defineWriterTool<{ top?: number; vertical?: string; relevant?: boolean }>({
      name: 'toutiao_hot_fetch',
      description: 'S1 抓热榜。失败时返回 ok:false，请改用网页搜索，再不行请作者粘贴热榜。',
      properties: { top: I('条数，默认 30'), vertical: S('垂类，默认 综合'), relevant: B('只保留命中 12 垂类的条目') },
      async run(args, exec) {
        const a = ['hot', '--top', String(Math.max(1, Math.min(100, Number(args.top ?? 30) || 30))), '--vertical', String(args.vertical ?? '综合')]
        if (args.relevant) a.push('--relevant')
        const r = await bridge(config, a, { timeoutMs: 120_000, signal: exec.signal })
        return { items: r.items }
      },
    }),

    defineWriterTool<Record<string, unknown>>({
      name: 'toutiao_article_create',
      description: 'S2 立项：新建一篇文章（状态 初稿待改），返回 id。之后用 toutiao_card_set 写立项卡。',
      properties: {
        slug: S('简短标识，字母数字中文 - _，如 rent-gjj 或 精卫'),
        date: S('YYYY-MM-DD，默认今天'),
        title_hint: S('题目方向一句话'),
        line: E(['资讯线', '故事线'], '内容线'),
        genre: E(['长图文', '短图文', '微头条'], '体裁'),
      },
      required: ['slug'],
      async run(args, exec) {
        const m = await st(exec).create(reqStr(args, 'slug'), {
          date: optStr(args, 'date'), titleHint: optStr(args, 'title_hint'), line: optStr(args, 'line'), genre: optStr(args, 'genre'),
        })
        return { article: summary(m), root: st(exec).root }
      },
    }),

    defineWriterTool<{ status?: string }>({
      name: 'toutiao_article_list',
      description: '列出本工作区的头条文章（可按状态筛）。',
      properties: { status: E(STATUSES, '只看某个状态') },
      async run(args, exec) {
        const all = await st(exec).list()
        const rows = all.filter(m => !args.status || m.status === args.status).map(summary)
        return { root: st(exec).root, count: rows.length, articles: rows }
      },
    }),

    defineWriterTool<{ id: string; include_draft?: boolean }>({
      name: 'toutiao_article_get',
      description: '读一篇文章：状态、立项卡、标题、质检记录；include_draft=true 时附当前稿件全文。',
      properties: { id: ID, include_draft: B('是否附当前稿件全文') },
      required: ['id'],
      async run(args, exec) {
        const store = st(exec)
        const m = await store.get(reqStr(args, 'id'))
        const card = await store.readCard(m.id)
        const out: Record<string, unknown> = {
          article: summary(m), headlines: m.headlines, qa: m.qa.slice(-3), history: m.history.slice(-8), card: card ?? null,
        }
        if (args.include_draft && m.current_rev > 0) out.draft = await store.readDraft(m.id, m.current_rev)
        return out
      },
    }),

    defineWriterTool<{ id: string; card: Record<string, unknown> }>({
      name: 'toutiao_card_set',
      description: 'S2 写入完整立项卡（字段同模板 template-card）。会做结构预检并返回问题清单；有 fail 也会保存，改好再写。',
      properties: { id: ID, card: { type: 'object', description: '完整立项卡 JSON 对象' } },
      required: ['id', 'card'],
      async run(args, exec) {
        const id = reqStr(args, 'id')
        const card = args.card
        if (!card || typeof card !== 'object' || Array.isArray(card)) throw new WriterError('INVALID_ARGS', 'card 必须是对象')
        return await saveCard(st(exec), id, card)
      },
    }),

    defineWriterTool<{ id: string; patch: Record<string, unknown> }>({
      name: 'toutiao_card_patch',
      description: '按顶层字段修改立项卡（浅合并；值为 null 删除该字段）。',
      properties: { id: ID, patch: { type: 'object', description: '要改的顶层字段' } },
      required: ['id', 'patch'],
      async run(args, exec) {
        const id = reqStr(args, 'id')
        const store = st(exec)
        const cur = (await store.readCard(id)) ?? {}
        if (!args.patch || typeof args.patch !== 'object' || Array.isArray(args.patch)) throw new WriterError('INVALID_ARGS', 'patch 必须是对象')
        const next: Record<string, unknown> = { ...cur }
        for (const [k, v] of Object.entries(args.patch)) {
          if (v === null) delete next[k]
          else next[k] = v
        }
        return await saveCard(store, id, next)
      },
    }),

    defineWriterTool<{ id: string; main: string; alts?: string[] }>({
      name: 'toutiao_headline_set',
      description: `S3 定标题：1 主 4 备，每条不超过 ${TITLE_MAX} 字；同时回填立项卡 主标题 / 备选标题。`,
      properties: { id: ID, main: S('主推标题'), alts: { type: 'array', items: { type: 'string' }, description: '备选标题（4 条）' } },
      required: ['id', 'main'],
      async run(args, exec) {
        const id = reqStr(args, 'id')
        const main = reqStr(args, 'main')
        const alts = (Array.isArray(args.alts) ? args.alts : []).map(x => String(x).trim()).filter(Boolean)
        const over = [main, ...alts].filter(t => [...t].length > TITLE_MAX)
        if (over.length) throw new WriterError('INVALID_ARGS', `超过 ${TITLE_MAX} 字硬上限：${over.map(t => `${t}（${[...t].length}字）`).join('；')}`)
        const store = st(exec)
        await store.update(id, (m) => { m.headlines = { main, alts } })
        const card = (await store.readCard(id)) ?? {}
        const saved = await saveCard(store, id, { ...card, 主标题: main, 备选标题: alts })
        return { headlines: { main, alts }, lengths: [main, ...alts].map(t => [...t].length), card_issues: saved.issues, warnings: alts.length !== 4 ? ['标题矩阵应为 1 主 4 备'] : [] }
      },
    }),

    defineWriterTool<{ id: string; text: string; role?: string; note?: string }>({
      name: 'toutiao_draft_stage',
      description: 'S4/S5 存一版稿件（只增不改，旧版保留）。新稿使状态回到 初稿待改，旧质检作废。text 为完整 Markdown，以 # 主标题 开头。',
      properties: deps.role === 'editor'
        ? { id: ID, text: S('完整稿件 Markdown'), note: S('这一版改了什么') }
        : { id: ID, text: S('完整稿件 Markdown'), role: E(['writer', 'author'], 'writer=你写的；author=作者亲手改的版本'), note: S('这一版改了什么') },
      required: ['id', 'text'],
      async run(args, exec) {
        const text = typeof args.text === 'string' ? args.text : ''
        if (!text.trim()) throw new WriterError('INVALID_ARGS', 'text 不能为空')
        // 角色由挂载决定，不信任参数：主写手不能把自己的稿子记成编辑版
        const role = deps.role === 'editor' ? 'editor' : (args.role === 'author' ? 'author' : 'writer')
        const m = await st(exec).stageDraft(reqStr(args, 'id'), text.replace(/\r\n/g, '\n'), role, optStr(args, 'note') ?? '')
        return { article: summary(m), rev: m.current_rev }
      },
    }),

    defineWriterTool<{ id: string; rev?: number }>({
      name: 'toutiao_draft_get',
      description: '读某一版稿件全文（默认当前版）。',
      properties: { id: ID, rev: I('版本号，默认当前版') },
      required: ['id'],
      async run(args, exec) {
        const store = st(exec)
        const m = await store.get(reqStr(args, 'id'))
        const rev = Number(args.rev ?? m.current_rev)
        if (!rev) throw new WriterError('NOT_FOUND', '还没有稿件')
        return { rev, text: await store.readDraft(m.id, rev), record: m.drafts.find(d => d.rev === rev) ?? null }
      },
    }),

    defineWriterTool<{ id: string; rows: { 原句?: string; 改后?: string; 病型?: string }[] }>({
      name: 'toutiao_edit_record',
      description: 'S5 记录红笔三联改写留痕（病灶原句 → 改后 → 病型/为什么），累加保存，交稿单第八节用。',
      properties: {
        id: ID,
        rows: {
          type: 'array',
          items: { type: 'object', properties: { 原句: S('病灶原句'), 改后: S('改后句子'), 病型: S('病型编号与原因') }, required: ['原句', '改后', '病型'], additionalProperties: false },
          description: '三联表行',
        },
      },
      required: ['id', 'rows'],
      async run(args, exec) {
        const store = st(exec)
        const id = reqStr(args, 'id')
        const m = await store.get(id)
        if (!Array.isArray(args.rows) || args.rows.length === 0) throw new WriterError('INVALID_ARGS', 'rows 不能为空')
        const prev = (await readJson<unknown[]>(store.editsPath(id))) ?? []
        const rows = args.rows.map(r => ({ rev: m.current_rev, 原句: String(r.原句 ?? ''), 改后: String(r.改后 ?? ''), 病型: String(r.病型 ?? ''), at: nowIso() }))
        await atomicWrite(store.editsPath(id), JSON.stringify([...prev, ...rows], null, 2))
        return { added: rows.length, total: prev.length + rows.length }
      },
    }),

    defineWriterTool<{ id: string; mode?: string }>({
      name: 'toutiao_qa_check',
      description: 'S6 质检当前版稿件（带立项卡与台账核对）。结果与稿件哈希、立项卡哈希绑定；改稿或改卡后需重跑。过线 = 综合 ≥ 84、零 fail、无硬闸。',
      properties: { id: ID, mode: E(['long', 'short', 'micro'], '体裁模式；立项卡写了体裁就不用给') },
      required: ['id'],
      async run(args, exec) {
        const store = st(exec)
        const id = reqStr(args, 'id')
        const m = await store.get(id)
        const cur = store.currentDraft(m)
        if (!cur) throw new WriterError('NOT_FOUND', '还没有稿件，先 toutiao_draft_stage')
        const text = await store.readDraft(id, cur.rev)
        if (sha256(text) !== cur.sha256) throw new WriterError('CONFLICT', '稿件文件被外部改动，与记录哈希不一致；请重新 toutiao_draft_stage')
        const cardText = await readText(store.cardPath(id))
        const a = ['qa', '--file', store.draftPath(id, cur.rev), '--ledger', store.ledgerPath]
        if (cardText !== undefined) a.push('--card', store.cardPath(id))
        if (args.mode) a.push('--mode', args.mode)
        const r = await bridge(config, a, { timeoutMs: 120_000, signal: exec.signal })
        const rec = {
          rev: cur.rev, sha256: cur.sha256, pass: r.pass === true, score: Number(r.score ?? 0),
          hard_gates: (r.hard_gates as string[]) ?? [], fail_count: ((r.fails as unknown[]) ?? []).length,
          rules_version: r.rules_version, card_sha256: cardText === undefined ? null : sha256(cardText), at: new Date().toISOString(), by: deps.role,
        }
        await store.update(id, (mm) => { mm.qa.push(rec) })
        const warn = cardText === undefined ? ['没有立项卡，未做立项卡与台账核对；交稿前必须补卡并重跑'] : []
        return {
          pass: rec.pass, score: rec.score, verdict: r.verdict, hard_gates: rec.hard_gates, fails: r.fails, warnings: [...warn, ...((r.warnings as string[]) ?? [])],
          title: r.title, title_len: r.title_len, chars: r.chars, rules_version: r.rules_version, rev: cur.rev,
          items: (r.report as any)?.items ?? [],
        }
      },
    }),

    defineWriterTool<{ id: string; to: string; note?: string }>({
      name: 'toutiao_status',
      description: '改文章状态。初稿待改→待验收→已验收/验收退回→已交稿。已验收需当前版质检过线；验收退回超过两轮需作者同意；已交稿只能由作者确认（会弹出确认，或请作者在写作台点"采用"）。',
      properties: { id: ID, to: E(STATUSES, '目标状态'), note: S('原因或说明') },
      required: ['id', 'to'],
      async run(args, exec) {
        const store = st(exec)
        const id = reqStr(args, 'id')
        const to = reqStr(args, 'to') as Status
        if (!STATUSES.includes(to)) throw new WriterError('INVALID_ARGS', `状态只能是：${STATUSES.join(' / ')}`)
        const before = await store.get(id)
        if (!canTransition(before.status, to)) throw new WriterError('CONFLICT', `不能从「${before.status}」改到「${to}」`)
        if (to === '待验收' && before.current_rev === 0) throw new WriterError('CONFLICT', '还没有稿件')
        if (to === '待验收' && config.requireEditorPass) {
          const cur = store.currentDraft(before)
          if (cur && cur.role === 'writer') throw new WriterError('GATE_DENIED', '当前版本还没经过编辑红笔：请用编辑子代理（toutiao_enable role=editor）改过再送验收')
        }
        if (to === '已验收') {
          const v = await validPassingQa(store, before)
          if (!v.ok) throw new WriterError('GATE_DENIED', v.reason)
          if (!(await store.readCard(id))) throw new WriterError('GATE_DENIED', '没有立项卡，不能验收')
        }
        const gates = deps.gates()
        if (to === '验收退回' && before.return_rounds >= MAX_RETURN_ROUNDS && gates?.isActive('toutiao.max_return_rounds')) {
          if (!gates.consumeConfirmation(exec, 'toutiao.max_return_rounds')) throw new WriterError('GATE_DENIED', `已打回 ${before.return_rounds} 轮，第三轮需作者同意`)
        }
        if (to === '已交稿') {
          if (!before.delivered) throw new WriterError('GATE_DENIED', '还没有交稿单（toutiao_delivery_save）')
          if (!gates || !gates.consumeConfirmation(exec, 'toutiao.deliver_requires_author')) {
            throw new WriterError('GATE_DENIED', '"已交稿"必须由作者明确采用：请作者在弹出的确认中同意，或在写作台点"采用"')
          }
        }
        const m = await store.update(id, (mm) => {
          if (mm.status !== before.status) throw new WriterError('CONFLICT', '状态已被其他操作改变，请重试')
          if (to === '验收退回') mm.return_rounds += 1
          mm.history.push({ from: mm.status, to, by: to === '已交稿' ? 'author' : 'agent', at: nowIso(), note: optStr(args, 'note') })
          mm.status = to
        })
        const ledger = await syncLedgerStatus(config, store, m).catch((e: any) => ({ synced: false, message: String(e?.message ?? e) }))
        return { article: summary(m), ledger }
      },
    }),

    defineWriterTool<{ id: string; markdown: string }>({
      name: 'toutiao_delivery_save',
      description: 'S7 保存交稿单（按 template-delivery）。仅限 已验收 的文章；必须含主标题与当前终稿正文；末句自动固定为止步句。',
      properties: { id: ID, markdown: S('交稿单 Markdown 全文') },
      required: ['id', 'markdown'],
      async run(args, exec) {
        const store = st(exec)
        const id = reqStr(args, 'id')
        const m = await store.get(id)
        if (m.status !== '已验收') throw new WriterError('GATE_DENIED', `只有 已验收 的文章能出交稿单（当前：${m.status}）`)
        const v = await validPassingQa(store, m)
        if (!v.ok) throw new WriterError('GATE_DENIED', v.reason)
        let md = String(args.markdown ?? '').replace(/\r\n/g, '\n').trim()
        if (!md) throw new WriterError('INVALID_ARGS', 'markdown 不能为空')
        const problems: string[] = []
        const slot = md.match(/\[(?:主标题|标题|事实与所在句|链接|时间|X|字数|分)\]/)
        if (slot) problems.push(`还有模板槽位没填：${slot[0]}`)
        const main = m.headlines.main
        if (main && !md.includes(main)) problems.push('交稿单里没有主推标题')
        const draft = await store.readDraft(id, m.current_rev)
        const probe = draft.split('\n').map(s => s.trim()).filter(s => s && !s.startsWith('#') && !s.startsWith('【配图')).slice(0, 2)
        if (probe.some(p => !md.includes(p))) problems.push('交稿单正文与当前终稿不一致（终稿开头段落没找到）')
        if (problems.length) throw new WriterError('INVALID_ARGS', problems.join('；'))
        md = md.split('\n').filter(l => !l.includes('AI 到此止步')).join('\n').trimEnd()
        md += `\n\n---\n> ${STOP_LINE}\n`
        await atomicWrite(store.deliveryPath(id), md)
        const after = await store.update(id, (mm) => { mm.delivered = true })
        return { article: summary(after), path: store.deliveryPath(id), chars: [...md].length }
      },
    }),

    defineWriterTool<{ id: string }>({
      name: 'toutiao_ledger_add',
      description: 'S7 把这篇记进发稿台账（只记立项字段，不存正文）。同一篇只记一次。',
      properties: { id: ID },
      required: ['id'],
      async run(args, exec) {
        const store = st(exec)
        const id = reqStr(args, 'id')
        const m = await store.get(id)
        if (!(await store.readCard(id))) throw new WriterError('NOT_FOUND', '没有立项卡')
        const shown = await bridge(config, ['ledger-show', '--ledger', store.ledgerPath, '--last', '100000'], { signal: exec.signal })
        const title = String((await store.readCard(id))?.['主标题'] ?? '')
        if (title && (shown.rows as Record<string, string>[]).some(r => r['主标题'] === title)) {
          throw new WriterError('CONFLICT', `台账里已有“${title}”`)
        }
        const r = await bridge(config, ['ledger-add', '--card', store.cardPath(id), '--ledger', store.ledgerPath, '--status', m.status, '--date', id.slice(0, 10)], { signal: exec.signal })
        return { row: r.row, ledger: store.ledgerPath }
      },
    }),

    defineWriterTool<{ last?: number }>({
      name: 'toutiao_ledger_show',
      description: 'S1/S2 读发稿台账最近若干行，防撞题撞脸。',
      properties: { last: I('最近几行，默认 10') },
      async run(args, exec) {
        const store = st(exec)
        const r = await bridge(config, ['ledger-show', '--ledger', store.ledgerPath, '--last', String(Math.max(1, Number(args.last ?? 10) || 10))], { signal: exec.signal })
        return { rows: r.rows, total: r.total }
      },
    }),

    defineWriterTool<{ original: string; revised: string; motive: string }>({
      name: 'toutiao_feedback_append',
      description: '作者改稿后记录"原文 → 改后 → 动机"，以后每次开工先读。',
      properties: { original: S('原文'), revised: S('作者改后'), motive: S('作者的动机') },
      required: ['original', 'revised', 'motive'],
      async run(args, exec) {
        const store = st(exec)
        await mkdir(store.root, { recursive: true })
        const line = `- ${today()}：${reqStr(args, 'original')} → ${reqStr(args, 'revised')} → ${reqStr(args, 'motive')}\n`
        const prev = await readText(store.feedbackPath)
        if (prev === undefined) await atomicWrite(store.feedbackPath, `# 作者改稿反馈\n\n${line}`)
        else await appendFile(store.feedbackPath, line, 'utf8')
        return { path: store.feedbackPath }
      },
    }),

    defineWriterTool({
      name: 'toutiao_feedback_read',
      description: '开工先读作者改稿反馈。同类动机满三次，提醒作者固化进方法。',
      properties: {},
      async run(_a, exec) {
        const store = st(exec)
        const text = (await readText(store.feedbackPath)) ?? ''
        return { text, entries: text.split('\n').filter(l => l.startsWith('- ')).length }
      },
    }),
  ]
}

async function saveCard(store: ReturnType<typeof storeFor>, id: string, card: Record<string, unknown>) {
  const issues = checkCard(card, TITLE_MAX)
  const sha = await store.writeCard(id, card)
  const line = typeof card['内容线'] === 'string' ? card['内容线'] : ''
  const genre = typeof card['体裁'] === 'string' ? card['体裁'] : ''
  await store.update(id, (m) => { if (line) m.line = line; if (genre) m.genre = genre })
  return { saved: true, card_sha256: sha, ready: !issues.some(i => i.level === 'fail'), issues }
}

/** 文章状态变化后同步台账里同标题那一行（若已记账） */
export async function syncLedgerStatus(config: ToutiaoConfig, store: ReturnType<typeof storeFor>, m: ArticleMeta) {
  const title = String((await store.readCard(m.id))?.['主标题'] ?? '')
  if (!title || !(await readText(store.ledgerPath))) return { synced: false }
  try {
    await bridge(config, ['ledger-status', '--title', title, '--to', m.status, '--ledger', store.ledgerPath])
    return { synced: true }
  } catch (e) {
    if (e instanceof WriterError && e.code === 'NOT_FOUND') return { synced: false }
    throw e
  }
}

