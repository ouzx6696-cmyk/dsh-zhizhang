import { randomUUID } from 'node:crypto'
/**
 * @writer/dsh-adapter — 本仓库唯一直接接触 DeepSeek Harness（DSH）宿主对象的地方。
 *
 * 设计：不 import 任何 @deepseek-ai/* 运行时包（与织章相同的"结构类型 + 能力探测"做法），
 * 所以插件不随 DSH 小版本的包名/导出调整而崩；宿主接口一旦变化，只改本文件。
 *
 * 锁定基线：DSH dsh-v0.2.1-rc.4。每个接口后的「出处」是该标签下的源码路径，
 * 改动前先到对应文件核对（docs/dsh-findings.md 有汇总）。
 */

/* ------------------------------------------------------------------ */
/* 结构类型（只声明本插件用到的字段）                                   */
/* ------------------------------------------------------------------ */

/** 出处：packages/core/tools/src/index.ts `PreToolDecision` */
export type PreToolDecision =
  | { kind: 'allow' }
  | { kind: 'deny'; reason: string; info?: { name: string; code: string } }
  | { kind: 'cancel' }
  | { kind: 'ask'; reason?: string; displayReason?: { readonly en: string; readonly [locale: string]: string } }

/** 出处：packages/core/session/src/types.ts（header.cwd）、packages/core/agent/src/index.ts */
export interface HostSession {
  readonly id?: string
  readonly header?: { readonly cwd?: string; readonly origin?: string; readonly parentSession?: string }
}

export interface HostAgent {
  readonly ctx?: HostContext
  readonly session?: HostSession
}

/** 出处：packages/core/tools/src/index.ts `ToolExecution` / `ToolRunContext` */
export interface HostToolExecution {
  readonly callId?: string
  readonly name: string
  readonly arguments: unknown
  readonly agent?: HostAgent
  readonly token?: symbol
  readonly signal?: AbortSignal
}

/** 出处：packages/core/tools/src/json-schema.ts `JsonSchemaNode`（只用其支持的子集） */
export interface JsonSchemaNode {
  type?: 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null'
  properties?: Record<string, JsonSchemaNode>
  required?: string[]
  additionalProperties?: boolean
  items?: JsonSchemaNode
  enum?: (string | number | boolean | null)[]
  description?: string
}

/** 出处：packages/core/tools/src/index.ts `ToolDefinition` / `ToolOutputDefinition` */
export interface HostToolDefinition {
  name: string
  description: string
  parameters: JsonSchemaNode & { type: 'object' }
  output: {
    schema: JsonSchemaNode
    render(args: unknown, value: unknown): { type: 'text'; text: string }[]
  }
  execute(args: unknown, exec: HostToolExecution): Promise<unknown>
}

export interface HostSystemPrompt {
  /** 出处：docs/cookbook/extension-cookbook.md「System prompt configurability」；织章 0.20.0 同用法 */
  section(def: { name: string; order: number; text: () => string }): (() => void) | void
}

export interface HostWorkingDirectory {
  /** 出处：packages/session/working-directory/src/index.ts `WorkingDirectoryService.get(session)` */
  get(session: HostSession): string
}

export interface HostWebServer {
  /** 出处：packages/credentials/deepseek-account-platform/src/index.ts（register exact route） */
  register(route: {
    kind: 'exact'
    path: string
    handler: (req: import('node:http').IncomingMessage, res: import('node:http').ServerResponse) => void
  }): (() => void) | void
}

type Disposer = () => void

/** Cordis Context 的最小形状。出处：@deepseek-ai/cordis；用法见 docs/cookbook/adding-a-tool.md */
export interface HostContext {
  tools?: {
    register(def: HostToolDefinition): Disposer | void
    execute?(exec: HostToolExecution): Promise<{ isError: boolean; value?: unknown }>
    guard?(fn: (exec: HostToolExecution) => string | undefined): Disposer
  }
  get?(name: string): unknown
  on?(event: string, listener: (...args: any[]) => any): Disposer | void
  inject?(deps: string[], cb: (ctx: HostContext & Record<string, any>) => void): void
  effect?(run: () => Disposer, label?: string): void
}

