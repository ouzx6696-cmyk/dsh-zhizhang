/** 角色绑定回落（纯函数，无解析器依赖：渲染层入口只带这一小段）。 */
import type { ModelRole, RoleBinding, RoleBindings } from "./settings.js";

/** 按角色取绑定；judge / extractor / assistant 缺省时回落到 editor / planner / writer。 */
export function bindingFor(roles: RoleBindings, role: ModelRole): RoleBinding | undefined {
  const fallback: Record<ModelRole, ModelRole[]> = {
    writer: ["writer"],
    editor: ["editor", "writer"],
    planner: ["planner", "writer"],
    judge: ["judge", "editor", "writer"],
    extractor: ["extractor", "planner", "writer"],
    assistant: ["assistant", "writer"],
  };
  for (const candidate of fallback[role]) {
    const hit = roles[candidate];
    if (hit) return hit;
  }
  return undefined;
}
