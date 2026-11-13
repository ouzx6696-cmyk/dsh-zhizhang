import { useEffect } from "react";
import { errorText } from "../../../../../packages/core/src/errors.js";
import { notify } from "@writer/ui/notify";
import { scopeId, type Focus, type Target } from "../../context";

/** 写作区的挂载范围：同一部长篇或同一个头条目录；切换文章、章节、候选稿都不出这个范围。 */
export const workspaceScope = (target: Target) => scopeId({ ...target, article: undefined });

type Navigator = { scope: string; navigate: (target: Target, focus: Focus) => unknown };
let mounted: Navigator | null = null;

/** 已挂载的写作区登记自己的就地跳转入口；卸载或换范围时撤下。 */
export function useWorkspaceNavigator(
  target: Target,
  navigate: (target: Target, focus: Focus) => unknown,
) {
  const scope = workspaceScope(target);
  useEffect(() => {
    const entry = { scope, navigate };
    mounted = entry;
    return () => {
      if (mounted === entry) mounted = null;
    };
  }, [scope, navigate]);
}

/** 目标是否落在已挂载写作区的范围内；跳转前判定，避免把新挂载的写作区当成可就地切换。 */
export function workspaceMounted(target: Target) {
  return mounted?.scope === workspaceScope(target);
}

/** 目标仍在当前写作区范围内时就地切换并返回 true；否则由调用方重挂载写作区。 */
export function navigateWorkspace(target: Target, focus: Focus) {
  if (!mounted || !workspaceMounted(target)) return false;
  Promise.resolve(mounted.navigate(target, focus)).catch((error) =>
    notify({ tone: "danger", text: errorText(error) }),
  );
  return true;
}
