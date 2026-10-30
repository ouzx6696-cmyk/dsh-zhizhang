/** Skill 第二、三级：按步骤取方法文件、按需取语料。只读插件自带的 skill 目录。 */
import { existsSync } from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { WriterError } from '../../host/src/index.js'
import { readText } from '../../core/src/fsx.js'

export const METHOD_FILES: Record<string, string> = {
  'overview': 'SKILL.md',
  's1-hot': 'references/s1-hot.md',
  's1-evergreen': 'references/s1-evergreen.md',
  's2-selection': 'references/s2-selection.md',
  's3-headline': 'references/s3-headline.md',
  's4-common': 'references/s4-common.md',
  's4-news': 'references/s4-news.md',
  's4-story': 'references/s4-story.md',
  's4-micro': 'references/s4-micro.md',
  's5-editing': 'references/s5-editing.md',
  's6-qa': 'references/s6-qa.md',
  's7-delivery': 'references/s7-delivery.md',
  'template-card': 'templates/brief.json',
  'template-delivery': 'templates/交稿单-图文.md',
  'corpus-common': 'corpus/common.md',
  'corpus-benchmark': 'corpus/benchmark.md',
  'corpus-story-motifs': 'corpus/story/motifs.md',
  'corpus-story-texture': 'corpus/story/texture.md',
  'corpus-民生社保': 'corpus/01-民生社保.md',
  'corpus-职场就业': 'corpus/02-职场就业.md',
  'corpus-房产楼市': 'corpus/03-房产楼市.md',
  'corpus-教育升学': 'corpus/04-教育升学.md',
  'corpus-健康养老': 'corpus/05-健康养老.md',
  'corpus-三农乡土': 'corpus/06-三农乡土.md',
  'corpus-情感家庭': 'corpus/07-情感家庭.md',
  'corpus-财经理财': 'corpus/08-财经理财.md',
  'corpus-汽车出行': 'corpus/09-汽车出行.md',
  'corpus-科技数码': 'corpus/10-科技数码.md',
  'corpus-社会观察': 'corpus/11-社会观察.md',
  'corpus-文旅消费': 'corpus/12-文旅消费.md',
}

let resolved: string | undefined

/** 找插件自带 skill 目录：环境变量 → 打包后 <pkg>/skill → 源码树 packages/toutiao/skill */
export function skillDir(): string {
  if (resolved) return resolved
  const here = path.dirname(fileURLToPath(import.meta.url))
  const candidates = [
    process.env.WRITER_TOUTIAO_SKILL_DIR,
    path.resolve(here, '../skill'),
    path.resolve(here, '../../skill'),
    path.resolve(here, '../../../packages/toutiao/skill'),
    path.resolve(here, '../../../../packages/toutiao/skill'),
  ].filter((x): x is string => !!x)
  for (const c of candidates) {
    if (existsSync(path.join(c, 'scripts', 'writer_bridge.py'))) { resolved = c; return c }
  }
  throw new WriterError('NOT_FOUND', `找不到头条 skill 目录（试过 ${candidates.join(' ; ')}）`)
}

export function bridgeScript(): string {
  return path.join(skillDir(), 'scripts', 'writer_bridge.py')
}

export async function getMethod(id: string): Promise<{ id: string; file: string; text: string }> {
  const rel = METHOD_FILES[id]
  if (!rel) throw new WriterError('INVALID_ARGS', `没有这份方法：${id}。可选：${Object.keys(METHOD_FILES).join('、')}`)
  const text = await readText(path.join(skillDir(), rel))
  if (text === undefined) throw new WriterError('NOT_FOUND', `方法文件缺失：${rel}`)
  return { id, file: rel, text }
}
