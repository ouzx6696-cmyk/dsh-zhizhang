import { methodBasis } from "./methods";
import { fanqieContextData } from "./fanqie-context";
import { readText, sha256 } from "../../../../packages/core/src/fsx";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import type { WorkflowHost } from "./host";
import type { Target } from "../context";
import type { WorkflowRequest } from "../../../../packages/core/src/workflow";
import type { WorkflowContext } from "./run";
const FEEDBACK_TAIL = 4000;
function tail(value: string, max: number) {
  return value.length > max ? `（前文略）…${value.slice(-max)}` : value;
}
async function readDraftAtVersion(
  store: ArticleStore,
  article: string,
  draft: { rev: number; sha256: string } | undefined,
) {
  if (!draft) return "";
  const body = await store.readDraft(article, draft.rev);
  if (sha256(body) !== draft.sha256) throw new Error("稿件正文与登记版本不一致，请先核对稿件");
  return body;
}
export async function workflowContext(
  host: WorkflowHost,
  target: Target,
  request: WorkflowRequest,
): Promise<WorkflowContext> {
  const author = (await host.extras.preferences?.()) ?? "",
    methods = await methodBasis(host, request);
  const enabled = host.options.fanqie?.pursuit?.enabled === true;
  const identity = {
    author,
    methods,
    ...(enabled ? { pursuit: true } : {}),
    ...(host.options.fanqie?.pursuit?.radar === true ? { readingRadar: true } : {}),
  };
  const assertIdentity = async () => {
    if (
      JSON.stringify({
        author: (await host.extras.preferences?.()) ?? "",
        methods: await methodBasis(host, request),
        ...(host.options.fanqie?.pursuit?.enabled === true ? { pursuit: true } : {}),
        ...(host.options.fanqie?.pursuit?.radar === true ? { readingRadar: true } : {}),
      }) !== JSON.stringify(identity)
    )
      throw new Error("作者偏好或方法方案已变化，请新建任务以采用新依据");
  };
  if (target.mode === "toutiao") {
    if (!target.article) throw new Error("请先新建或选择文章");
    const store = new ArticleStore(target.root),
      meta = await store.get(target.article),
      card = await store.readCard(meta.id);
    if (meta.delivered || meta.status === "已交稿") throw new Error("文章已交稿，请新建文章");
    const feedback = (await readText(store.feedbackPath)) ?? "";
    const current = store.currentDraft(meta),
      draftText = await readDraftAtVersion(store, meta.id, current);
    const basis = JSON.stringify({ meta, card, identity, feedback });
    return {
      // Author feedback accumulates per article; the newest part carries the current preferences.
      stable: author + "\n" + tail(feedback, FEEDBACK_TAIL),
      material: [
        { name: "文章与立项卡", text: JSON.stringify({ article: meta, card }), required: true },
        {
          name: "当前工作稿",
          text: draftText,
          required: true,
        },
      ],
      chapterPosition: 0,
      basis,
      sourceHash: sha256(basis + author + request.source),
      assertCurrent: async () => {
        await assertIdentity();
        const now = await store.get(meta.id),
          nowCard = await store.readCard(meta.id);
        if (
          JSON.stringify({
            meta: now,
            card: nowCard,
            identity,
            feedback: (await readText(store.feedbackPath)) ?? "",
          }) !== basis
        )
          throw new Error("文章、标题或立项卡已变化，进度保留，请新建任务以采用当前版本");
        await readDraftAtVersion(store, now.id, store.currentDraft(now));
      },
    };
  }
  const data = await fanqieContextData(host, target, request, author, identity);
  return {
    ...data,
    assertCurrent: async () => {
      await assertIdentity();
      const current = await fanqieContextData(host, target, request, author, identity);
      if (current.basis !== data.basis)
        throw new Error("作品依据或前章已变化，进度保留；请新建任务，避免覆盖作者修改");
    },
  };
}
