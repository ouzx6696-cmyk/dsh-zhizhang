import { isAppError } from "@zhizhang/core/errors";
import { parseJson } from "@zhizhang/core/schema";
import type { StageRunner, ContextPacket } from "@zhizhang/core/pipeline";
import { DocMapSchema } from "../../import/schema.js";
import type { ImportBatchView } from "../../import/types.js";
export async function importDocMap(
  runner: StageRunner,
  packet: ContextPacket,
  view: ImportBatchView,
  selected: Set<string>,
  priorMap?: string,
) {
  let docmap: ReturnType<typeof DocMapSchema>;
  try {
    docmap = priorMap
      ? DocMapSchema(JSON.parse(priorMap))
      : await runner.stage(
          {
            id: "docmap",
            title: "识别文档结构",
            role: "planner",
            input: () =>
              `【阶段】docmap\n${view.segments
                .filter((row) => selected.has(row.id))
                .map((row) => `${row.id} ${row.title}`)
                .join("\n")
                .slice(0, 1500)}`,
            shape:
              'JSON: {"mapping":{},"sections":[{"id":"S1","kind":"outline-volume|outline-act|outline-chapter|setting-character|setting-faction|setting-place|setting-power|setting-item|setting-rule|timeline|mixed|ignore|unknown"}],"naming":[],"editedByAuthor":false}',
            format: "json",
            parse: (raw) => parseJson(raw, DocMapSchema, "docmap"),
          },
          packet,
        );
  } catch (error) {
    if (isAppError(error) && error.spec.pause) throw error;
    docmap = {
      mapping: {},
      naming: [],
      editedByAuthor: false,
      sections: view.segments.map((section) => ({
        id: section.id,
        kind: section.kind,
        note: "docmap.fallback",
      })),
    };
  }
  return docmap;
}
