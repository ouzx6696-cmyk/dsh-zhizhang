import { asObject, asString, asStringArray } from "../../parse.js";
import { NovelError } from "../../errors.js";
import type { StageCardInput, MechanismInput, CardEvidence } from "./types.js";
function objects(value: unknown, label: string): Record<string, unknown>[] | undefined {
  if (value === undefined) return undefined;
  if (!Array.isArray(value)) throw new NovelError("bad_args", `${label} 必须是对象数组`);
  return value.map((item) => asObject(item, label));
}
function fields<K extends string>(
  value: unknown,
  keys: readonly K[],
): Partial<Record<K, string>> | undefined {
  if (value === undefined) return undefined;
  const raw = asObject(value),
    out: Partial<Record<K, string>> = {};
  for (const key of keys) {
    const v = asString(raw, key);
    if (v !== undefined) out[key] = v;
  }
  return out;
}
export function parseStageCardArgs(args: Record<string, unknown>): StageCardInput {
  const mechanisms: MechanismInput[] = (objects(args.mechanisms, "mechanisms") ?? []).map(
    (item) => ({
      name: asString(item, "name", { required: true }),
      failWhen: asString(item, "failWhen", { required: true }),
      experience: asString(item, "experience"),
      rebuild: asString(item, "rebuild"),
      discard: asString(item, "discard"),
    }),
  );
  const evidence: CardEvidence[] | undefined = objects(args.evidence, "evidence")?.map((item) => {
    const chapter =
      typeof item.chapter === "number" && Number.isFinite(item.chapter)
        ? item.chapter
        : asString(item, "chapter", { required: true });
    return { ...item, chapter, quote: asString(item, "quote", { required: true }) };
  });
  return {
    title: asString(args, "title", { required: true }),
    sourceId: asString(args, "source", { required: true }),
    body: asString(args, "body", { required: true, trim: false }),
    mechanisms,
    readingRange: asString(args, "reading_range"),
    axis: asString(args, "axis"),
    kind: asString(args, "kind"),
    tags: asStringArray(args, "tags"),
    humanFeel: fields(args.human_feel, [
      "writerCraft",
      "craftRange",
      "characterState",
      "stateOnPage",
      "allowedEdges",
      "failAsTemplate",
      "voice",
      "voiceRange",
      "realness",
    ]),
    bookCraft: fields(args.book_craft, ["continueWhy", "adjacentChange", "failAsShortStory"]),
    mind: fields(args.mind, [
      "sellIntoCost",
      "infoStaging",
      "pressureMachine",
      "debtAndSwap",
      "readerContract",
      "failAsEncyclopedia",
    ]),
    handoff: fields(args.handoff, ["purpose", "experience", "rebuild", "discard"]),
    layer: asString(args, "layer"),
    dimension: asString(args, "dimension"),
    readerWant: asString(args, "readerWant"),
    emotionArc: asString(args, "emotionArc"),
    dramaticUnit: asString(args, "dramaticUnit"),
    transfer: asString(args, "transfer"),
    failWhen: asString(args, "failWhen"),
    replaceables: asStringArray(args, "replaceables"),
    mustNotCopy: asStringArray(args, "mustNotCopy"),
    steps: asStringArray(args, "steps"),
    bannedDiction: asStringArray(args, "bannedDiction"),
    evidence,
  };
}

export function parseSourceMeta(value: unknown, id: string): import("./types.js").SourceMeta {
  const raw = asObject(value, "书源元数据");
  if (raw.id !== id) throw new NovelError("bad_source", "书源元数据 id 不一致");
  const title = asString(raw, "title", { required: true, trim: false });
  for (const key of ["author", "createdAt", "updatedAt", "readingRange", "excerptPath", "encoding"])
    if (raw[key] !== undefined && typeof raw[key] !== "string")
      throw new NovelError("bad_source", `书源 ${key} 必须是字符串`);
  if (
    raw.charCount !== undefined &&
    (typeof raw.charCount !== "number" || !Number.isFinite(raw.charCount))
  )
    throw new NovelError("bad_source", "书源 charCount 必须是数字");
  return { ...raw, id, title };
}