/* ------------------------------------------------------------------ */
/* 工具定义                                                            */
/* ------------------------------------------------------------------ */

/** 业务失败的统一形状（dev-plan §5.4） */
export interface ToolFailure {
  ok: false
  code: 'INVALID_ARGS' | 'NOT_FOUND' | 'CONFLICT' | 'GATE_DENIED' | 'SCRIPT_FAILED' | 'TIMEOUT' | 'OUT_OF_ROOT'
  message: string
}

export interface WriterToolSpec<A> {
  name: string
  description: string
  properties: Record<string, JsonSchemaNode>
  required?: string[]
  /** 业务实现；返回任意可 JSON 序列化对象。抛 WriterError 视为业务失败。 */
  run(args: A, exec: HostToolExecution): Promise<Record<string, unknown>>
}

export class WriterError extends Error {
  constructor(readonly code: ToolFailure['code'], message: string) {
    super(message)
    this.name = 'WriterError'
  }
}

/**
 * 把业务工具包装成宿主 ToolDefinition：
 * - 返回值一律是 JSON 对象（output.schema = object），失败也是值（ok:false），基础设施异常照常抛出；
 * - render 给模型一份紧凑 JSON 文本。
 */
export function defineWriterTool<A>(spec: WriterToolSpec<A>): HostToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: {
      type: 'object',
      additionalProperties: false,
      properties: spec.properties,
      required: spec.required ?? [],
    },
    output: {
      schema: { type: 'object' },
      render: (_args, value) => [{ type: 'text', text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      try {
        const value = await spec.run((args ?? {}) as A, exec)
        // 去掉 undefined 等非 JSON 值：宿主会对返回值做无损 JSON 快照并按 output.schema 校验
        return JSON.parse(JSON.stringify({ ok: true, ...value }))
      } catch (err) {
        if (err instanceof WriterError) {
          const failure: ToolFailure = { ok: false, code: err.code, message: err.message }
          return failure
        }
        throw err
      }
    },
  }
}

/* ------------------------------------------------------------------ */
/* 能力探测与小工具                                                     */
/* ------------------------------------------------------------------ */

/** 调用方 Agent 的作用域 ctx（按会话挂载工具/段落/门禁用）。出处：织章 dist/index.js `exec.agent.ctx` */
export function agentContextOf(exec: HostToolExecution): HostContext | undefined {
  const c = exec?.agent?.ctx
  return c && typeof c.tools?.register === 'function' ? c : undefined
}

/** 会话工作目录：workingDirectory 服务 → session.header.cwd → process.cwd() */
export function sessionCwd(exec: HostToolExecution | undefined, root?: HostContext): string {
  const session = exec?.agent?.session
  if (session) {
    const wd = (exec?.agent?.ctx?.get?.('workingDirectory') ?? root?.get?.('workingDirectory')) as HostWorkingDirectory | undefined
    if (wd && typeof wd.get === 'function') {
      try {
        const dir = wd.get(session)
        if (typeof dir === 'string' && dir) return dir
      } catch { /* 服务未就绪时回退 */ }
    }
    const cwd = session.header?.cwd
    if (typeof cwd === 'string' && cwd) return cwd
  }
  return process.cwd()
}

export function sessionIdOf(exec: HostToolExecution | undefined): string {
  return exec?.agent?.session?.id ?? 'default'
}

/** 注册系统提示段落；宿主不支持时返回 undefined（调用方降级为工具回执里给总则）。 */
export function addPromptSection(ctx: HostContext, name: string, order: number, text: () => string): Disposer | undefined {
  const sp = ctx.get?.('systemPrompt') as HostSystemPrompt | undefined
  if (!sp || typeof sp.section !== 'function') return undefined
  const d = sp.section({ name, order, text })
  return typeof d === 'function' ? d : undefined
}

/**
 * 注册 tools/pre-execute 门禁。在 agent.ctx 上注册时只收到该 Agent 的调用（出处：
 * packages/core/tools/src/index.ts Events['tools/pre-execute'] 注释「agent-scoped listeners receive only that agent's calls」）。
 */
