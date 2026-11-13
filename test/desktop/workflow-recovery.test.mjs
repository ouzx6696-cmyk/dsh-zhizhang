import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { ArticleStore } from "../../apps/desktop/out-test/article-store.mjs";
import { recoverDelivery } from "../../apps/desktop/out-test/workflow-recovery.mjs";

test("已有交稿单的文章续写中断后可恢复，其他依据变化仍阻断", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "writer-delivery-recovery-"));
  try {
    const store = new ArticleStore(root);
    const article = await store.create("recovery", {});
    await store.stageDraft(article.id, "原稿", "writer", "");
    await store.update(article.id, (meta) => {
      meta.status = "已验收";
      meta.delivered = true;
      meta.delivered_rev = 1;
      meta.delivered_sha256 = meta.drafts[0].sha256;
    });
    const before = await store.get(article.id);
    const basis = (meta, card = null) => JSON.stringify({ meta, card });
    await store.stageDraft(article.id, "新工作稿", "editor", "workflow:run-abcd");
    const after = await store.get(article.id);
    const target = { mode: "toutiao", root, article: article.id };
    const previous = {
      id: "run-abcd",
      request: { kind: "article" },
      basis: basis(before),
      steps: [{ id: "prepared", status: "complete", output: { body: "新工作稿" } }],
    };
    await recoverDelivery({}, target, previous, { basis: basis(after) });
    await assert.rejects(
      recoverDelivery({}, target, previous, { basis: basis(after, "已改") }),
      /其他依据已变化/,
    );
  } finally {
    await rm(root, { recursive: true, force: true });
  }
});
