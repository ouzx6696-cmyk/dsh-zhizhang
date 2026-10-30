/**
 * 写作模式与隔离。一个会话（Agent）只能处于一种模式：今日头条 toutiao 或番茄长篇 fanqie，由 writer_enable(mode) 确定。
 * 模式一旦确定，另一模式的工具在该会话里一律被拒绝，避免两套规则互相串台。
 */
import { WriterError, type HostToolExecution, type PreToolDecision } from '../../host/src/index.js'

export type Mode = 'toutiao' | 'fanqie'
export const MODES: Mode[] = ['toutiao', 'fanqie']

export const MODE_LABEL: Record<Mode, string> = { toutiao: '今日头条', fanqie: '番茄长篇' }

/** 各模式的工具名前缀 */
export const MODE_PREFIX: Record<Mode, string[]> = { toutiao: ['toutiao_'], fanqie: ['fanqie_'] }

export function modeOfTool(name: string): Mode | undefined {
  for (const g of Object.keys(MODE_PREFIX) as Mode[]) if (MODE_PREFIX[g].some(p => name.startsWith(p))) return g
  return undefined
}

export class ModeRegistry {
  private readonly byAgent = new WeakMap<object, Mode>()
  private readonly bySession = new Map<string, Mode>()

  private keyOf(exec: HostToolExecution): { obj?: object; sid?: string } {
    return { obj: exec.agent as object | undefined, sid: exec.agent?.session?.id }
  }

  get(exec: HostToolExecution): Mode | undefined {
    const { obj, sid } = this.keyOf(exec)
    return (obj && this.byAgent.get(obj)) ?? (sid ? this.bySession.get(sid) : undefined)
  }

  /** 认领模式；与已有模式冲突时抛 CONFLICT */
  claim(exec: HostToolExecution, mode: Mode): void {
    const cur = this.get(exec)
    if (cur && cur !== mode) {
      throw new WriterError('CONFLICT', `本会话已在写「${MODE_LABEL[cur]}」，不能再切到「${MODE_LABEL[mode]}」。请新开一个会话再 writer_enable。`)
    }
    const { obj, sid } = this.keyOf(exec)
    if (obj) this.byAgent.set(obj, mode)
    if (sid) {
      this.bySession.set(sid, mode)
      if (this.bySession.size > 2000) this.bySession.delete(this.bySession.keys().next().value!)
    }
  }

  /** 全局门禁：会话模式已定时，拒绝另一模式的工具 */
  gate(exec: HostToolExecution): PreToolDecision | undefined {
    const toolMode = modeOfTool(exec.name)
    if (!toolMode) return undefined
    const cur = this.get(exec)
    if (!cur || cur === toolMode) return undefined
    return {
      kind: 'deny',
      reason: `【模式隔离】本会话在写「${MODE_LABEL[cur]}」，不能调用「${MODE_LABEL[toolMode]}」的工具 ${exec.name}。需要的话请新开会话。`,
      info: { name: 'WriterGate', code: 'MODE_ISOLATION' },
    }
  }
}

/** 进程内唯一的模式登记：挂在 globalThis 上，保证即便被打包成多份也共用一份 */
const KEY = Symbol.for('writer-agent.modes')
export const modes: ModeRegistry = ((globalThis as any)[KEY] ??= new ModeRegistry())
