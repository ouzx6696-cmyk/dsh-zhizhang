import { EDITOR_TOOLS as TOUTIAO_EDITOR_TOOLS } from "../../../../packages/toutiao/src/tools";
import { EDITOR_TOOLS as FANQIE_EDITOR_TOOLS } from "../../../../packages/fanqie/src/tools";

import { EDITOR_ENGINE } from "../../../../packages/fanqie/src/engine/bootstrap";

export const PLANNER_TOOLS = new Set([
  "fanqie_project_create",
  "fanqie_project_open",
  "fanqie_project_list",
  "fanqie_status",
  "fanqie_foundation_get",
  "fanqie_foundation_set",
  "fanqie_outline_get",
  "fanqie_outline_set",
  "fanqie_chapter_list",
  "fanqie_chapter_read",
  "fanqie_reference_analyze",
  "fanqie_product_map",
  "fanqie_method_list",
  "fanqie_method_get",
  "fanqie_forge_get",
  "fanqie_outline_check",
  "fanqie_ledger_check",
  "fanqie_library_scan",
  "fanqie_quote_check",
  "fanqie_library_import",
  "fanqie_library_plan",
  "fanqie_library_dissect_brief",
  "fanqie_library_card_stage",
  "fanqie_library_card_get",
  "fanqie_library_card_accept",
  "fanqie_library_list",
  "fanqie_library_search",
  "fanqie_library_audit",
  "fanqie_library_combo_suggest",
  "fanqie_library_facts_stage",
  "fanqie_library_structure_stage",
  "fanqie_library_report",
  "fanqie_inspire_start",
  "fanqie_inspire_forge_brief",
  "fanqie_inspire_stage",
  "fanqie_inspire_status",
  "fanqie_inspire_accept",
  "toutiao_method_get",
  "toutiao_rules",
  "toutiao_hot_fetch",
  "toutiao_article_create",
  "toutiao_article_list",
  "toutiao_article_get",
  "toutiao_card_set",
  "toutiao_card_patch",
  "toutiao_headline_set",
  "toutiao_ledger_show",
  "toutiao_feedback_read",
]);

// Only operations whose successful return confirms a persisted object.
export const PLANNING_WRITES = new Set([
  "fanqie_project_create",
  "fanqie_foundation_set",
  "fanqie_outline_set",
  "fanqie_library_import",
  "fanqie_library_card_stage",
  "fanqie_library_card_accept",
  "fanqie_inspire_start",
  "fanqie_inspire_stage",
  "fanqie_inspire_accept",
  "toutiao_article_create",
  "toutiao_card_set",
  "toutiao_card_patch",
  "toutiao_headline_set",
]);

export function roleAllows(role: string, name: string, mode: string) {
  if (role === "planner") return PLANNER_TOOLS.has(name);
  if (role !== "editor") return true;
  return mode === "toutiao"
    ? TOUTIAO_EDITOR_TOOLS.has(name)
    : EDITOR_ENGINE.has(name) || FANQIE_EDITOR_TOOLS.has(name);
}
