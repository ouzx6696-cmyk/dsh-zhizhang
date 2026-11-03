/** Skill 第二、三级：按步骤取方法文件、按需取语料。只读插件自带的 skill 目录。 */
import path from "node:path";
import { WriterError } from "../../core/src/tool.js";
import { readText, resolveInside } from "../../core/src/fsx.js";
import type { MethodLibrary } from "../../core/src/profiles.js";

export const METHOD_FILES: Record<string, string> = {
  overview: "SKILL.md",
  "s1-hot": "references/s1-hot.md",
  "s1-evergreen": "references/s1-evergreen.md",
  "s2-selection": "references/s2-selection.md",
  "s3-headline": "references/s3-headline.md",
  "s4-common": "references/s4-common.md",
  "s4-news": "references/s4-news.md",
  "s4-story": "references/s4-story.md",
  "s4-micro": "references/s4-micro.md",
  "s5-editing": "references/s5-editing.md",
  "s6-qa": "references/s6-qa.md",
  "s7-delivery": "references/s7-delivery.md",
  "template-card": "templates/brief.json",
  "template-delivery": "templates/交稿单-图文.md",
  "corpus-common": "corpus/common.md",
  "corpus-benchmark": "corpus/benchmark.md",
  "corpus-story-motifs": "corpus/story/motifs.md",
  "corpus-story-texture": "corpus/story/texture.md",
  "corpus-民生社保": "corpus/01-民生社保.md",
  "corpus-职场就业": "corpus/02-职场就业.md",
  "corpus-房产楼市": "corpus/03-房产楼市.md",
  "corpus-教育升学": "corpus/04-教育升学.md",
  "corpus-健康养老": "corpus/05-健康养老.md",
  "corpus-三农乡土": "corpus/06-三农乡土.md",
  "corpus-情感家庭": "corpus/07-情感家庭.md",
  "corpus-财经理财": "corpus/08-财经理财.md",
  "corpus-汽车出行": "corpus/09-汽车出行.md",
  "corpus-科技数码": "corpus/10-科技数码.md",
  "corpus-社会观察": "corpus/11-社会观察.md",
  "corpus-文旅消费": "corpus/12-文旅消费.md",
};

function assetDirectory(variable: string): string {
  const directory = process.env[variable];
  if (!directory || !path.isAbsolute(directory))
    throw new WriterError("NOT_FOUND", `未配置资产目录：${variable}`);
  return directory;
}
function skillDir() {
  return assetDirectory("WRITER_TOUTIAO_SKILL_DIR");
}

export function bridgeScript(): string {
  return path.join(skillDir(), "scripts", "writer_bridge.py");
}

function toutiaoDefaultDir() {
  return assetDirectory("WRITER_TOUTIAO_DEFAULT_DIR");
}

interface DefaultIndex {
  methods: { id: string; title?: string }[];
}
let defaultIndex: DefaultIndex | undefined;
async function loadDefaultIndex(): Promise<DefaultIndex> {
  if (defaultIndex) return defaultIndex;
  const raw = await readText(path.join(toutiaoDefaultDir(), "profile.json"));
  if (raw === undefined) throw new WriterError("NOT_FOUND", "默认方法目录缺少 profile.json");
  const parsed: unknown = JSON.parse(raw);
  if (
    !parsed ||
    typeof parsed !== "object" ||
    !("methods" in parsed) ||
    !Array.isArray(parsed.methods) ||
    parsed.methods.some(
      (row: unknown) =>
        !row || typeof row !== "object" || !("id" in row) || typeof row.id !== "string",
    )
  )
    throw new WriterError("CONFLICT", "默认方法目录损坏");
  defaultIndex = parsed as DefaultIndex;
  return defaultIndex;
}

export const toutiaoLibrary: MethodLibrary = {
  mode: "toutiao",
  async defaultIds() {
    return (await loadDefaultIndex()).methods.map((m) => ({ id: m.id, title: m.title }));
  },
  async originalIds() {
    return Object.keys(METHOD_FILES);
  },
  async readDefault(id) {
    const entry = (await loadDefaultIndex()).methods.find((m) => m.id === id);
    if (!entry) return undefined;
    const text = await readText(resolveInside(toutiaoDefaultDir(), `${id}.md`));
    return text === undefined ? undefined : { id, text, file: `默认/${id}.md`, title: entry.title };
  },
  async readOriginal(id) {
    const rel = METHOD_FILES[id];
    if (!rel) return undefined;
    const text = await readText(path.join(skillDir(), rel));
    return text === undefined ? undefined : { id, text, file: rel };
  },
  canonical: (id) => id,
};
