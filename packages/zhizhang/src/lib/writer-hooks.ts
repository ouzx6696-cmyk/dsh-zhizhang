import { assertResourceId } from './storage/primitives.js';
/** Writer integration hooks. No DSH dependency; original storage stays authoritative. */
import { readFile, readdir } from 'node:fs/promises';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { ZhizhangError } from './errors.js';
export interface WriterAction { base: string; dir: string; work: string; chapter: string; action: 'continue' | 'review' | 'revise' }
export const writerHooks: { requireEditorPass: boolean; dispatch?: (action: WriterAction) => Promise<unknown>; lint?: (text: string, hits: any[]) => Promise<string> } = { requireEditorPass: false };
export async function readWriterReview(dir: string, chapter: string, body: string) {
 chapter = assertResourceId(chapter, '章节 id');
 const folder = path.join(dir, 'writer-reviews', chapter);
 let names: string[];
 try { names = (await readdir(folder)).filter(n => n.endsWith('.json')).sort(); }
 catch(e) { if ((e as NodeJS.ErrnoException).code === 'ENOENT') return null; throw e; }
 const name = names.at(-1); if (!name) return null;
 const report = JSON.parse(await readFile(path.join(folder,name),'utf8'));
 const hash = createHash('sha256').update(body).digest('hex');
 return { verdict: report.verdict, fresh: report.body_sha256 === hash, hard_count: Array.isArray(report.hard_issues) ? report.hard_issues.length : -1, report };
}
export async function assertWriterReview(dir: string, chapter: string, body: string) {
 if (!writerHooks.requireEditorPass) return;
 const review = await readWriterReview(dir, chapter, body);
 if (!review || !review.fresh || review.verdict !== '通过' || review.hard_count !== 0 || review.report.reread_full !== true)
  throw new ZhizhangError('GATE_DENIED', '定稿须有当前正文版本、完整回读且零硬伤的通过编辑回报。');
}
