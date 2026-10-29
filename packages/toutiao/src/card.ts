/**
 * 立项卡结构预检（S2）。只查"填没填、填对没有"，深层规则（撞题、人物、主数字核对）
 * 仍由 qa_check.py --card 判定，不在这里复制。
 */
import { GENRES, LINES } from './store.js'

export interface CardIssue { level: 'fail' | 'warn'; field: string; message: string }

const BRACKET = /\[[^\]\n]{1,60}\]/
const CURLY = /\{[^}\n]{0,40}\}/

function walk(v: unknown, p: string, out: [string, string][]) {
  if (typeof v === 'string') out.push([p, v])
  else if (Array.isArray(v)) v.forEach((x, i) => walk(x, `${p}[${i}]`, out))
  else if (v && typeof v === 'object') for (const [k, x] of Object.entries(v)) walk(x, p ? `${p}.${k}` : k, out)
}

const str = (v: unknown) => (typeof v === 'string' ? v.trim() : '')

export function checkCard(card: Record<string, unknown>, titleMax = 34): CardIssue[] {
  const out: CardIssue[] = []
  const fail = (field: string, message: string) => out.push({ level: 'fail', field, message })
  const warn = (field: string, message: string) => out.push({ level: 'warn', field, message })

  const strings: [string, string][] = []
  walk(card, '', strings)
  for (const [p, s] of strings) {
    if (BRACKET.test(s)) fail(p, `还是模板占位：${s.match(BRACKET)![0]}`)
    else if (CURLY.test(s)) fail(p, `出现 {xx}，会被质检判未替换占位符：${s.match(CURLY)![0]}`)
  }

  const line = str(card['内容线'])
  if (!(LINES as readonly string[]).includes(line)) fail('内容线', `应为 ${LINES.join(' / ')}`)
  const genre = str(card['体裁'])
  if (!(GENRES as readonly string[]).includes(genre)) fail('体裁', `应为 ${GENRES.join(' / ')}`)
  for (const k of ['垂类', '人群', '主驱动']) if (!str(card[k])) fail(k, '必填')
  if (!str(card['主问题'])) fail('主问题', '必填：主稿回答读者心里的哪个问号')

  if (genre === '长图文') {
    const ext = (card['延伸'] ?? {}) as Record<string, unknown>
    if (!str(ext['起始小标题'])) fail('延伸.起始小标题', '长图文必填')
    if (!str(ext['接的问题'])) fail('延伸.接的问题', '长图文必填')
    if (str(ext['接的问题']) && str(ext['接的问题']) === str(card['主问题'])) fail('延伸.接的问题', '不能和主问题相同')
  }

  const sources = card['出处']
  if (!Array.isArray(sources) || sources.length === 0) fail('出处', '硬事实必须有出处（打开核实过的页面或作者素材）')
  else sources.forEach((s, i) => {
    const o = (s ?? {}) as Record<string, unknown>
    if (!str(o['事实'])) fail(`出处[${i}].事实`, '必填')
    if (!str(o['链接'])) fail(`出处[${i}].链接`, '必填：链接或"作者素材"')
  })

  if (line === '故事线') {
    for (const k of ['故事', '母题', '改编方式']) if (!str(card[k])) fail(k, '故事线必填')
    if (!Array.isArray(card['所用版本']) || (card['所用版本'] as unknown[]).length === 0) warn('所用版本', '故事线建议写明原典书名与篇名')
  }

  const title = str(card['主标题'])
  if (title && [...title].length > titleMax) fail('主标题', `${[...title].length} 字，超过 ${titleMax} 字硬上限`)
  const alts = card['备选标题']
  if (Array.isArray(alts)) alts.forEach((t, i) => {
    if (typeof t === 'string' && [...t.trim()].length > titleMax) fail(`备选标题[${i}]`, `超过 ${titleMax} 字硬上限`)
  })
  if (str(card['主数字']) && !str(card['主数字出处'])) fail('主数字出处', '写了主数字就要写出处')
  return out
}
