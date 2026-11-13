import { sha256 } from "../../../../packages/core/src/fsx";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { readChapter } from "../../../../packages/fanqie/src/engine/storage/chapters";
import { resolveFanqieWork } from "../main/storage";
import { record, outline, text } from "./schema";
import type { WorkflowRecord } from "../../../../packages/core/src/workflow";
import type { WorkflowContext } from "./run";
import type { WorkflowHost } from "./host";
import type { Target } from "../context";
/** Recognize only this run's recorded side effect, never an arbitrary change of author source. */
export async function recoverDelivery(
  host: WorkflowHost,
  target: Target,
  previous: WorkflowRecord,
  context: WorkflowContext,
) {
  const prepared = previous.steps.find((row) => row.id === "prepared" && row.status === "complete");
  if (!prepared) throw new Error("任务依据已改变，不能把旧进度套到新稿上");
  const old = record(JSON.parse(previous.basis)),
    now = record(JSON.parse(context.basis)),
    data = record(prepared.output);
  if (previous.request.kind === "chapter") {
    const current = await readChapter(
        await resolveFanqieWork(host.options, target),
        previous.request.chapter,
      ),
      original = record(data.original),
      plan = outline(data.plan);
    const expected = { ...record(original.outline), ...plan };
    if (
      current.body !== original.body ||
      current.position !== original.position ||
      current.title !== plan.title ||
      JSON.stringify(current.outline) !== JSON.stringify(expected)
    )
      throw new Error("章节已被作者修改，旧交付未覆盖");
    record(old.document).chapter = record(now.document).chapter;
  } else if (previous.request.kind === "article" && target.article) {
    const store = new ArticleStore(target.root),
      meta = await store.get(target.article),
      prior = meta.drafts.find((row) => row.note === `workflow:${previous.id}`);
    if (
      !prior ||
      prior.sha256 !== sha256(text(data.body, "已准备正文")) ||
      sha256(await store.readDraft(meta.id, prior.rev)) !== prior.sha256 ||
      meta.current_rev !== prior.rev
    )
      throw new Error("文章已被作者修改，旧交付未覆盖");
    const original = record(old.meta),
      current = record(now.meta);
    current.drafts = meta.drafts.filter((row) => row.rev !== prior.rev);
    current.current_rev = original.current_rev;
    current.updated_at = original.updated_at;
    if (
      current.delivered !== false ||
      Object.hasOwn(current, "delivered_rev") ||
      Object.hasOwn(current, "delivered_sha256")
    )
      throw new Error("交稿状态已变化，不能恢复旧交付");
    current.delivered = original.delivered;
    for (const key of ["delivered_rev", "delivered_sha256"]) {
      if (Object.hasOwn(original, key)) current[key] = original[key];
      else delete current[key];
    }
    if (original.status !== "初稿待改") {
      const history = Array.isArray(current.history) ? current.history : [];
      const last = record(history.at(-1));
      if (
        last.from !== original.status ||
        last.to !== "初稿待改" ||
        last.note !== `新稿 rev ${prior.rev}`
      )
        throw new Error("文章状态历史已变化");
      current.history = history.slice(0, -1);
      current.status = original.status;
    }
  } else throw new Error("任务依据已变化，请新建任务");
  if (JSON.stringify(old) !== JSON.stringify(now))
    throw new Error("作品其他依据已变化，不能恢复旧交付");
}
