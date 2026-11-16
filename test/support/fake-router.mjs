import { access, readFile } from "node:fs/promises";
import path from "node:path";

function lastUserText(body) {
  const users = (body?.messages ?? []).filter((message) => message.role === "user");
  const content = users.at(-1)?.content;
  if (typeof content === "string") return content;
  return (content ?? []).map((part) => part.text ?? "").join("");
}

export function resolveFakeRoute(user) {
  const stage = user.match(/【阶段】\s*([a-z][a-z0-9-]*)/u)?.[1];
  if (!stage) throw new Error("FakeRouter: missing 【阶段】 marker");
  const block = user.match(/第\s*(\d+)\s*\/\s*\d+\s*块/u)?.[1];
  const group = user.match(/第\s*(\d+)\s*组/u)?.[1];
  const suffix = block ?? group;
  return {
    stage,
    index: suffix ? Number(suffix) : undefined,
    stem: `${stage}${suffix ? `-${suffix}` : ""}`,
  };
}

async function exists(file) {
  try {
    await access(file);
    return true;
  } catch {
    return false;
  }
}

async function readSpec(dir, stem, call) {
  const base = path.join(dir, "responses", stem);
  const sequenced = await exists(`${base}.1.json`);
  const file = sequenced ? `${base}.${call}.json` : `${base}.json`;
  let spec;
  try {
    spec = JSON.parse(await readFile(file, "utf8"));
  } catch (error) {
    if (error?.code === "ENOENT")
      throw new Error(`FakeRouter: no response for ${stem} call #${call}`);
    throw new Error(`FakeRouter: invalid JSON in ${path.basename(file)}`, { cause: error });
  }
  const hasText = typeof spec?.text === "string";
  const hasError = typeof spec?.error?.code === "string";
  if (hasText === hasError) {
    throw new Error(`FakeRouter: ${path.basename(file)} needs exactly one of text or error.code`);
  }
  return spec;
}

function desktopStatus(code) {
  if (code === "model.rate_limited") return 429;
  if (code === "model.unauthorized" || code === "model.forbidden") return 401;
  return 500;
}

/**
 * Engine: createFakeModelPort(createFakeRouter(fixtureDir)).
 * Desktop: fakeModel(createFakeRouter(fixtureDir).respond).
 * Static responses repeat; .1.json / .2.json responses advance per route key.
 */
export function createFakeRouter(dir) {
  const counts = new Map();
  const calls = [];
  async function route(user) {
    const { stem } = resolveFakeRoute(user);
    const call = (counts.get(stem) ?? 0) + 1;
    counts.set(stem, call);
    return readSpec(dir, stem, call);
  }
  const router = async (req) => {
    calls.push(req);
    return route(req.user ?? "");
  };
  router.respond = async (body, lastUser = lastUserText(body)) => {
    calls.push(body);
    const spec = await route(lastUser);
    if (spec.error) return { status: desktopStatus(spec.error.code), error: spec.error.code };
    return spec;
  };
  router.calls = calls;
  return router;
}
