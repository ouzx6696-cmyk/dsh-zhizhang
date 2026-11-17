/** 实体名称与别名匹配。 */
import type { BibleView, EntityHit } from "./types.js";

export function matchEntities(view: BibleView, texts: string[]): EntityHit[] {
  const corpus = texts.join("\n");
  const hits: EntityHit[] = [];
  for (const entity of view.entities) {
    const terms = [entity.name, ...entity.aliases]
      .filter((term) => term.trim().length > 0)
      .sort((a, b) => b.length - a.length);
    let count = 0;
    let firstIndex = Number.MAX_SAFE_INTEGER;
    let matchedTerm = "";
    const hay = entity.matchCase ? corpus : corpus.toLowerCase();

    for (const term of terms) {
      const needle = entity.matchCase ? term : term.toLowerCase();
      let pos = hay.indexOf(needle);
      while (pos !== -1) {
        count += 1;
        if (pos < firstIndex) {
          firstIndex = pos;
          matchedTerm = term;
        }
        pos = hay.indexOf(needle, pos + needle.length);
      }
    }
    if (count > 0 || entity.global) {
      hits.push({
        entity,
        count,
        firstIndex: count > 0 ? firstIndex : Number.MAX_SAFE_INTEGER,
        matchedTerm: matchedTerm || entity.name,
      });
    }
  }
  return hits.sort((a, b) => b.count - a.count || a.firstIndex - b.firstIndex);
}
