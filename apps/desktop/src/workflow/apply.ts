import path from "node:path";
import { readFile } from "node:fs/promises";
import { atomicWrite, readText, readJson, nowIso, sha256 } from "../../../../packages/core/src/fsx";
import { resolveFanqieWork } from "../main/storage";
import {
  readWorkMeta,
  parseWorkMeta,
} from "../../../../packages/fanqie/src/engine/storage/work-meta";
import { findChapter, setOutline } from "../../../../packages/fanqie/src/engine/storage/chapters";
import { setFoundation } from "../../../../packages/fanqie/src/engine/work-store";
import { withResourceLock } from "../../../../packages/fanqie/src/engine/storage/process-lock";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { record, text, list, outline } from "./schema";
import { productionQa } from "./article";
import { workflowContext } from "./context";
import { WorkflowRun } from "./run";
import {
  WorkflowJournal,
  DEFAULT_ENGINE,
  type WorkflowRecord,
} from "../../../../packages/core/src/workflow";
import type { Target } from "../context";
import type { Sessions } from "../session/manager";
const foundationKeys = [
  "locks",
  "happened",
  "characters",
  "readerKnowledge",
  "planned",
  "threads",
  "style",
] as const;

export async function applyPlan(
  host: Sessions,
  target: Target,
  state: WorkflowRecord,
  output: Record<string, unknown>,
) {
  const dir = await resolveFanqieWork(host.options, target);
  return withResourceLock(dir, async () => {
    const receipt = path.join(dir, "writer-plan-receipts", state.id + ".json"),
      done = await readJson<unknown>(receipt);
    if (done !== undefined) return done;
    const foundation = record(output.foundation),
      chapters = list(output.chapters, "滚动章纲", 5).map((value) => {
        const r = record(value);
        return { id: text(r.id, "章节标识", 64), ...outline(r) };
      });
    for (const key of foundationKeys) text(foundation[key], key, 10000);
    const backup = path.join(dir, "writer-migration-backups", state.id + ".json"),
      previous = await readText(backup);
    if (previous === undefined) {
      const context = await workflowContext(host, target, state.request);
      if (context.sourceHash !== state.sourceHash)
        throw new Error("作品已变化，旧规划不会覆盖作者修改；请重新规划");
      await atomicWrite(backup, await readFile(path.join(dir, "meta.json"), "utf8"));
    }
    const original = parseWorkMeta(JSON.parse((await readText(backup)) ?? "null"), backup),
      old = original.foundation,
      current = await readWorkMeta(dir);
    for (const key of foundationKeys)
      if (current.foundation[key] !== old[key] && current.foundation[key] !== foundation[key])
        throw new Error("采用规划中断后根基又被修改，已保留备份；不会覆盖作者修改");
    if (JSON.stringify(current.planning) !== JSON.stringify(original.planning))
      throw new Error("卷幕规划已变化，未覆盖");
    const originalIds = new Set(
      list(original.chapters, "旧章节", 10000).map((value) =>
        text(record(value).id, "章节标识", 64),
      ),
    );
    for (const row of chapters) {
      const existing = await findChapter(dir, row.id);
      if (
        existing &&
        !originalIds.has(row.id) &&
        (existing.body.trim() ||
          Object.entries(outline({ ...existing.outline, title: existing.title })).some(
            ([key, value]) => JSON.stringify(value) !== JSON.stringify(Reflect.get(row, key)),
          ))
      )
        throw new Error("规划中断后新增章节已被修改，未覆盖");
    }
    if (foundationKeys.some((key) => current.foundation[key] !== foundation[key]))
      await setFoundation(dir, foundation);
    for (const row of chapters)
      if (!(await findChapter(dir, row.id))) await setOutline(dir, row.id, { ...row }, row.title);
    const value = { at: nowIso(), backup, chapters: chapters.map((row) => row.id) };
    await atomicWrite(receipt, JSON.stringify(value));
    return value;
  });
}
export async function applyArticle(
  host: Sessions,
  target: Target,
  state: WorkflowRecord,
  output: Record<string, unknown>,
  journal: WorkflowJournal,
) {
  if (!target.article) throw new Error("请先选择文章");
  const store = new ArticleStore(target.root),
    id = target.article;
  return withResourceLock(target.root, async () => {
    const meta = await store.get(id),
      expected = meta.drafts.find((row) => row.note === `workflow:${state.id}`);
    if (
      !expected ||
      meta.current_rev !== expected.rev ||
      meta.current_rev !== output.revision ||
      sha256(await store.readDraft(id, expected.rev)) !== expected.sha256
    )
      throw new Error("文章已改变，旧拟采用字段不会覆盖当前稿件");
    const card = record(output.card),
      body = await store.readDraft(id, expected.rev),
      title = text(output.title, "标题", 100);
    const backup = path.join(host.home, "workflow-backups", state.id + ".json");
    const old = await readJson<unknown>(backup);
    const nowCard = await store.readCard(id);
    if (old === undefined) {
      const cardHash = nowCard === undefined ? null : sha256(JSON.stringify(nowCard));
      if (cardHash !== output.previousCardHash) throw new Error("立项卡已改变，未覆盖作者新卡片");
      await atomicWrite(backup, JSON.stringify({ meta, card: nowCard ?? null }, null, 2));
    } else {
      const original = record(old);
      if (
        JSON.stringify(nowCard) !==
          JSON.stringify(original.card === null ? undefined : original.card) &&
        JSON.stringify(nowCard) !== JSON.stringify(card)
      )
        throw new Error("立项卡已改变，未覆盖");
    }
    const context = await workflowContext(host, target, state.request),
      controller = new AbortController();
    const run = new WorkflowRun(
      host,
      journal,
      context,
      host.extras.engine?.() ?? DEFAULT_ENGINE,
      controller.signal,
    );
    const qa = await productionQa(run, store, id, card, { title, body });
    if (qa.pass !== true)
      throw new Error("实际台账质检未通过，工作稿和备份保留；请根据质检结果修订，未标记已验收");
    return { at: nowIso(), backup, revision: expected.rev, qa };
  });
}
