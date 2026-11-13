import { readText, sha256 } from "../../core/src/fsx.js";
import { snapshotFiles } from "../../core/src/snapshots.js";
import { WriterError } from "../../core/src/tool.js";
import { bridge, type ToutiaoConfig } from "./env.js";
import {
  ArticleStore,
  deliveryCurrent,
  deliveryMatches,
  nowIso,
  type ArticleMeta,
  type Status,
} from "./store.js";

/** 当前版本是否有仍然有效（稿件与立项卡都未改）的过线质检 */
export async function validPassingQa(store: ArticleStore, m: ArticleMeta) {
  const q = store.latestQaFor(m);
  if (!q) return { ok: false as const, reason: "当前版本还没跑质检（toutiao_qa_check）" };
  let draft: string;
  try {
    draft = await store.readDraft(m.id, m.current_rev);
  } catch (error) {
    if (!(error instanceof WriterError) || error.code !== "NOT_FOUND") throw error;
    return { ok: false as const, reason: "稿件文件缺失，请保留现有文件并核对。" };
  }
  // 质检绑定的是记录哈希；稿件文件被外部原地改写后，那次质检不再覆盖实际正文。
  if (sha256(draft) !== q.sha256)
    return {
      ok: false as const,
      reason: "稿件文件被外部改动，与质检时的哈希不一致；请重新 toutiao_draft_stage 并重跑质检",
    };
  const cardSha = await store.cardSha(m.id);
  if (q.card_sha256 !== cardSha)
    return { ok: false as const, reason: "立项卡在质检后改过，请重跑 toutiao_qa_check" };
  if (!q.pass)
    return {
      ok: false as const,
      reason: `当前版本质检未过线（${q.score} 分${q.hard_gates.length ? "，硬闸：" + q.hard_gates.join("、") : ""}）`,
    };
  return { ok: true as const, qa: q };
}

/** Commit an author's delivery decision under the article lock. */
export async function adoptArticle(
  store: ArticleStore,
  id: string,
  input: {
    by: "author" | "author-panel";
    note?: string;
    expected?: { rev: number; sha256: string };
    expectedStatus?: Status;
  },
): Promise<ArticleMeta> {
  return store.update(id, async (meta) => {
    if (input.expectedStatus !== undefined && meta.status !== input.expectedStatus)
      throw new WriterError("CONFLICT", "状态已被其他操作改变，请重试");
    const draft = store.currentDraft(meta);
    if (
      input.expected &&
      (!draft || draft.rev !== input.expected.rev || draft.sha256 !== input.expected.sha256)
    )
      throw new WriterError("CONFLICT", "文章版本已变化，请重新阅读当前稿后确认采用");
    if (meta.status !== "已验收" || !deliveryCurrent(meta))
      throw new WriterError("CONFLICT", "只有已验收且交稿单对应当前稿的文章可以采用");
    const delivery = await readText(store.deliveryPath(id));
    if (
      !draft ||
      delivery === undefined ||
      !deliveryMatches(delivery, await store.readDraft(id, draft.rev))
    )
      throw new WriterError("CONFLICT", "交稿单与当前稿不一致，请重新出交稿单");
    const qa = await validPassingQa(store, meta);
    if (!qa.ok)
      throw new WriterError(input.by === "author-panel" ? "GATE_DENIED" : "CONFLICT", qa.reason);
    if (input.by === "author-panel")
      await snapshotFiles(store.dir(id), [store.metaPath(id), store.draftPath(id, draft.rev)]);
    meta.history.push({
      from: meta.status,
      to: "已交稿",
      by: input.by,
      at: nowIso(),
      note: input.note,
    });
    meta.status = "已交稿";
  });
}

/** 文章状态变化后同步台账里同标题那一行（若已记账） */
export async function syncLedgerStatus(config: ToutiaoConfig, store: ArticleStore, m: ArticleMeta) {
  const title = String((await store.readCard(m.id))?.["主标题"] ?? "");
  if (!title || !(await readText(store.ledgerPath))) return { synced: false };
  try {
    await bridge(config, [
      "ledger-status",
      "--article-id",
      m.id,
      "--title",
      title,
      "--to",
      m.status,
      "--ledger",
      store.ledgerPath,
    ]);
    return { synced: true };
  } catch (e) {
    if (e instanceof WriterError && e.code === "NOT_FOUND") return { synced: false };
    throw e;
  }
}
