/**
 * 长篇门禁，拦同一会话里的 fanqie_* 调用。
 * requireEditorPass 在定稿路径里还有一道（review.ts finalizeProblem），写作台定稿也经过它；这里先拦，免得作者确认完才被拒。
 *
 * 写手：
 *   fanqie.finalize_requires_author  fanqie_chapter_save status=final → 请作者确认（锁定）
 *   fanqie.force_requires_author     任一 fanqie_* 带 force=true（覆盖定稿）→ 请作者确认（锁定）
 *   fanqie.finalize_requires_review  requireEditorPass 打开时，定稿前须有"通过"且版本匹配的审读回报
 * 编辑：
 *   fanqie.editor_readonly           采纳、定稿、改根基/章纲、入库、开书等写入类长篇工具一律拒绝（锁定）
 */
import type { GateRule } from '../../core/src/gates.js'
import type { FanqieConfig } from './config.js'
import { bodyFingerprint, editorPassProblem } from './review.js'
import { openWork, readChapter } from './works.js'
import type { Role } from './tools.js'

/** 编辑子代理不许碰的写入类工具 */
export const EDITOR_DENY = new Set([
  'fanqie_candidate_accept', 'fanqie_candidate_edit_decide', 'fanqie_candidate_stage',
  'fanqie_chapter_save', 'fanqie_foundation_set', 'fanqie_foundation_append_happened',
  'fanqie_outline_set', 'fanqie_inspire_accept', 'fanqie_library_card_accept',
  'fanqie_library_card_discard', 'fanqie_library_import', 'fanqie_project_create', 'fanqie_assemble',
])

export function fanqieGateRules(config: FanqieConfig, role: Role): GateRule[] {
  if (role === 'editor') {
    return [{
      id: 'fanqie.editor_readonly',
      tool: 'fanqie_*',
      locked: true,
      description: '编辑只能审读与出编辑候选，不能采纳、定稿、改根基或章纲',
      check(_args, exec) {
        if (!EDITOR_DENY.has(exec.name)) return undefined
        return { kind: 'deny', reason: `编辑不能调用 ${exec.name}。把审读结论用 fanqie_review_report 回报给主写手，由主写手和作者决定。需要改稿就用 fanqie_candidate_edit_brief / fanqie_candidate_edit_stage 出编辑候选。` }
      },
    }]
  }
  return [
    {
      id: 'fanqie.finalize_requires_author',
      tool: 'fanqie_chapter_save',
      locked: true,
      description: '定稿须作者确认',
      check(args) {
        if (args.status !== 'final') return undefined
        return { kind: 'ask', reason: `把「${String(args.chapter ?? args.id ?? '本章')}」定稿（final）需要作者确认。审读通过不自动获得定稿权。` }
      },
    },
    {
      id: 'fanqie.force_requires_author',
      tool: 'fanqie_*',
      locked: true,
      description: 'force 覆盖定稿须作者确认',
      check(args, exec) {
        if (args.force !== true) return undefined
        return { kind: 'ask', reason: `${exec.name} 带 force=true，会覆盖已定稿正文（降回草稿、需重新审读），需要作者确认。` }
      },
    },
    {
      id: 'fanqie.finalize_requires_review',
      tool: 'fanqie_chapter_save',
      locked: false,
      description: '（requireEditorPass 打开时）定稿前须有通过且版本匹配的编辑审读回报',
      async check(args, exec) {
        if (!config.requireEditorPass || args.status !== 'final') return undefined
        const chapter = String(args.chapter ?? args.id ?? '')
        if (!chapter) return { kind: 'deny', reason: '定稿须指明章节' }
        const w = await openWork(exec, typeof args.work === 'string' ? args.work : undefined, typeof args.working_dir === 'string' ? args.working_dir : undefined)
        const ch = await readChapter(w, chapter)
        const bodySha = typeof args.content === 'string' ? bodyFingerprint(args.content) : ch.bodySha256
        const problem = await editorPassProblem(w.dir, ch, bodySha)
        return problem ? { kind: 'deny', reason: problem } : undefined
      },
    },
  ]
}
