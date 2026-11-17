import { createIdSource } from "@zhizhang/core/id";
import type { StageSpec } from "@zhizhang/core/pipeline";
import { arr, lit, obj, opt, parseJson, str, type Infer } from "@zhizhang/core/schema";
import { EntityKindSchema, FacetSchema } from "../../bible/schema.js";
import type { ProposeOpMeta } from "../../bible/store.js";
import type { BibleOp, Fact, LedgerEntry, Provenance } from "../../bible/types.js";
export interface ExtractedDelta {
  quote: string;
  kind: "entity" | "state" | "thread" | "knowledge";
  targetId: string;
  name: string;
  detail: string;
  field?: string;
  value?: string;
  entityKind?: import("../../bible/types.js").EntityKind;
  facet?: import("../../bible/types.js").Facet;
  beat?: "plant" | "push" | "pay";
  level?: "不知" | "怀疑" | "误认" | "知情" | "公开";
}

const ExtractedDeltaSchema = obj({
  deltas: arr(
    obj({
      quote: str({ min: 1 }),
      kind: lit("entity", "state", "thread", "knowledge"),
      targetId: str({ min: 1 }),
      name: str({ min: 1 }),
      detail: str({ min: 1 }),
      field: opt(str()),
      entityKind: opt(EntityKindSchema),
      facet: opt(FacetSchema),
      beat: opt(lit("plant", "push", "pay")),
      value: opt(str()),
      level: opt(lit("不知", "怀疑", "误认", "知情", "公开")),
    }),
    { max: 40 },
  ),
});

export const ledgerExtractStage: StageSpec<
  { chapterId: string; position: number; body: string },
  Infer<typeof ExtractedDeltaSchema>
> = {
  id: "extract",
  title: "抽取账本增量",
  role: "extractor",
  method: { stage: "fanqie.ledger.extract" },
  input: (ctx) => ({
    chapterId: String(ctx.state.chapterId ?? ""),
    position: Number(ctx.state.position ?? 1),
    body: String(ctx.state.chapterBody ?? ""),
  }),
  shape:
    'JSON 格式：{"deltas":[{"quote":"原文精确引文","kind":"entity|state|thread|knowledge","targetId":"实体ID","name":"名称或事实","detail":"说明","field":"状态字段","value":"状态值","level":"知情","entityKind":"character|faction|place|power|item|rule|term","facet":"condition|location|relation|possession|ability|identity|other","beat":"plant|push|pay"}]}',
  format: "json",
  parse: (raw) => parseJson(raw, ExtractedDeltaSchema, "ledger.extract"),
};

const UNLOCATED_TAG = "【待核对：原文未定位到引文】";

export function deltaToBibleOp(
  delta: ExtractedDelta,
  position: number,
  revision: string,
  runId: string,
  nowIso: string,
  isLocated: boolean,
): { op: BibleOp; meta: ProposeOpMeta } {
  const provenance: Provenance = { source: "ledger", run: runId, chapter: position, at: nowIso };
  const evidence = { chapter: position, revision, quote: delta.quote, located: isLocated };
  const annotatedDetail = isLocated ? delta.detail : `${delta.detail} ${UNLOCATED_TAG}`;
  const meta: ProposeOpMeta = { evidence, located: isLocated };

  if (delta.kind === "entity") {
    return {
      op: {
        type: "entity.upsert",
        entity: {
          id: delta.targetId,
          kind: delta.entityKind ?? "character",
          name: delta.name,
          aliases: [],
          summary: annotatedDetail,
          locked: [],
          provenance,
          rev: 0,
        },
      },
      meta,
    };
  }
  if (delta.kind === "state") {
    return {
      op: {
        type: "state.add",
        entry: {
          id: createIdSource().next("st"),
          entity: delta.targetId,
          facet: delta.facet ?? "other",
          field: delta.field ?? "状态",
          value: isLocated
            ? (delta.value ?? delta.detail)
            : `${delta.value ?? delta.detail} ${UNLOCATED_TAG}`,
          since: position,
          mode: delta.facet === "other" || !delta.facet ? "add" : "replace",
          status: isLocated ? "confirmed" : "planned",
          evidence,
          provenance,
          rev: 0,
        },
      },
      meta,
    };
  }
  if (delta.kind === "thread") {
    return {
      op: {
        type: "thread.upsert",
        thread: {
          id: delta.targetId,
          title: delta.name,
          kind: "foreshadow",
          opened: position,
          importance: "minor",
          beats: [
            { chapter: position, kind: delta.beat ?? "plant", note: annotatedDetail, evidence },
          ],
          status: delta.beat === "pay" ? "paid" : "open",
          provenance,
          rev: 0,
        },
      },
      meta,
    };
  }
  return {
    op: {
      type: "knowledge.set",
      row: {
        id: createIdSource().next("kn"),
        fact: annotatedDetail,
        holder: delta.targetId,
        level: delta.level ?? "知情",
        since: position,
        evidence,
        provenance,
        rev: 0,
      },
    },
    meta,
  };
}

function factKind(kind: ExtractedDelta["kind"]): Fact["kind"] {
  if (kind === "state") return "change";
  if (kind === "thread") return "promise";
  if (kind === "knowledge") return "reveal";
  return "event";
}

export function buildLedgerEntry(input: {
  chapterId: string;
  revision: string;
  position: number;
  body: string;
  runId: string;
  items: { delta: ExtractedDelta; isLocated: boolean }[];
}): LedgerEntry {
  const facts: Fact[] = input.items.slice(0, 60).map((item, index) => ({
    id: `fact-${index + 1}`,
    text: item.delta.detail.slice(0, 120),
    entities: item.delta.kind === "thread" ? [] : [item.delta.targetId],
    kind: factKind(item.delta.kind),
    quote: item.delta.quote,
    located: item.isLocated,
  }));
  const positions: Record<string, string> = {};
  for (const item of input.items) {
    if (item.delta.kind === "state") {
      positions[item.delta.targetId] = item.delta.value ?? item.delta.detail;
    }
  }
  return {
    format: "zhizhang/1.3",
    chapter: input.chapterId,
    revision: input.revision,
    position: input.position,
    summary: input.body.replace(/\s+/g, " ").trim().slice(0, 600),
    handoff: {
      ending: input.body.trim().slice(-200),
      openQuestions: input.items
        .filter((item) => item.delta.kind === "thread")
        .map((item) => item.delta.detail),
      positions,
      carried: [],
    },
    hook: "",
    emotion: "",
    facts,
    appearances: [],
    ledgerRun: input.runId,
    rev: 0,
  };
}
