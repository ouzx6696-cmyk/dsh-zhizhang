/** L0 测绘缓存 — 与事实层联动，事实变了就重建。 */
import { atomicWrite } from "../../store.js";
import { buildSurvey } from "../survey.js";
import { analysisPaths, ensureDir, readJson } from "./paths.js";
export async function readSurvey(paths, sourceId) {
    const p = analysisPaths(paths, sourceId);
    return (await readJson(p.survey, null)) ?? null;
}
export async function writeSurvey(paths, sourceId, survey) {
    const p = analysisPaths(paths, sourceId);
    await ensureDir(p.dir);
    await atomicWrite(p.survey, `${JSON.stringify(survey, null, 2)}\n`);
    return survey;
}
function factsKey(facts) {
    return (facts ?? []).map((f) => `${f.n}:${f.updatedAt ?? ""}`).join("|");
}
/** 没有测绘、或事实层变了，就补/重建一次。 */
export async function ensureSurvey(paths, sourceId, sourceText, facts = [], index) {
    const old = await readSurvey(paths, sourceId);
    const key = factsKey(facts);
    if (old
        && old.schemaVersion === 2
        && Array.isArray(old.volumes)
        && old.factsKey === key
        && old.factsCount === facts.length)
        return old;
    const survey = buildSurvey(sourceText, index, { facts });
    survey.factsCount = facts.length;
    survey.factsKey = key;
    await writeSurvey(paths, sourceId, survey);
    return survey;
}
