import { WriterError } from '../../core/src/tool.js'
/** 头条门禁规则。门禁只负责作者确认，业务合法性由工具检查。 */
import type { GateRule } from '../../core/src/gates.js'
import { storeFor, type ToutiaoConfig } from './env.js'
import { MAX_RETURN_ROUNDS } from './store.js'

export function toutiaoGateRules(config: ToutiaoConfig): GateRule[] {
  const idOf = (a: Record<string, unknown>) => (typeof a.id === 'string' ? a.id.trim() : '')
  const load = async (exec: Parameters<GateRule['check']>[1], id: string) => {
    const store = await storeFor(config, exec)
    try { return { store, meta: await store.get(id) } }
    catch (error) {
      if (error instanceof WriterError && error.code === 'NOT_FOUND') return undefined
      throw error
    }
  }
  return [

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


  ]
}
