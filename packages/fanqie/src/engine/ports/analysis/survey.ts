/** L0 测绘缓存 — 与事实层联动，事实变了就重建。 */
import { atomicWrite } from "../../storage/primitives.js";
import { buildSurvey } from "../survey.js";
import type { ChapterIndexRow, SurveyReport } from "../survey.js";
import { analysisPaths, ensureDir, readJson } from "./paths.js";
import type { StoragePaths } from "../../types.js";
import type { ChapterFact } from "./types.js";

export async function readSurvey(paths: StoragePaths, sourceId: string) {
  const p = analysisPaths(paths, sourceId);
  return (await readJson<SurveyReport | null>(p.survey, null)) ?? null;
}

async function writeSurvey(paths: StoragePaths, sourceId: string, survey: SurveyReport) {
  const p = analysisPaths(paths, sourceId);
  await ensureDir(p.dir);
  await atomicWrite(p.survey, `${JSON.stringify(survey, null, 2)}\n`);
  return survey;
}

function factsKey(facts: { n: number; updatedAt?: string }[]) {
  return facts.map((f) => `${f.n}:${f.updatedAt ?? ""}`).join("|");
}

/** 没有测绘、或事实层变了，就补/重建一次。 */
export async function ensureSurvey(
  paths: StoragePaths,
  sourceId: string,
  sourceText: string,
  facts: ChapterFact[] = [],
  index: ChapterIndexRow[],
) {
  const old = await readSurvey(paths, sourceId);
  const key = factsKey(facts);
  if (
    old &&
    old.schemaVersion === 2 &&
    Array.isArray(old.volumes) &&
    old.factsKey === key &&
    old.factsCount === facts.length
  )
    return old;
  const survey = buildSurvey(sourceText, index, { facts });
  survey.factsCount = facts.length;
  survey.factsKey = key;
  await writeSurvey(paths, sourceId, survey);
  return survey;
}
