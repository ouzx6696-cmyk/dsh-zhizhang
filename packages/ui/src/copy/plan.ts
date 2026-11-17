import { PLAN_IMPORT_COPY } from "./plan-import.js";
import { PLAN_LIBRARY_COPY } from "./plan-library.js";
import { PLAN_OUTLINE_COPY } from "./plan-outline.js";
import { PLAN_REVIEW_COPY } from "./plan-review.js";

/** 大纲·设定域文案聚合：只做 spread，不写文案。 */
export const PLAN_COPY = {
  ...PLAN_OUTLINE_COPY,
  ...PLAN_LIBRARY_COPY,
  ...PLAN_IMPORT_COPY,
  ...PLAN_REVIEW_COPY,
} as const;
