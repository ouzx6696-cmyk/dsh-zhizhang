/** Load the active profile's method into the task, rather than relying on model recall. */
import { readMethod } from "../../../../packages/core/src/profiles";
import { sha256 } from "../../../../packages/core/src/fsx";
import { fanqieLibrary } from "../../../../packages/fanqie/src/forge";
import type { Focus } from "../context";

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
        : intent === "write"
          ? /修订|润色|修改/.test(text)
            ? "revise"
            : "write-chapter"
          : "overview";
  const method = await readMethod(fanqieLibrary, profile, id, pinned);
  return [{ id: method.id, profile: method.profile, hash: sha256(method.text), text: method.text }];
}
