import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { FIXED_DELIVERY_ENDING, ARTICLE_STATUSES, assertArticleTransition } = await importTs(
  "packages/toutiao/src/domain/status.ts",
);
const { isAppError } = await importTs("packages/core/src/errors/index.ts");

const ROOT = process.cwd();
const BRIDGE_PY = path.join(ROOT, "packages/toutiao/skill/scripts/writer_bridge.py");
const QA_PY = path.join(ROOT, "packages/toutiao/skill/scripts/qa_check.py");

function runQa(filePath) {
  try {
    return JSON.parse(execFileSync("python3", [QA_PY, filePath, "--json"], { encoding: "utf8" }));
  } catch (err) {
    if (err.stdout) return JSON.parse(err.stdout.toString());
    throw err;
  }
}

test("toutiao fixed ending sentence and status state machine enforce transitions", () => {
  assert.equal(FIXED_DELIVERY_ENDING, "——AI 到此止步。是否采用、何时发布由你决定。");
  assert.deepEqual([...ARTICLE_STATUSES], ["初稿待改", "待验收", "已验收", "验收退回", "已交稿"]);

  assert.doesNotThrow(() => assertArticleTransition("初稿待改", "待验收"));
  assert.doesNotThrow(() => assertArticleTransition("待验收", "已验收"));
  assert.doesNotThrow(() => assertArticleTransition("已验收", "已交稿"));

  assert.throws(
    () => assertArticleTransition("初稿待改", "已交稿"),
    (err) => isAppError(err, "gate.denied"),
  );
  assert.throws(
    () => assertArticleTransition("已交稿", "初稿待改"),
    (err) => isAppError(err, "gate.denied"),
  );
});

test("toutiao writer_bridge limits and qa_check enforce 34-char title max", async () => {
  const limits = JSON.parse(execFileSync("python3", [BRIDGE_PY, "limits"], { encoding: "utf8" }));
  assert.equal(limits.ok, true);
  assert.equal(limits.title_max, 34);
  assert.equal(limits.pass_score, 84);

  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zhizhang-toutiao-"));
  try {
    const okTitle = "甲".repeat(34);
    const tooLongTitle = "甲".repeat(35);
    const body = "这事儿说白了很简单，邻居老周前两天去菜市场买菜，花了三十块钱买了两斤排骨。\n\n";

    const okFile = path.join(dir, "ok.md");
    await fs.writeFile(okFile, `# ${okTitle}\n\n${body}${FIXED_DELIVERY_ENDING}\n`, "utf8");
    const okQa = runQa(okFile);
    assert.ok(!okQa.hard_gates.some((g) => g.includes("标题超34字")));

    const badFile = path.join(dir, "bad.md");
    await fs.writeFile(badFile, `# ${tooLongTitle}\n\n${body}${FIXED_DELIVERY_ENDING}\n`, "utf8");
    const badQa = runQa(badFile);
    assert.ok(badQa.hard_gates.some((g) => g.includes("标题超34字")));
  } finally {
    await fs.rm(dir, { recursive: true, force: true });
  }
});
