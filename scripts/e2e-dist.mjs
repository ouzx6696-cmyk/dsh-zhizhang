/**
 * Drive store APIs from built dist/ against a real .zhizhang root (no model).
 */
import { mkdir, readFile, rm, access } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  acceptCandidate,
  appendLedger,
  assembleManuscript,
  buildPanelSnapshot,
  createWork,
  ensureStorage,
  readChapter,
  readLedger,
  saveChapter,
  setFoundation,
  setOutline,
  markCandidateLinted,
  stageCandidate,
} from "../dist/lib/store.js";
import { lintStyle } from "../dist/lib/style-linter.js";
import { ZhizhangError } from "../dist/lib/errors.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, "../.zhizhang-e2e-qa");
await rm(root, { recursive: true, force: true });
await mkdir(root, { recursive: true });

const exec = { agent: { session: { header: { cwd: root }, id: "qa-e2e" } } };
const paths = await ensureStorage(exec, { rootDir: ".zhizhang" });
console.log("storage base:", paths.base);

const { meta, dir } = await createWork(paths, {
  title: "QA验证铺",
  genre: "奇幻",
  premise: "功能验收",
});
await setFoundation(dir, { locks: "不得直写 chapters", happened: "已建仓" });
await setOutline(dir, "c001", {
  situationLens: "验收视角",
  livedScene: "工具链走通",
  stateLens: "克制、算账中",
  pov: "作者限知",
});
await saveChapter(dir, {
  id: "c001",
  title: "验收章",
  body: "雨还没落。沈砚拨短灯芯。",
  status: "drafted",
});

const hits = lintStyle("他不是害怕，而是在衡量。嘴角勾起一抹冷笑。");
await appendLedger(dir, {
  chapterId: "c001",
  kind: "style_lint",
  summary: `雷达 ${hits.length}`,
  styleHitCount: hits.length,
});

const cand = await stageCandidate(dir, {
  chapterId: "c001",
  body: "雨还没落。沈砚拨短灯芯。巷口有人停步。",
});
const lintPass = await markCandidateLinted(dir, cand.id, 0);
const accepted = await acceptCandidate(dir, cand.id, "replace", {
  lintPassToken: lintPass.token,
});

await appendLedger(dir, {
  chapterId: "c001",
  kind: "author_checks",
  summary: "四维通过",
  dims: {
    locks_ledger: true,
    pov_situation: true,
    style_radar: true,
    continuity_snap: true,
  },
});
await saveChapter(dir, {
  id: "c001",
  title: "验收章",
  body: accepted.body,
  status: "final",
});

const snap = await buildPanelSnapshot(dir);
const assembled = await assembleManuscript(dir, paths, { onlyFinal: true });
const ledger = await readLedger(dir);

// Negatives
let neg = [];
try {
  await stageCandidate(dir, { chapterId: "c001", body: "  " });
  neg.push("empty stage should throw");
} catch (e) {
  if (!(e instanceof ZhizhangError) || e.code !== "candidate_empty") neg.push("empty stage wrong code");
}
try {
  await acceptCandidate(dir, cand.id, "replace");
  neg.push("double accept should throw");
} catch (e) {
  if (!(e instanceof ZhizhangError) || e.code !== "candidate_already_accepted") neg.push("double accept wrong code");
}
const cand2 = await stageCandidate(dir, { chapterId: "c001", body: "试图改 final" });
await markCandidateLinted(dir, cand2.id, 0);
try {
  await acceptCandidate(dir, cand2.id, "replace");
  neg.push("final overwrite should throw");
} catch (e) {
  if (!(e instanceof ZhizhangError) || e.code !== "refuse_overwrite_final") neg.push("final refuse wrong code");
}
const cand3 = await stageCandidate(dir, { chapterId: "c001", body: "未 lint 不可采纳" });
try {
  await acceptCandidate(dir, cand3.id, "replace");
  neg.push("lint_required should throw");
} catch (e) {
  if (!(e instanceof ZhizhangError) || e.code !== "lint_required") neg.push("lint_required wrong code");
}

const checks = {
  workKey: meta.key,
  chapterFile: path.join(dir, "chapters", "c001.md"),
  candJson: path.join(dir, "candidates", `${cand.id}.json`),
  manuscript: assembled.file,
  panelFinal: snap.totals.final,
  ledgerEntries: ledger.entries.length,
  body: (await readChapter(dir, "c001")).body,
  negativesOk: neg.length === 0,
  neg,
};
for (const p of [checks.chapterFile, checks.candJson, checks.manuscript]) {
  await access(p);
}
console.log(JSON.stringify(checks, null, 2));
if (!checks.negativesOk || checks.panelFinal !== 1 || !checks.body.includes("巷口")) {
  process.exit(1);
}
console.log("E2E_DIST_OK");
