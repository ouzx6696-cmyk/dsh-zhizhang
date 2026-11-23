import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors/app-error.js";
import { sha256 } from "../fs/hash.js";
import { arr, int, obj, opt, record, str, type Parser } from "../schema/parse.js";
import type { Profile, StageMap, StageTakeRule } from "./stage-map.js";

export interface ProfileRoots {
  builtinDir: string;
  userDir?: string;
}

const WhenValueSchema: Parser<string | readonly string[]> = (v, p = "$") => {
  if (typeof v === "string") return v;
  return arr(str())(v, p);
};

const StageTakeRuleSchema: Parser<StageTakeRule> = obj({
  file: str({ min: 1 }),
  sections: opt(arr(str())),
  maxChars: opt(int({ min: 1 })),
  when: opt(record(WhenValueSchema)),
});

const StageMapSchema: Parser<StageMap> = record(obj({ take: arr(StageTakeRuleSchema) }));
const ProfileMetaSchema = obj({ name: opt(str()) }, { strict: false });

function parseProfileJson<T>(
  content: string,
  parser: (v: unknown, p?: string) => T,
  file: string,
): T {
  try {
    return parser(JSON.parse(content), file);
  } catch {
    throw new AppError("storage.format_unsupported", `无法解析方法方案文件：${file}`, { file });
  }
}

export async function loadProfile(mode: string, id: string, roots: ProfileRoots): Promise<Profile> {
  const candidates = [
    roots.userDir ? path.join(roots.userDir, mode, id) : undefined,
    path.join(roots.builtinDir, id),
  ].filter((x): x is string => Boolean(x));

  let dir: string | undefined;
  for (const c of candidates) {
    const stat = await fs.stat(c).catch(() => undefined);
    if (stat?.isDirectory()) {
      dir = c;
      break;
    }
  }
  if (!dir) {
    throw new AppError("input.not_found", `Profile not found: ${mode}/${id}`, { mode, id });
  }

  const entries = await fs.readdir(dir, { withFileTypes: true });
  const files: Record<string, string> = {};
  let stageMap: StageMap = {};
  let name = id;

  for (const entry of entries) {
    if (!entry.isFile()) continue;
    const full = path.join(dir, entry.name);
    const content = await fs.readFile(full, "utf8");
    if (entry.name === "stage-map.json") {
      stageMap = parseProfileJson(content, StageMapSchema, full);
    } else if (entry.name === "profile.json") {
      const meta = parseProfileJson(content, ProfileMetaSchema, full);
      if (meta.name) name = meta.name;
    } else if (entry.name.endsWith(".md")) {
      files[entry.name] = content;
    }
  }

  const hash = sha256(JSON.stringify({ files, stageMap }));
  return { id, name, mode, files, stageMap, hash };
}
