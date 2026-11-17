import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { workspace, runPipeline, bible } from "../support/v14.mjs";
import { importTs } from "../support/ts-loader.mjs";
import { createFakeModelPort } from "../support/fake-port.mjs";
import { matchProposals } from "../support/proposal-match.mjs";
const importer = await importTs("packages/fanqie/src/import/index.ts"),
  { importPipeline } = await importTs("packages/fanqie/src/pipelines/import/index.ts"),
  { createModelGateway } = await importTs("packages/core/src/model/index.ts");
const calibrationSamples = [];
function materialize(items) {
  const names = new Map(
    items.flatMap(({ op }) =>
      op.type === "entity.upsert"
        ? [[op.entity.id, op.entity.name]]
        : op.type === "node.create"
          ? [[op.node.id, op.node.title]]
          : op.type === "thread.upsert"
            ? [[op.thread.id, op.thread.title]]
            : [],
    ),
  );
  return items
    .filter(
      (item) =>
        !item.notes.includes("import.unresolved_reference") &&
        !(item.op.type === "state.add" && item.op.entry.facet === "relation"),
    )
    .map((item) => {
      const op = item.op;
      let value;
      if (op.type === "node.create")
        value = {
          ...op.node,
          cast: op.node.cast?.map((id) => names.get(id)),
          pov: names.get(op.node.pov),
          location: names.get(op.node.location),
          plant: op.node.plant?.map((ref) => names.get(ref.thread)),
          pay: op.node.pay?.map((ref) => names.get(ref.thread)),
          type: op.level,
          parent: names.get(op.parent),
          order: op.index + 1,
        };
      if (op.type === "entity.upsert")
        value = {
          ...op.entity,
          type: "entity",
          parent: names.get(op.entity.parent),
          relations: items.flatMap(({ op: relation }) =>
            relation.type === "state.add" &&
            relation.entry.entity === op.entity.id &&
            relation.entry.facet === "relation"
              ? [{ to: names.get(relation.entry.target), label: relation.entry.value }]
              : [],
          ),
        };
      if (op.type === "state.add")
        value = {
          ...op.entry,
          type: "state",
          entity: names.get(op.entry.entity),
          target: names.get(op.entry.target),
        };
      if (op.type === "thread.upsert")
        value = {
          ...op.thread,
          type: "thread",
          plantAt: op.thread.plannedPlant,
          payAt: op.thread.plannedPayoff,
        };
      if (op.type === "timeline.upsert")
        value = {
          ...op.event,
          type: "timeline",
          entities: op.event.entities.map((id) => names.get(id)),
        };
      if (op.type === "knowledge.set")
        value = { ...op.row, type: "knowledge", holder: names.get(op.row.holder) };
      return { ...value, src: item.src, confidence: item.confidence };
    });
}
for (const name of ["s1-volumes", "s2-bible", "s3-mixed"])
  test(`原始 ${name} 样例 → 分块抽取、引用解析、提案匹配与整批撤销`, async (t) => {
    const env = await workspace(t),
      dir = path.resolve("test/fixtures/import", name),
      source = path.join(dir, name === "s2-bible" ? "source.md" : "source.txt"),
      expected = JSON.parse(await fs.readFile(path.join(dir, "expected.json"), "utf8")),
      response = JSON.parse(
        JSON.parse(await fs.readFile(path.join(dir, "responses/extract-1.json"), "utf8")).text,
      ),
      docmap = JSON.parse(await fs.readFile(path.join(dir, "responses/docmap.json"), "utf8"));
    const view = await importer.createImportStore(env.locks).stage(env.work, source);
    const segmented = await importer.readSegments(env.work, view.batch),
      allParas = segmented.segments.flatMap((s) => s.paras);
    const port = createFakeModelPort(
      (req) => {
        if (req.user.includes("【阶段】docmap")) return docmap;
        const input = JSON.parse(req.user.slice(0, req.user.indexOf("\n\nJSON:"))),
          paras = [...input.text.matchAll(/\[(P[^\]]+)\]/gu)].map((m) => m[1]);
        return {
          text: JSON.stringify({
            items: response.items.flatMap((item) => {
              const found = segmented.text.indexOf(item.quote);
              const para =
                found >= 0
                  ? allParas.find((p) => p.start <= found && p.end >= found + item.quote.length)
                  : (allParas.find((p) => item.src.includes(p.id)) ?? allParas[0]);
              return para && paras.includes(para.id) ? [{ ...item, src: [para.id] }] : [];
            }),
            unassigned: response.unassigned,
          }),
        };
      },
      { repeatLast: true },
    );
    const gateway = createModelGateway(
        port,
        {
          globalConcurrency: 4,
          perRunConcurrency: 3,
          roles: Object.fromEntries(
            ["planner", "extractor", "judge"].map((role) => [
              role,
              { connection: "fake", model: "fake" },
            ]),
          ),
        },
        env.clock,
      ),
      request = {
        batch: view.batch,
        sections: view.segments.filter((s) => s.selected).map((s) => s.id),
        estimate: { inputMax: 1000000, outputMax: 100000 },
      };
    const run = await runPipeline(
      importPipeline,
      await importPipeline.context({ mode: "fanqie", path: env.work }, request),
      gateway,
      env.clock,
    );
    assert.equal(run.state, "awaiting-author", JSON.stringify(run));
    const batch = await env.library.readPendingBatch(env.work, view.batch),
      report = matchProposals(expected, materialize(batch.items));
    assert.ok(report.passed, JSON.stringify(report, null, 2));
    const actual = materialize(batch.items),
      matched = new Set(report.matches.map((pair) => pair.actualIndex));
    actual.forEach((row, index) => {
      if (row.confidence)
        calibrationSamples.push({
          parts: row.confidence.parts,
          correct: matched.has(index) && row.src?.some((ref) => ref.located !== false),
        });
    });
    assert.equal((await env.library.read(env.work)).entities.length, 0);
    await env.library.decide(
      env.work,
      batch.id,
      batch.items.map((item) => ({ id: item.id, decision: "accept" })),
    );
    const result = await env.library.commit(
      env.work,
      batch.id,
      (await bible.readBibleIndex(env.work)).files,
    );
    assert.equal(result.stale.length, 0);
    const commitsBeforeRetry = (await env.library.readPendingBatch(env.work, batch.id)).commits;
    const repeated = await env.library.commit(
      env.work,
      batch.id,
      (await bible.readBibleIndex(env.work)).files,
    );
    assert.equal(repeated.committed, 0);
    assert.equal(repeated.changeId, result.changeId);
    assert.deepEqual(
      (await env.library.readPendingBatch(env.work, batch.id)).commits,
      commitsBeforeRetry,
    );
    assert.deepEqual((await env.library.revert(env.work, result.changeId)).skipped, []);
    assert.equal((await env.library.read(env.work)).entities.length, 0);
    assert.equal((await env.store.get(env.work)).nodes.length, 0);
  });

test("三份原始样例的人工期望标注 → 网格校准达到高档精确率门槛", () => {
  const report = importer.calibrateConfidence(calibrationSamples);
  assert.ok(calibrationSamples.length >= 100);
  assert.ok(report.precision >= 0.95);
  assert.ok(report.accepted > 0);
  console.info(
    "CONFIDENCE_CALIBRATION",
    JSON.stringify({
      samples: calibrationSamples.length,
      negative: calibrationSamples.filter((sample) => !sample.correct).length,
      ...report,
    }),
  );
});
