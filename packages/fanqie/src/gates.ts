/**
 * 长篇门禁（dev-plan T3.6 / T3.7）。拦的是织章工具（同一会话里的 zhizhang_*），织章本身一行不改。
 *
 * 写手：
 *   fanqie.finalize_requires_author  zhizhang_chapter_save status=final → 请作者确认（锁定）
 *   fanqie.force_requires_author     任一 zhizhang_* 带 force=true（覆盖定稿）→ 请作者确认（锁定）
 *   fanqie.finalize_requires_review  requireEditorPass 打开时，定稿前须有"通过"且版本匹配的审读回报
 * 编辑：
 *   fanqie.editor_readonly           采纳、定稿、改根基/章纲、入库、开书等写入类织章工具一律拒绝（锁定）
 */
import type { GateRule } from '../../gates/src/index.js'
import { sha256 } from '../../core/src/fsx.js'
import { latestReview, type FanqieConfig } from './env.js'
import { openWork, readChapter, worksRoot } from './zhizhang.js'
import type { Role } from './tools.js'

/** 编辑子代理不许碰的织章写入类工具 */
export const EDITOR_DENY = new Set([
  'zhizhang_candidate_accept', 'zhizhang_candidate_edit_decide', 'zhizhang_candidate_stage',
  'zhizhang_chapter_save', 'zhizhang_foundation_set', 'zhizhang_foundation_append_happened',
  'zhizhang_outline_set', 'zhizhang_inspire_accept', 'zhizhang_library_card_accept',
  'zhizhang_library_card_discard', 'zhizhang_library_import', 'zhizhang_project_create', 'zhizhang_assemble',
])

export function fanqieGateRules(config: FanqieConfig, role: Role): GateRule[] {
  if (role === 'editor') {
    return [{
      id: 'fanqie.editor_readonly',
      tool: 'zhizhang_*',
      locked: true,
      description: '编辑只能审读与出编辑候选，不能采纳、定稿、改根基或章纲',
      check(_args, exec) {
        if (!EDITOR_DENY.has(exec.name)) return undefined
        return { kind: 'deny', reason: `编辑不能调用 ${exec.name}。把审读结论用 fanqie_review_report 回报给主写手，由主写手和作者决定。需要改稿就用 zhizhang_candidate_edit_brief / zhizhang_candidate_edit_stage 出编辑候选。` }
      },
    }]
  }
  return [
    {
      id: 'fanqie.finalize_requires_author',
      tool: 'zhizhang_chapter_save',
      locked: true,
      description: '定稿须作者确认',
      check(args) {
        if (args.status !== 'final') return undefined
        return { kind: 'ask', reason: `把「${String(args.chapter ?? args.id ?? '本章')}」定稿（final）需要作者确认。审读通过不自动获得定稿权。` }
      },
    },
    {
      id: 'fanqie.force_requires_author',
      tool: 'zhizhang_*',
      locked: true,
      description: 'force 覆盖定稿须作者确认',
      check(args, exec) {
        if (args.force !== true) return undefined
        return { kind: 'ask', reason: `${exec.name} 带 force=true，会覆盖已定稿正文（降回草稿、需重新审读），需要作者确认。` }
      },
    },
    {
      id: 'fanqie.finalize_requires_review',
      tool: 'zhizhang_chapter_save',
      locked: false,
      description: '（requireEditorPass 打开时）定稿前须有通过且版本匹配的编辑审读回报',
      async check(args, exec) {
        if (!config.requireEditorPass || args.status !== 'final') return undefined
        const chapter = String(args.chapter ?? args.id ?? '')
        if (!chapter) return { kind: 'deny', reason: '定稿须指明章节' }
        const w = await openWork(worksRoot(config.zhizhang ?? {}, exec, typeof args.working_dir === 'string' ? args.working_dir : undefined), typeof args.work === 'string' ? args.work : undefined)
        const ch = await readChapter(w, chapter)
        const bodySha = typeof args.content === 'string' ? sha256(String(args.content).replace(/^\r?\n/, '').replace(/\r?\n$/, '')) : ch.bodySha256
        const r = await latestReview(config, exec, w.key, ch.id, w.dir)
        if (!r) return { kind: 'deny', reason: `${ch.title} 还没有编辑审读回报；先派编辑子代理审读（fanqie_review_report）` }
        if (r.body_sha256 !== bodySha) return { kind: 'deny', reason: `${ch.title} 的审读回报对应的是旧正文，正文改过后要重新审读` }
        if (r.verdict !== '通过') return { kind: 'deny', reason: `${ch.title} 最新审读结论是「${r.verdict}」，硬伤解决并重审通过后才能定稿` }
        return undefined
      },
    },
  ]
}
