export type PreToolDecision =
  | { kind: "allow" }
  | { kind: "deny"; reason: string; info?: { name: string; code: string } }
  | { kind: "cancel" }
  | {
      kind: "ask";
      reason?: string;
      displayReason?: { readonly en: string; readonly [locale: string]: string };
    };

/** The executor binds every call to an explicit workspace. */
export interface ToolExecution {
  readonly cwd: string;
  readonly sessionId?: string;
  readonly role?: string;
  readonly callId?: string;
  readonly name: string;
  readonly arguments: unknown;
  readonly token?: symbol;
  readonly signal?: AbortSignal;
}

export interface JsonSchemaNode {
  type?: "object" | "array" | "string" | "number" | "integer" | "boolean" | "null";
  properties?: Record<string, JsonSchemaNode>;
  required?: string[];
  additionalProperties?: boolean;
  items?: JsonSchemaNode;
  enum?: (string | number | boolean | null)[];
  description?: string;
}

export interface ToolDefinition {
  name: string;
  description: string;
  parameters: JsonSchemaNode & { type: "object" };
  output: {
    schema: JsonSchemaNode;
    render(args: unknown, value: unknown): { type: "text"; text: string }[];
  };
  execute(args: unknown, exec: ToolExecution): Promise<unknown>;
}

/** 业务失败的统一形状 */
export interface ToolFailure {
  ok: false;
  code:
    | "INVALID_ARGS"
    | "NOT_FOUND"
    | "CONFLICT"
    | "GATE_DENIED"
    | "SCRIPT_FAILED"
    | "TIMEOUT"
    | "OUT_OF_ROOT"
    | "NO_AGENT"
    | "unsafe_path";
  message: string;
}

export interface WriterToolSpec<A> {
  name: string;
  description: string;
  properties: Record<string, JsonSchemaNode>;
  required?: string[];
  /** 业务实现；返回任意可 JSON 序列化对象。抛 WriterError 视为业务失败。 */
  run(args: A, exec: ToolExecution): Promise<Record<string, unknown>>;
}

export class WriterError extends Error {
  constructor(
    readonly code: ToolFailure["code"],
    message: string,
  ) {
    super(message);
    this.name = "WriterError";
  }
}

/**
 * 把业务工具包装成ToolDefinition：
 * - 返回值一律是 JSON 对象（output.schema = object），失败也是值（ok:false），基础设施异常照常抛出；
 * - render 给模型一份紧凑 JSON 文本。
 */
export function defineWriterTool<A>(spec: WriterToolSpec<A>): ToolDefinition {
  return {
    name: spec.name,
    description: spec.description,
    parameters: {
      type: "object",
      additionalProperties: false,
      properties: spec.properties,
      required: spec.required ?? [],
    },
    output: {
      schema: { type: "object" },
      render: (_args, value) => [{ type: "text", text: JSON.stringify(value) }],
    },
    async execute(args, exec) {
      try {
        const value = await spec.run((args ?? {}) as A, exec);
        // 去掉 undefined 等非 JSON 值：模型只能接收可序列化的工具回执
        return JSON.parse(JSON.stringify({ ok: true, ...value }));
      } catch (err) {
        if (err instanceof WriterError) {
          const failure: ToolFailure = { ok: false, code: err.code, message: err.message };
          return failure;
        }
        throw err;
      }
    },
  };
}
