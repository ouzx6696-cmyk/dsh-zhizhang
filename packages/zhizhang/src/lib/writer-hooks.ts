import { assertResourceId } from './storage/primitives.js';
/** Writer integration hooks. No DSH dependency; original storage stays authoritative. */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ZhizhangError } from './errors.js';
export interface WriterAction { base: string; dir: string; work: string; chapter: string; action: 'continue' | 'review' | 'revise' }
export const writerHooks: { requireEditorPass: boolean; dispatch?: (action: WriterAction) => Promise<unknown>; lint?: (text: string, hits: any[]) => Promise<string> } = { requireEditorPass: false };
/** 兼容旧版本的本地时区文件名，按回报时间而不是文件名字典序取最新记录。 */
export async function latestWriterReport(dir: string, chapter: string) {
 chapter = assertResourceId(chapter, '章节 id');
 const folder = path.join(dir, 'writer-reviews', chapter);
 let names: string[];
 try { names = (await readdir(folder)).filter(n => n.endsWith('.json')); }
 catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return undefined; throw e; }
 let latest: { report: any; at: number; modified: number; name: string } | undefined;
 for (const name of names) {
  const file = path.join(folder, name);
  const report = JSON.parse(await readFile(file, 'utf8'));
  const modified = (await stat(file)).mtimeMs;
  const time = typeof report.at === 'string' ? Date.parse(report.at) : NaN;
  const at = Number.isFinite(time) ? time : modified;
  if (!latest || at > latest.at || at === latest.at && (modified > latest.modified || modified === latest.modified && name > latest.name))
   latest = { report, at, modified, name };
 }
 return latest?.report;
}
export async function readWriterReview(dir: string, chapter: string, body: string) {
 const report = await latestWriterReport(dir, chapter);
 if (!report) return null;
 const hash = createHash('sha256').update(body).digest('hex');
 return { verdict: report.verdict, fresh: report.body_sha256 === hash, hard_count: Array.isArray(report.hard_issues) ? report.hard_issues.length : -1, report };
}
export async function assertWriterReview(dir: string, chapter: string, body: string) {
 if (!writerHooks.requireEditorPass) return;
 const review = await readWriterReview(dir, chapter, body);
 if (!review || !review.fresh || review.verdict !== '通过' || review.hard_count !== 0 || review.report.reread_full !== true || review.report.by !== 'editor')
  throw new ZhizhangError('GATE_DENIED', '定稿须有独立编辑回报，并对当前正文完整回读、零硬伤且通过。');
}
