import { AppError } from "../errors/app-error.js";
function fail(path, msg) {
    throw new AppError("input.invalid", `${path}: ${msg}`, { path });
}
export function str(opts) {
    return (v, path = "$") => {
        if (typeof v !== "string")
            fail(path, "expected string");
        const s = opts?.trim ? v.trim() : v;
        if (opts?.min !== undefined && s.length < opts.min)
            fail(path, `min length ${opts.min}`);
        if (opts?.max !== undefined && s.length > opts.max)
            fail(path, `max length ${opts.max}`);
        return s;
    };
}
export function int(opts) {
    return (v, path = "$") => {
        if (typeof v !== "number" || !Number.isInteger(v))
            fail(path, "expected integer");
        if (opts?.min !== undefined && v < opts.min)
            fail(path, `min ${opts.min}`);
        if (opts?.max !== undefined && v > opts.max)
            fail(path, `max ${opts.max}`);
        return v;
    };
}
export function num(opts) {
    return (v, path = "$") => {
        if (typeof v !== "number" || !Number.isFinite(v))
            fail(path, "expected finite number");
        if (opts?.min !== undefined && v < opts.min)
            fail(path, `min ${opts.min}`);
        if (opts?.max !== undefined && v > opts.max)
            fail(path, `max ${opts.max}`);
        return v;
    };
}
export const bool = (v, path = "$") => {
    if (typeof v !== "boolean")
        fail(path, "expected boolean");
    return v;
};
export function lit(...values) {
    return (v, path = "$") => {
        if (typeof v !== "string" || !values.includes(v)) {
            fail(path, `expected one of ${values.join("|")}`);
        }
        return v;
    };
}
export function arr(item, opts) {
    return (v, path = "$") => {
        if (!Array.isArray(v))
            fail(path, "expected array");
        if (opts?.max !== undefined && v.length > opts.max)
            fail(path, `max items ${opts.max}`);
        return v.map((el, idx) => item(el, `${path}[${idx}]`));
    };
}
export function obj(shape, opts = { strict: true }) {
    return (v, path = "$") => {
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
            fail(path, "expected object");
        }
        const raw = v;
        if (opts.strict !== false) {
            for (const key of Object.keys(raw)) {
                if (!(key in shape)) {
                    fail(`${path}.${key}`, `unknown key "${key}"`);
                }
            }
        }
        const out = {};
        for (const [key, parser] of Object.entries(shape)) {
            out[key] = parser(raw[key], `${path}.${key}`);
        }
        return out;
    };
}
export function opt(parser) {
    return (v, path = "$") => (v === undefined ? undefined : parser(v, path));
}
export function record(valParser) {
    return (v, path = "$") => {
        if (typeof v !== "object" || v === null || Array.isArray(v)) {
            fail(path, "expected record");
        }
        const out = {};
        for (const [k, val] of Object.entries(v)) {
            out[k] = valParser(val, `${path}.${k}`);
        }
        return out;
    };
}
