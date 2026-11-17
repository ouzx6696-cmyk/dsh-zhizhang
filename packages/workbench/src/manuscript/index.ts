export { joinLeadHeading, splitLeadHeading, type LeadHeadingSplit } from "./heading.js";

export interface ManuscriptAnnotation {
  from: number;
  to: number;
  kind: "continuity" | "reader" | "fact";
  message: string;
}

export function sortAnnotations(items: ManuscriptAnnotation[]): ManuscriptAnnotation[] {
  return [...items].sort((a, b) => a.from - b.from || a.to - b.to);
}