export function onPreExecute(
  ctx: HostContext,
  gate: (exec: HostToolExecution) => Promise<PreToolDecision | undefined> | PreToolDecision | undefined,
): Disposer | undefined {
  if (typeof ctx.on !== 'function') return undefined
  const d = ctx.on('tools/pre-execute', async (exec: HostToolExecution, next: () => Promise<PreToolDecision>) => {
    const decision = await gate(exec)
    return decision ?? next()
  })
  return typeof d === 'function' ? d : undefined
}

/**
 * 观察最终工具结果（只读）。出处：packages/core/tools/src/index.ts Events['tools/result']（emit，监听器异常被隔离）
 * 与 `ToolExecutionSuccess.isError === false`。
 */
export function onToolResult(
  ctx: HostContext,
  observer: (exec: HostToolExecution, ok: boolean, value: unknown) => void | Promise<void>,
): Disposer | undefined {
  if (typeof ctx.on !== 'function') return undefined
  const d = ctx.on('tools/result', (exec: HostToolExecution, result: { isError?: boolean; value?: unknown }) => {
    try { Promise.resolve(observer(exec, result?.isError === false, result?.value)).catch(() => {}) } catch { /* 观察者不得影响宿主 */ }
  })
  return typeof d === 'function' ? d : undefined
}

/** 注册 HTTP 路由（面板）。出处：织章 lib/http-api.js 与 DSH webServer.register。 */
export function registerRoutes(ctx: HostContext, routes: { path: string; handler: Parameters<HostWebServer['register']>[0]['handler'] }[], label: string): boolean {
  try {
    if (typeof ctx.inject === 'function') {
      ctx.inject(['webServer'], (wctx) => {
        const run = (): Disposer => {
          const ds = routes.map(r => (wctx.webServer as HostWebServer).register({ kind: 'exact', path: r.path, handler: r.handler }))
          return () => { for (const d of ds) if (typeof d === 'function') d() }
        }
        if (typeof wctx.effect === 'function') wctx.effect(run, label)
        else run()
      })
      return true
    }
    const web = ctx.get?.('webServer') as HostWebServer | undefined
    if (web && typeof web.register === 'function') {
      for (const r of routes) web.register({ kind: 'exact', path: r.path, handler: r.handler })
      return true
    }
  } catch { /* 无 webServer：工具照常可用 */ }
  return false
}

/** Execute through the real scoped pipeline; never invoke a tool body directly.
 * Source: packages/core/tools/src/index.ts ToolRuntime.execute / ToolExecutionInput.
 */
export async function enableIntegratedZhizhang(exec: HostToolExecution): Promise<boolean> {
  const ctx = agentContextOf(exec)
  if (!ctx?.tools?.execute) return false
  const result = await ctx.tools.execute({
    name: 'zhizhang_enable', arguments: {}, agent: exec.agent,
    callId: randomUUID(), signal: exec.signal,
  })
  if (result.isError || typeof result.value !== 'string' || !result.value.startsWith('已启用织章')) {
    throw new WriterError('GATE_DENIED', '织章启用失败；请检查内置插件是否加载及宿主门禁，不会绕过门禁调用工具。')
  }
  return true
}

/** rc.4: packages/api/session-controller/src/index.ts prompt, types.ts SessionPromptRequest. */
export async function promptWriterSession(ctx: HostContext, sessionId: string, text: string): Promise<void> {
  const controller = ctx.get?.('sessionController') as { prompt?: (request: unknown, signal: AbortSignal) => Promise<{ accepted: boolean }> } | undefined
  if (!controller?.prompt) throw new WriterError('NOT_FOUND', '宿主没有 sessionController.prompt，会话消息未发送')
  const receipt = await controller.prompt({ requestId: randomUUID(), sessionId, mode: 'queue', content: [{ type: 'text', text }] }, new AbortController().signal)
  if (!receipt?.accepted) throw new WriterError('CONFLICT', '主会话未接收消息')
}

/** Legacy tool registration uses the same ToolRuntime.register boundary. */
export function registerHostTool(ctx: HostContext, tool: any): (() => void) | void { return ctx.tools?.register(tool) }
export async function optionalHostSchema(): Promise<any> {
  const spec = '@deepseek-ai/schemastery'
  try { return await import(spec) } catch { return undefined }
}
