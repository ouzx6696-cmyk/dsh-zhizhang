import path from "node:path";
import { emptyUsage } from "../../../../packages/core/src/workflow";
import { sha256 } from "../../../../packages/core/src/fsx";
import { createGateEngine } from "../../../../packages/core/src/gates";
import { executeTool } from "../../../../packages/core/src/execute";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { createToutiaoTools } from "../../../../packages/toutiao/src/tools";
import { toutiaoGateRules } from "../../../../packages/toutiao/src/gates";
import { draft, record, normalizeDraft, type Draft } from "./schema";
import type { stageCard } from "./methods";
import type { editDraft } from "./editor";
import type { WorkflowRun } from "./run";

type Checked = Awaited<ReturnType<typeof editDraft>>;
type StageMethod = Awaited<ReturnType<typeof stageCard>>;

export async function productionQa(
  run: WorkflowRun,
  store: ArticleStore,
  id: string,
  card: Record<string, unknown>,
  value: Draft,
) {
  await store.writeCard(id, card);
  await store.update(id, (meta) => {
    meta.headlines = {
      main: value.title,
      alts: Array.isArray(card["备选标题"])
        ? card["备选标题"].filter((value): value is string => typeof value === "string")
        : [],
    };
  });
  const meta = await store.get(id),
    cur = store.currentDraft(meta);
  if (!cur || cur.sha256 !== sha256(value.body))
    await store.stageDraft(id, value.body, "editor", "流水线工作稿");
  const config = { ...run.host.options.toutiao, storageRoot: store.root, python: run.host.python },
    gates = createGateEngine(toutiaoGateRules(config));
  const definitions = await createToutiaoTools({ config, role: "editor", gates: () => gates });
  const tool = definitions.find((tool) => tool.name === "toutiao_qa_check");
  if (!tool) throw new Error("文章质检工具不可用");
  const args = { id };
  const result = await executeTool(
    tool,
    args,
    { cwd: store.root, role: "editor", name: tool.name, arguments: args, signal: run.signal },
    { gates, bind: (execute) => execute(), confirm: () => Promise.resolve(false) },
  );
  return record(result.value);
}

/**
 * 质检硬闸：在流水线工作库里跑现有 QA，未过则按报告精修，最多两轮。
 * 返回过闸后的稿件与工作库文章 id；两轮仍不过时抛错，工作稿与报告保留。
 */
export async function qaGate(
  run: WorkflowRun,
  card: Record<string, unknown>,
  titles: string[],
  start: Checked,
  writing: StageMethod,
  sourceRef: { attribution: string; text: string },
  material: WorkflowRun["context"]["material"],
) {
  const request = run.journal.record.request;
  let checked = start;
  const working = new ArticleStore(
    path.join(run.host.home, "workflow-working", run.journal.record.id),
  );
  let workingMeta;
  const all = await working.list();
  if (all.length) workingMeta = all[0];
  else
    workingMeta = await working.create("working", {
      line: request.line === "story" ? "故事线" : "资讯线",
      genre: String(card["体裁"]),
    });
  for (let round = 0; round <= 2; round++) {
    const qa = await run.journal.step(
      `qa-${round}`,
      "质检硬闸",
      { parse: record },
      async () => ({
        value: await productionQa(
          run,
          working,
          workingMeta.id,
          {
            ...card,
            主标题: checked.draft.title,
            备选标题: titles.filter((title) => title !== checked.draft.title).slice(0, 4),
          },
          checked.draft,
        ),
        usage: emptyUsage(),
      }),
      run.signal,
      0,
    );
    if (qa.pass === true) break;
    if (round === 2) throw new Error("文章两轮精修后仍未通过现有质检硬闸，工作稿与报告已保留");
    const refined = await run.model(
      `qa-revise-${round}`,
      "按质检精修",
      "writer",
      writing,
      { draft: checked.draft, qa, source: sourceRef },
      '只处理给定质检失败与对应段落，禁止堆数字和口语词刷分，不得新增来源中没有的事实、数字或引语；返回 {"title":"标题","body":"完整正文"}。',
      draft,
      { material },
    );
    refined.body = normalizeDraft(refined.body);
    checked = { ...checked, draft: refined };
  }
  return { checked, workingId: workingMeta.id };
}
