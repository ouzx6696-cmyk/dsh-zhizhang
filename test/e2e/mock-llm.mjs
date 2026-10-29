// 假模型服务器：说 DeepSeek（Anthropic 兼容）Messages SSE 协议，按脚本依次发出工具调用。
// node mock-llm.mjs <port> <script.json> [log]
// script.json：{ "main": [...], "editor": [...] }（或直接一个数组 = main）。
//   会话首条用户消息含“【编辑任务】”走 editor 脚本，否则走 main。
//   步骤是 {name, input} 或 "WAIT"：WAIT 处先回一句文字结束本轮，等到之后出现新的用户消息（如子代理完成通知）再往下走。
import http from 'node:http'
import { readFileSync, appendFileSync } from 'node:fs'

const port = Number(process.argv[2] ?? 8787)
const raw = JSON.parse(readFileSync(process.argv[3], 'utf8'))
const scripts = Array.isArray(raw) ? { main: raw, editor: [] } : raw
const log = process.argv[4]
const L = (s) => { if (log) appendFileSync(log, s + '\n') }

function sse(res, events) {
  res.writeHead(200, { 'content-type': 'text/event-stream', 'cache-control': 'no-cache' })
  for (const e of events) res.write(`event: ${e.type}\ndata: ${JSON.stringify(e)}\n\n`)
  res.end()
}
const toolUse = (i, name, input) => [
  { type: 'content_block_start', index: 0, content_block: { type: 'tool_use', id: `toolu_${Date.now()}_${i}`, name, input: {} } },
  { type: 'content_block_delta', index: 0, delta: { type: 'input_json_delta', partial_json: JSON.stringify(input) } },
  { type: 'content_block_stop', index: 0 },
]
const text = (t) => [
  { type: 'content_block_start', index: 0, content_block: { type: 'text', text: '' } },
  { type: 'content_block_delta', index: 0, delta: { type: 'text_delta', text: t } },
  { type: 'content_block_stop', index: 0 },
]
const textOf = (c) => typeof c === 'string' ? c : (Array.isArray(c) ? c.filter(b => b.type === 'text').map(b => b.text).join('') : '')

http.createServer((req, res) => {
  let body = ''
  req.on('data', c => { body += c })
  req.on('end', () => {
    if (!req.url.endsWith('/messages')) {
      res.writeHead(200, { 'content-type': 'application/json' })
      res.end(JSON.stringify({ object: 'list', data: [{ id: 'mock-model', type: 'model' }] }))
      return
    }
    const msg = JSON.parse(body)
    const msgs = msg.messages ?? []
    const firstUser = textOf(msgs.find(m => m.role === 'user')?.content)
    const role = firstUser.includes('【编辑任务】') ? 'editor' : 'main'
    const script = scripts[role] ?? []
    // 统计工具结果与“最后一个工具结果之后的新用户文字”
    const results = []
    let userTextAfterLastResult = false
    for (const m of msgs) {
      const blocks = Array.isArray(m.content) ? m.content : []
      const rs = blocks.filter(b => b.type === 'tool_result')
      if (rs.length) { results.push(...rs); userTextAfterLastResult = false }
      else if (m.role === 'user' && results.length && textOf(m.content).trim()) userTextAfterLastResult = true
    }
    // 计算脚本指针：每遇到一个已越过的 WAIT 加 1
    let idx = 0, consumed = 0
    while (idx < script.length) {
      if (script[idx] === 'WAIT') {
        if (consumed === results.length && !userTextAfterLastResult) break
        if (consumed < results.length) { idx++; continue }
        idx++; userTextAfterLastResult = false; continue
      }
      if (consumed === results.length) break
      consumed++; idx++
    }
    const last = results.at(-1)
    const c = last ? textOf(last.content) || String(last.content ?? '') : ''
    L(`[${role}] step ${results.length} ${last ? (last.is_error ? 'ERR ' : 'OK ') + c.slice(0, 300).replace(/\n/g, ' ') : ''}`)
    if (results.length === 0) L(`[${role}] tools: ${(msg.tools ?? []).map(t => t.name).filter(n => n.startsWith('toutiao') || n === 'subagent').join(',')}`)
    L(`[${role}] brief-in-messages: ${JSON.stringify(msgs).includes('四条铁律')} editor-brief: ${JSON.stringify(msgs).includes('你是独立编辑')}`)
    const usage = { input_tokens: 10, output_tokens: 5 }
    const head = [{ type: 'message_start', message: { id: `msg_${Date.now()}`, type: 'message', role: 'assistant', model: msg.model, content: [], usage } }]
    const next = script[idx]
    let blocks, stop
    if (next === 'WAIT') { blocks = text('等编辑回报。'); stop = 'end_turn'; L(`[${role}] waiting`) }
    else if (next) { blocks = toolUse(idx, next.name, next.input); stop = 'tool_use' }
    else { blocks = text(role === 'editor' ? 'EDITOR-DONE' : 'E2E-DONE'); stop = 'end_turn' }
    sse(res, [...head, ...blocks, { type: 'message_delta', delta: { stop_reason: stop }, usage: { output_tokens: 5 } }, { type: 'message_stop' }])
  })
}).listen(port, '127.0.0.1', () => console.log(`mock llm on ${port}`))
