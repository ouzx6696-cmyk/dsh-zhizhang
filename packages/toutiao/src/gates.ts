/** 头条门禁规则。工具内另有同等复核，门禁失效也不会被绕过。 */
import type { HostContext } from '../../host/src/index.js'
import type { GateRule } from '../../core/src/gates.js'
import { storeFor, type ToutiaoConfig } from './env.js'
import { MAX_RETURN_ROUNDS } from './store.js'
import { validPassingQa } from './tools.js'

export function toutiaoGateRules(config: ToutiaoConfig, host?: HostContext): GateRule[] {
  const idOf = (a: Record<string, unknown>) => (typeof a.id === 'string' ? a.id.trim() : '')
  const load = async (exec: Parameters<GateRule['check']>[1], id: string) => {
    const store = storeFor(config, exec, host)
    try { return { store, meta: await store.get(id) } } catch { return undefined }
  }
  return [
    {
      id: 'toutiao.accept_requires_qa',
      tool: 'toutiao_status',
      locked: true,
      description: '置为“已验收”前，当前版本必须有仍有效的过线质检',
      async check(args, exec) {
        if (args.to !== '已验收') return undefined
        const x = await load(exec, idOf(args))
        if (!x) return undefined // 让工具自己报 NOT_FOUND
        const v = await validPassingQa(x.store, x.meta)
        return v.ok ? undefined : { kind: 'deny', reason: v.reason }
      },
    },
    {
      id: 'toutiao.deliver_requires_author',
      tool: 'toutiao_status',
      locked: true,
      description: '置为“已交稿”必须作者明确采用',
      async check(args, exec) {
        if (args.to !== '已交稿') return undefined
        const x = await load(exec, idOf(args))
        const title = x?.meta.headlines.main || x?.meta.id || idOf(args)
        return { kind: 'ask', reason: `作者确认采用《${title}》并标记为“已交稿”？（AI 不会替你发布）` }
      },
    },
    {
      id: 'toutiao.max_return_rounds',
      tool: 'toutiao_status',
      locked: false,
      description: `自动打回最多 ${MAX_RETURN_ROUNDS} 轮，再打回需作者同意`,
      async check(args, exec) {
        if (args.to !== '验收退回') return undefined
        const x = await load(exec, idOf(args))
        if (!x || x.meta.return_rounds < MAX_RETURN_ROUNDS) return undefined
        return { kind: 'ask', reason: `这篇已打回 ${x.meta.return_rounds} 轮，是否同意继续第 ${x.meta.return_rounds + 1} 轮修改？` }
      },
    },
    {
      id: 'toutiao.editor_pass',
      tool: 'toutiao_status',
      locked: false,
      description: '（requireEditorPass 打开时）送“待验收”前须经编辑子代理红笔',
      async check(args, exec) {
        if (!config.requireEditorPass || args.to !== '待验收') return undefined
        const x = await load(exec, idOf(args))
        const cur = x?.meta.drafts.find(d => d.rev === x.meta.current_rev)
        if (!cur || cur.role !== 'writer') return undefined
        return { kind: 'deny', reason: '当前版本还没经过编辑红笔：请用编辑子代理改过再送验收' }
      },
    },
    {
      id: 'toutiao.delivery_requires_accepted',
      tool: 'toutiao_delivery_save',
      locked: true,
      description: '只有“已验收”的文章能出交稿单',
      async check(args, exec) {
        const x = await load(exec, idOf(args))
        if (!x) return undefined
        return x.meta.status === '已验收' ? undefined : { kind: 'deny', reason: `当前状态是“${x.meta.status}”，不能出交稿单` }
      },
    },
  ]
}
