import { AppError } from "../errors/app-error.js";

export type Parser<T> = (v: unknown, path?: string) => T;
export type Infer<P> = P extends Parser<infer T> ? T : never;

function fail(path: string, msg: string): never {
  throw new AppError("input.invalid", `${path}: ${msg}`, { path });
}

export function str(opts?: { min?: number; max?: number; trim?: boolean }): Parser<string> {
  return (v, path = "$") => {
    if (typeof v !== "string") fail(path, "expected string");
    const s = opts?.trim ? v.trim() : v;
    if (opts?.min !== undefined && s.length < opts.min) fail(path, `min length ${opts.min}`);
    if (opts?.max !== undefined && s.length > opts.max) fail(path, `max length ${opts.max}`);
    return s;
  };
}

export function int(opts?: { min?: number; max?: number }): Parser<number> {
  return (v, path = "$") => {
    if (typeof v !== "number" || !Number.isInteger(v)) fail(path, "expected integer");
    if (opts?.min !== undefined && v < opts.min) fail(path, `min ${opts.min}`);
    if (opts?.max !== undefined && v > opts.max) fail(path, `max ${opts.max}`);
    return v;
  };
}

export function num(opts?: { min?: number; max?: number }): Parser<number> {
  return (v, path = "$") => {
    if (typeof v !== "number" || !Number.isFinite(v)) fail(path, "expected finite number");
    if (opts?.min !== undefined && v < opts.min) fail(path, `min ${opts.min}`);
    if (opts?.max !== undefined && v > opts.max) fail(path, `max ${opts.max}`);
    return v;
  };
}

export const bool: Parser<boolean> = (v, path = "$") => {
  if (typeof v !== "boolean") fail(path, "expected boolean");
  return v;
};

export function lit<const L extends readonly string[]>(...values: L): Parser<L[number]> {
  return (v, path = "$") => {
    if (typeof v !== "string" || !values.includes(v)) {
      fail(path, `expected one of ${values.join("|")}`);
    }
    return v as L[number];
  };
}

export function arr<T>(item: Parser<T>, opts?: { max?: number }): Parser<T[]> {
  return (v, path = "$") => {
    if (!Array.isArray(v)) fail(path, "expected array");
    if (opts?.max !== undefined && v.length > opts.max) fail(path, `max items ${opts.max}`);
    return v.map((el, idx) => item(el, `${path}[${idx}]`));
  };
}

export function obj<S extends Record<string, Parser<unknown>>>(
  shape: S,
  opts: { strict?: boolean } = { strict: true },
): Parser<{ [K in keyof S]: ReturnType<S[K]> }> {
  return (v, path = "$") => {
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
  };
}

export function opt<T>(parser: Parser<T>): Parser<T | undefined> {
  return (v, path = "$") => (v === undefined ? undefined : parser(v, path));
}

export function record<T>(valParser: Parser<T>): Parser<Record<string, T>> {
  return (v, path = "$") => {
    if (typeof v !== "object" || v === null || Array.isArray(v)) {
      fail(path, "expected record");
    }
    const out: Record<string, T> = {};
    for (const [k, val] of Object.entries(v as Record<string, unknown>)) {
      out[k] = valParser(val, `${path}.${k}`);
    }
    return out;
  };
}
