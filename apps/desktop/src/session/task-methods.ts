/** Load the active profile's method into the task, rather than relying on model recall. */
import { readMethod, type MethodLibrary } from "../../../../packages/core/src/profiles";
import { sha256 } from "../../../../packages/core/src/fsx";
import { WriterError } from "../../../../packages/core/src/tool";
import type { ToutiaoArticleSnapshot } from "../../../../packages/core/src/method-pack";
import { fanqieLibrary } from "../../../../packages/fanqie/src/forge";
import type { Focus } from "../context";

export interface TaskMethod {
  id: string;
  profile: string;
  hash: string;
  text: string;
}

const load = (
  lib: MethodLibrary,
  profileId: string,
  id: string,
  pinned?: string,
): Promise<TaskMethod> =>
  readMethod(lib, profileId, id, pinned).then((method) => ({
    id: method.id,
    profile: method.profile,
    hash: sha256(method.text),
    text: method.text,
  }));

export async function taskMethods(
  profile: string,
  text: string,
  intent: Focus["intent"],
  pinned?: string,
) {
  if (intent === "inspect" && !/拆书|原文分析|参考分析/.test(text)) return [];
  const id = /拆书|原文分析|参考分析/.test(text)
    ? "library"
    : intent === "review"
      ? "edit"
      : intent === "plan"
        ? /章纲/.test(text)
          ? "plan-outline"
          : /卷纲|幕纲|结构/.test(text)
            ? "plan-structure"
            : "plan-foundation"
        : /修订|润色|修改/.test(text)
          ? "revise"
          : "write-chapter";
  const method = await load(fanqieLibrary, profile, id, pinned);
  return [method];
}

/** handoff.v2：按方法包给出的 id 装载全部方法全文。 */
export async function packMethods(
  lib: MethodLibrary,
  profileId: string,
  ids: string[],
  pinned?: string,
) {
  return Promise.all(ids.map((id) => load(lib, profileId, id, pinned)));
}

/** corpus-excerpt 附件按体裁线挑语料：资讯线/微头条读通用底座，故事线读母题与质感（S4 方法里指明）。 */
const CORPUS_IDS: Record<ToutiaoArticleSnapshot["contentLine"], string[]> = {
  news: ["corpus-common"],
  story: ["corpus-story-motifs", "corpus-story-texture"],
  micro: ["corpus-common"],
};

/** handoff.v2：语料附件落地；方案里没有对应语料就跳过（作者自备方案可以不带语料）。 */
export async function corpusMethods(
  lib: MethodLibrary,
  profileId: string,
  line: ToutiaoArticleSnapshot["contentLine"],
  pinned?: string,
) {
  const loaded: TaskMethod[] = [];
  for (const id of CORPUS_IDS[line]) {
    try {
      loaded.push(await load(lib, profileId, id, pinned));
    } catch (error) {
      if (error instanceof WriterError && error.code === "NOT_FOUND") continue;
      throw error;
    }
  }
  return loaded;
}
