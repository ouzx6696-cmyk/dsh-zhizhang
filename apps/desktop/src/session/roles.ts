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
