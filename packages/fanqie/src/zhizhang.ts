import path from 'node:path'
import { WriterError, type HostToolExecution } from '../../dsh-adapter/src/index.js'
import { sha256 } from '../../core/src/fsx.js'
import { openWork as selectWork, withPluginConfig } from '../../zhizhang/dist/tools/context.js'
import { readWorkMeta, readChapter as loadChapter, listWorks as allWorks, storagePaths } from '../../zhizhang/dist/lib/work-store.js'
export interface ZhizhangPathsConfig { rootDir?: string; storageRoot?: string; worksRoot?: string }
export interface ChapterOutline { pov?: string; targetWords?: number; locks?: string; knowledge?: string; synopsis?: string; conflict?: string; beats?: string; ending?: string; [k: string]: unknown }
export interface ChapterRow { id: string; title: string; position: number; status: string; wordCount?: number }
export interface ChapterRecord extends ChapterRow { outline: ChapterOutline; body: string; bodySha256: string }
export interface WorkInfo { base?: string; key: string; title: string; dir: string; chapters: ChapterRow[] }
interface Selection { cfg: ZhizhangPathsConfig; exec?: HostToolExecution; workingDir?: string }
export function worksRoot(cfg: ZhizhangPathsConfig, exec?: HostToolExecution, workingDir?: string): Selection { return { cfg, exec, workingDir } }
export async function listWorks(root: Selection): Promise<WorkInfo[]> {
 const paths = storagePaths(root.exec as any, root.cfg as any, root.workingDir)
 const rows = await allWorks(paths)
 return rows.map((w: any) => ({ ...w, dir: path.join(paths.works, w.key) }))
}
export async function openWork(root: Selection, work?: string): Promise<WorkInfo> {
 try {
  const selected = await withPluginConfig(root.cfg, () => selectWork(root.exec as any, { work, working_dir: root.workingDir }))
  const meta = await readWorkMeta(selected.dir)
  return { base: selected.paths.base, key: meta.key, title: meta.title, dir: selected.dir, chapters: [...meta.chapters].sort((a: any,b: any) => a.position-b.position) }
 } catch (e) { throw new WriterError('NOT_FOUND', e instanceof Error ? e.message : String(e)) }
}
export async function readChapter(work: WorkInfo, id: string): Promise<ChapterRecord> {
 const row = work.chapters.find(c => c.id === id || c.title === id || String(c.position) === id)
 if (!row) throw new WriterError('NOT_FOUND', `没有这一章：${id}`)
 try { const ch = await loadChapter(work.dir, row.id); return { ...row, status: ch.status, outline: ch.outline, body: ch.body, bodySha256: sha256(ch.body) } }
 catch(e) { if ((e as any).code === 'ENOENT') return { ...row, outline: {}, body: '', bodySha256: sha256('') }; throw e }
}
/** 解析章节选择：单章 id/序号，或 "3-5" 区间，或省略 = 全部 */
export function pickChapters(work: WorkInfo, spec?: string): ChapterRow[] {
  if (!spec?.trim()) return work.chapters
  const s = spec.trim()
  const range = s.match(/^(\d+)\s*[-–~]\s*(\d+)$/)
  if (range) {
    const a = Number(range[1]), b = Number(range[2])
    const rows = work.chapters.filter(c => c.position >= Math.min(a, b) && c.position <= Math.max(a, b))
    if (!rows.length) throw new WriterError('NOT_FOUND', `第 ${a}–${b} 章不存在`)
    return rows
  }
  const ids = s.split(/[,，\s]+/).filter(Boolean)
  return ids.map(id => {
    const row = work.chapters.find(c => c.id === id || c.title === id || String(c.position) === id)
    if (!row) throw new WriterError('NOT_FOUND', `没有这一章：${id}`)
    return row
  })
}
