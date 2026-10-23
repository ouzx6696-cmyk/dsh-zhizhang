/**
 * Minimal bun/jest-compatible `expect` for node:test.
 *
 * Why this exists: the suite was written against `bun:test`, which is unavailable on
 * machines without bun. Only the matchers actually used by the suite are implemented
 * (plus a few cheap extras), so behaviour stays predictable instead of half-emulated.
 */

class AssertionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "AssertionError";
  }
}

const ASYM = Symbol.for("zhizhang.asymmetric");

/** expect.arrayContaining([...]) — only the subset check, as used by the suite. */
function arrayContaining(items: unknown[]) {
  return { [ASYM]: "arrayContaining", items } as const;
}

/** expect.objectContaining({...}) — partial match. */
function objectContaining(obj: Record<string, unknown>) {
  return { [ASYM]: "objectContaining", obj } as const;
}

function isAsym(v: unknown): v is { [ASYM]: string; items?: unknown[]; obj?: Record<string, unknown> } {
  return typeof v === "object" && v !== null && (v as any)[ASYM] !== undefined;
}

function tag(v: unknown): string {
  return Object.prototype.toString.call(v);
}

export function deepEqual(a: unknown, b: unknown): boolean {
  if (Object.is(a, b)) return true;
  // Asymmetric matchers on the *expected* side (arrayContaining / objectContaining).
  if (isAsym(b)) {
    if (b[ASYM] === "arrayContaining") {
      if (!Array.isArray(a)) return false;
      return (b.items ?? []).every((x) => (a as unknown[]).some((y) => deepEqual(y, x)));
    }
    if (b[ASYM] === "objectContaining") {
      if (typeof a !== "object" || a === null) return false;
      return Object.keys(b.obj ?? {}).every((k) => deepEqual((a as any)[k], (b.obj as any)[k]));
    }
  }
  if (typeof a !== "object" || typeof b !== "object" || a === null || b === null) return false;
  const ta = tag(a);
  if (ta !== tag(b)) return false;
  if (a instanceof Date && b instanceof Date) return a.getTime() === b.getTime();
  if (a instanceof RegExp && b instanceof RegExp) return String(a) === String(b);
  if (Array.isArray(a) && Array.isArray(b)) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) if (!deepEqual(a[i], b[i])) return false;
    return true;
  }
  if (a instanceof Map && b instanceof Map) {
    if (a.size !== b.size) return false;
    for (const [k, v] of a) if (!b.has(k) || !deepEqual(v, b.get(k))) return false;
    return true;
  }
  if (a instanceof Set && b instanceof Set) {
    if (a.size !== b.size) return false;
    for (const v of a) if (!b.has(v)) return false;
    return true;
  }
  const ka = Object.keys(a as object).filter((k) => (a as any)[k] !== undefined);
  const kb = Object.keys(b as object).filter((k) => (b as any)[k] !== undefined);
  if (ka.length !== kb.length) return false;
  for (const k of ka) {
    if (!Object.prototype.hasOwnProperty.call(b, k)) return false;
    if (!deepEqual((a as any)[k], (b as any)[k])) return false;
  }
  return true;
}

export function format(v: unknown, depth = 0): string {
  if (typeof v === "string") return JSON.stringify(v.length > 400 ? v.slice(0, 400) + "…" : v);
  if (typeof v === "function") return `[Function ${(v as any).name || "anonymous"}]`;
  if (v === undefined) return "undefined";
  if (v === null) return "null";
  if (typeof v === "number" || typeof v === "boolean" || typeof v === "bigint") return String(v);
  if (v instanceof RegExp) return String(v);
  if (v instanceof Date) return v.toISOString();
  if (v instanceof Error) return `${v.name}: ${v.message}`;
  if (depth > 3) return Array.isArray(v) ? "[…]" : "{…}";
  try {
    const json = JSON.stringify(v, null, 1);
    if (json === undefined) return String(v);
    return json.length > 900 ? json.slice(0, 900) + "…" : json;
  } catch {
    return String(v);
  }
}

function hasPath(obj: unknown, path: string | (string | number)[]): boolean {
  const segs = Array.isArray(path) ? path : String(path).split(".");
  let cur: any = obj;
  for (const s of segs) {
    if (cur === null || cur === undefined) return false;
    if (typeof cur !== "object" && typeof cur !== "function") return false;
    if (!(s in cur)) return false;
    cur = cur[s as any];
  }
  return true;
}

function matcherName(stack: string): string {
  return stack;
}

export interface Assertion {
  readonly not: Assertion;
  toBe(expected: unknown): void;
  toEqual(expected: unknown): void;
  toStrictEqual(expected: unknown): void;
  toContain(expected: unknown): void;
  toMatch(expected: string | RegExp): void;
  toBeTruthy(): void;
  toBeFalsy(): void;
  toBeNull(): void;
  toBeDefined(): void;
  toBeUndefined(): void;
  toBeGreaterThan(expected: number): void;
  toBeGreaterThanOrEqual(expected: number): void;
  toBeLessThan(expected: number): void;
  toBeLessThanOrEqual(expected: number): void;
  toHaveLength(expected: number): void;
  toHaveProperty(path: string | (string | number)[], value?: unknown): void;
  toBeInstanceOf(ctor: Function): void;
  toThrow(expected?: string | RegExp): void;
}

