import { AppError } from "../errors/app-error.js";

const SCHEMA_META = Symbol("zhizhang.schema.meta");

export type JsonSchema = Record<string, unknown>;

interface SchemaMeta {
  schema: JsonSchema;
  optional?: boolean;
}

export type Parser<T> = ((v: unknown, path?: string) => T) & {
  readonly [SCHEMA_META]?: SchemaMeta;
};
export type Infer<P> = P extends Parser<infer T> ? T : never;

function attach<T>(fn: (v: unknown, path?: string) => T, meta: SchemaMeta): Parser<T> {
  return Object.assign(fn, { [SCHEMA_META]: meta });
}

function fail(path: string, msg: string): never {
  throw new AppError("input.invalid", `${path}: ${msg}`, { path });
}

export function toJsonSchema(parser: Parser<unknown>): JsonSchema {
  return parser[SCHEMA_META]?.schema ?? {};
}

export function desc<T>(parser: Parser<T>, description: string): Parser<T> {
  const prev = parser[SCHEMA_META];
  return attach((v, path) => parser(v, path), {
    optional: prev?.optional,
    schema: { ...(prev?.schema ?? {}), description },
  });
}

export function str(opts?: { min?: number; max?: number; trim?: boolean }): Parser<string> {
  const schema: JsonSchema = {
    type: "string",
    ...(opts?.min !== undefined ? { minLength: opts.min } : {}),
    ...(opts?.max !== undefined ? { maxLength: opts.max } : {}),
  };
  return attach(
    (v, path = "$") => {
      if (typeof v !== "string") fail(path, "expected string");
      const s = opts?.trim ? v.trim() : v;
      if (opts?.min !== undefined && s.length < opts.min) fail(path, `min length ${opts.min}`);
      if (opts?.max !== undefined && s.length > opts.max) fail(path, `max length ${opts.max}`);
      return s;
    },
    { schema },
  );
}

export function int(opts?: { min?: number; max?: number }): Parser<number> {
  const schema: JsonSchema = {
    type: "integer",
    ...(opts?.min !== undefined ? { minimum: opts.min } : {}),
    ...(opts?.max !== undefined ? { maximum: opts.max } : {}),
  };
  return attach(
    (v, path = "$") => {
      if (typeof v !== "number" || !Number.isInteger(v)) fail(path, "expected integer");
      if (opts?.min !== undefined && v < opts.min) fail(path, `min ${opts.min}`);
      if (opts?.max !== undefined && v > opts.max) fail(path, `max ${opts.max}`);
      return v;
    },
    { schema },
  );
}

export function num(opts?: { min?: number; max?: number }): Parser<number> {
  const schema: JsonSchema = {
    type: "number",
    ...(opts?.min !== undefined ? { minimum: opts.min } : {}),
    ...(opts?.max !== undefined ? { maximum: opts.max } : {}),
  };
  return attach(
    (v, path = "$") => {
      if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "expected finite number");
      if (opts?.min !== undefined && v < opts.min) fail(path, `min ${opts.min}`);
      if (opts?.max !== undefined && v > opts.max) fail(path, `max ${opts.max}`);
      return v;
    },
    { schema },
  );
}

export const bool: Parser<boolean> = attach(
  (v, path = "$") => {
    if (typeof v !== "boolean") fail(path, "expected boolean");
    return v;
  },
  { schema: { type: "boolean" } },
);

export function lit<const L extends readonly string[]>(...values: L): Parser<L[number]> {
  return attach(
    (v, path = "$") => {
      if (typeof v !== "string" || !values.includes(v)) {
        fail(path, `expected one of ${values.join("|")}`);
      }
      return v as L[number];
    },
    { schema: { type: "string", enum: [...values] } },
  );
}

export function arr<T>(item: Parser<T>, opts?: { max?: number }): Parser<T[]> {
  const schema: JsonSchema = {
    type: "array",
    items: toJsonSchema(item),
    ...(opts?.max !== undefined ? { maxItems: opts.max } : {}),
  };
  return attach(
    (v, path = "$") => {
      if (!Array.isArray(v)) fail(path, "expected array");
      if (opts?.max !== undefined && v.length > opts.max) fail(path, `max items ${opts.max}`);
      return v.map((el, idx) => item(el, `${path}[${idx}]`));
    },
    { schema },
  );
}

export function obj<S extends Record<string, Parser<unknown>>>(
  shape: S,
  opts: { strict?: boolean } = { strict: true },
): Parser<{ [K in keyof S]: ReturnType<S[K]> }> {
  const properties: Record<string, JsonSchema> = {};
  const required: string[] = [];
  for (const [key, parser] of Object.entries(shape)) {
    const meta = parser[SCHEMA_META];
    properties[key] = meta?.schema ?? {};
    if (!meta?.optional) required.push(key);
  }
  const schema: JsonSchema = {
    type: "object",
    properties,
    ...(required.length > 0 ? { required } : {}),
    ...(opts.strict !== false ? { additionalProperties: false } : {}),
  };
  return attach(
    (v, path = "$") => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        fail(path, "expected object");
      }
      const raw = v as Record<string, unknown>;
      if (opts.strict !== false) {
        for (const key of Object.keys(raw)) {
          if (!(key in shape)) {
            fail(`${path}.${key}`, `unknown key "${key}"`);
          }
        }
      }
      const out: Record<string, unknown> = {};
      for (const [key, parser] of Object.entries(shape)) {
        out[key] = parser(raw[key], `${path}.${key}`);
      }
      return out as { [K in keyof S]: ReturnType<S[K]> };
    },
    { schema },
  );
}

export function opt<T>(parser: Parser<T>): Parser<T | undefined> {
  const prev = parser[SCHEMA_META];
  return attach((v, path = "$") => (v === undefined ? undefined : parser(v, path)), {
    optional: true,
    schema: prev?.schema ?? {},
  });
}

export function nullable<T>(parser: Parser<T>): Parser<T | null> {
  const inner = toJsonSchema(parser);
  return attach((v, path = "$") => (v === null ? null : parser(v, path)), {
    schema: { anyOf: [inner, { type: "null" }] },
  });
}

export function record<T>(valParser: Parser<T>): Parser<Record<string, T>> {
  return attach(
    (v, path = "$") => {
      if (typeof v !== "object" || v === null || Array.isArray(v)) {
        fail(path, "expected record");
      }
      const out: Record<string, T> = {};
      for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
        out[k] = valParser(val, `${path}.${k}`);
      }
      return out;
    },
    { schema: { type: "object", additionalProperties: toJsonSchema(valParser) } },
  );
}

export const unknownValue: Parser<unknown> = attach((v) => v, { schema: {} });
