/**
 * 体裁路由与隔离（architecture §6，dev-plan T2.2）。
 * 一个会话（Agent）只能处于一种体裁：头条 toutiao 或番茄长篇 fanqie（织章）。
 * 体裁一旦确定，另一体裁的工具在该会话里一律被门禁拒绝，避免两套规则互相串台。
 */
import { WriterError, type HostToolExecution, type PreToolDecision } from '../../dsh-adapter/src/index.js'

export type Genre = 'toutiao' | 'fanqie'

export const GENRE_LABEL: Record<Genre, string> = { toutiao: '今日头条', fanqie: '番茄长篇（织章）' }

/** 各体裁的工具名前缀；织章 0.20.0 的工具统一以 zhizhang_ 开头，本插件的长篇工具以 fanqie_ 开头 */
export const GENRE_PREFIX: Record<Genre, string[]> = { toutiao: ['toutiao_'], fanqie: ['zhizhang_', 'fanqie_'] }

export function genreOfTool(name: string): Genre | undefined {
  for (const g of Object.keys(GENRE_PREFIX) as Genre[]) if (GENRE_PREFIX[g].some(p => name.startsWith(p))) return g
  return undefined
}

export class GenreRegistry {
  private readonly byAgent = new WeakMap<object, Genre>()
  private readonly bySession = new Map<string, Genre>()

  private keyOf(exec: HostToolExecution): { obj?: object; sid?: string } {
    return { obj: exec.agent as object | undefined, sid: exec.agent?.session?.id }
  }

  get(exec: HostToolExecution): Genre | undefined {
    const { obj, sid } = this.keyOf(exec)
    return (obj && this.byAgent.get(obj)) ?? (sid ? this.bySession.get(sid) : undefined)
  }

  /** 认领体裁；与已有体裁冲突时抛 CONFLICT */
  claim(exec: HostToolExecution, genre: Genre): void {
    const cur = this.get(exec)
    if (cur && cur !== genre) {
      throw new WriterError('CONFLICT', `本会话已在写「${GENRE_LABEL[cur]}」，不能再切到「${GENRE_LABEL[genre]}」。请新开一个会话。`)
    }
    const { obj, sid } = this.keyOf(exec)
    if (obj) this.byAgent.set(obj, genre)
    if (sid) {
      this.bySession.set(sid, genre)
      if (this.bySession.size > 2000) this.bySession.delete(this.bySession.keys().next().value!)
    }
  }

  /** 全局门禁：会话体裁已定时，拒绝另一体裁的工具 */
  gate(exec: HostToolExecution): PreToolDecision | undefined {
    const toolGenre = genreOfTool(exec.name)
    if (!toolGenre) return undefined
    const cur = this.get(exec)
    if (!cur || cur === toolGenre) return undefined
    return {
      kind: 'deny',
      reason: `【体裁隔离】本会话在写「${GENRE_LABEL[cur]}」，不能调用「${GENRE_LABEL[toolGenre]}」的工具 ${exec.name}。需要的话请新开会话。`,
      info: { name: 'WriterGate', code: 'GENRE_ISOLATION' },
    }
  }
}

/** 进程内唯一的体裁登记：挂在 globalThis 上，保证即便被打包成多份也共用一份 */
const KEY = Symbol.for('writer-agent.genres')
export const genres: GenreRegistry = ((globalThis as any)[KEY] ??= new GenreRegistry())