export function expect(actual: unknown, negate = false): Assertion {
  const check = (name: string, pass: boolean, detail: () => string) => {
    if (negate ? !pass : pass) return;
    const prefix = negate ? `.not.${name}` : `.${name}`;
    throw new AssertionError(`expect()${prefix} 失败\n${detail()}`);
  };
  const a = actual as any;

  const api: Assertion = {
    get not() {
      return expect(actual, !negate);
    },
    toBe(expected) {
      check("toBe", Object.is(actual, expected), () => `  实际: ${format(actual)}\n  期望: ${format(expected)}`);
    },
    toEqual(expected) {
      check("toEqual", deepEqual(actual, expected), () => `  实际: ${format(actual)}\n  期望: ${format(expected)}`);
    },
    toStrictEqual(expected) {
      check("toStrictEqual", deepEqual(actual, expected), () => `  实际: ${format(actual)}\n  期望: ${format(expected)}`);
    },
    toContain(expected) {
      if (isAsym(expected) && expected[ASYM] === "arrayContaining") {
        const want = expected.items ?? [];
        const has = (x: unknown) =>
          Array.isArray(actual) ? (actual as unknown[]).some((y) => Object.is(y, x) || deepEqual(y, x)) : false;
        const missing = want.filter((x) => !has(x));
        check("toContain(arrayContaining)", missing.length === 0, () => `  容器: ${format(actual)}\n  缺少: ${format(missing)}`);
        return;
      }
      if (isAsym(expected) && expected[ASYM] === "objectContaining") {
        const want = expected.obj ?? {};
        const missing = Object.keys(want).filter((k) => !deepEqual((actual as any)?.[k], want[k]));
        check("toContain(objectContaining)", missing.length === 0, () => `  实际: ${format(actual)}\n  不匹配字段: ${format(missing)}`);
        return;
      }
      let pass = false;
      if (typeof a === "string") pass = a.includes(String(expected));
      else if (Array.isArray(a)) pass = a.some((x) => Object.is(x, expected) || deepEqual(x, expected));
      else if (a instanceof Set) pass = a.has(expected);
      else if (a instanceof Map) pass = a.has(expected);
      else throw new AssertionError(`.toContain 只能用于 string/array/Set/Map，实际是 ${typeof a}`);
      check("toContain", pass, () => `  容器: ${format(actual)}\n  期望包含: ${format(expected)}`);
    },
    toMatch(expected) {
      const s = String(actual);
      const pass = typeof expected === "string" ? s.includes(expected) : expected.test(s);
      check("toMatch", pass, () => `  实际: ${format(actual)}\n  期望匹配: ${format(expected)}`);
    },
    toBeTruthy() {
      check("toBeTruthy", Boolean(actual), () => `  实际: ${format(actual)}`);
    },
    toBeFalsy() {
      check("toBeFalsy", !actual, () => `  实际: ${format(actual)}`);
    },
    toBeNull() {
      check("toBeNull", actual === null, () => `  实际: ${format(actual)}`);
    },
    toBeDefined() {
      check("toBeDefined", actual !== undefined, () => `  实际: ${format(actual)}`);
    },
    toBeUndefined() {
      check("toBeUndefined", actual === undefined, () => `  实际: ${format(actual)}`);
    },
    toBeGreaterThan(expected) {
      check("toBeGreaterThan", a > expected, () => `  实际: ${format(actual)}\n  期望 > ${format(expected)}`);
    },
    toBeGreaterThanOrEqual(expected) {
      check("toBeGreaterThanOrEqual", a >= expected, () => `  实际: ${format(actual)}\n  期望 >= ${format(expected)}`);
    },
    toBeLessThan(expected) {
      check("toBeLessThan", a < expected, () => `  实际: ${format(actual)}\n  期望 < ${format(expected)}`);
    },
    toBeLessThanOrEqual(expected) {
      check("toBeLessThanOrEqual", a <= expected, () => `  实际: ${format(actual)}\n  期望 <= ${format(expected)}`);
    },
    toHaveLength(expected) {
      const len = a?.length ?? a?.size;
      check("toHaveLength", len === expected, () => `  实际长度: ${format(len)}\n  期望: ${format(expected)}`);
    },
    toHaveProperty(path, value) {
      const pass = hasPath(actual, path);
      if (value !== undefined) {
        const segs = Array.isArray(path) ? path : String(path).split(".");
        let cur: any = actual;
        for (const s of segs) cur = cur?.[s as any];
        check("toHaveProperty", pass && deepEqual(cur, value), () => `  对象: ${format(actual)}\n  期望属性 ${format(path)} = ${format(value)}`);
        return;
      }
      check("toHaveProperty", pass, () => `  对象: ${format(actual)}\n  缺少属性: ${format(path)}`);
    },
    toBeInstanceOf(ctor) {
      check("toBeInstanceOf", actual instanceof ctor, () => `  实际: ${format(actual)}\n  期望实例: ${ctor?.name}`);
    },
    toThrow(expected) {
      if (typeof actual !== "function") throw new AssertionError(".toThrow 需要传入函数");
      let threw = false;
      let err: any;
      try {
        actual();
      } catch (e) {
        threw = true;
        err = e;
      }
      let pass = threw;
      if (threw && expected !== undefined) {
        const msg = String(err?.message ?? err);
        pass = typeof expected === "string" ? msg.includes(expected) : expected.test(msg);
      }
      check("toThrow", pass, () => (threw ? `  抛出: ${format(err)}` : "  未抛出异常"));
    },
  };
  return api;
}

expect.arrayContaining = arrayContaining;
expect.objectContaining = objectContaining;

export { AssertionError, arrayContaining, objectContaining };
export default expect;
