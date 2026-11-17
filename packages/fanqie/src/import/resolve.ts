import { addRelations, completeThreadRefs } from "./relations.js";
import { allocateNames } from "./names.js";
import { confidence } from "./confidence.js";
import { attrCompat, matchCandidate } from "./match.js";
import { createIdSource, type IdSource } from "@zhizhang/core/id";
import type {
  AnyOp,
  BibleSnapshot,
  Entity,
  PendingItem,
  Provenance,
  SourceRef,
} from "../bible/types.js";
import { nodesOf, type Outline } from "../outline/store.js";
import type { ChapterPlan, PlanNodeBase } from "../outline/types.js";
import { nameKey, type LocatedItem } from "./extract.js";
import { nextNodeIndex, removeCreatedSibling } from "./node-index.js";
import type { DocMap } from "./types.js";

export function resolveItems(
  located: LocatedItem[],
  bible: BibleSnapshot,
  outline: Outline,
  batch: string,
  run: string,
  docmap: DocMap,
  at: string,
  ids: IdSource = createIdSource(),
  previous: PendingItem[] = [],
): PendingItem[] {
  const result: PendingItem[] = [],
    names = allocateNames(located, bible, outline, previous, ids),
    created = new Map<string, string>(),
    createdSiblings = new Map<string, number>(),
    clusters = new Map<string, PendingItem>(),
    seenEntityVariants = new Map<string, { id: string; attributes?: Record<string, string> }[]>();
  for (const entity of bible.entities) {
    const key = `${entity.kind}:${nameKey(entity.name)}`,
      variants = seenEntityVariants.get(key) ?? [];
    variants.push({ id: entity.id, attributes: entity.attributes });
    seenEntityVariants.set(key, variants);
  }
  for (const pending of previous) {
    const op = pending.edited ?? pending.op;
    if (op.type !== "entity.upsert") continue;
    const key = `${op.entity.kind}:${nameKey(op.entity.name)}`,
      variants = seenEntityVariants.get(key) ?? [];
    variants.push({ id: op.entity.id, attributes: op.entity.attributes });
    seenEntityVariants.set(key, variants);
  }
  const provenance: Provenance = { source: "import", batch, run, at };
  function ensureEntity(name: string, kind: Entity["kind"] = "character"): string {
    const key = `${kind}:${nameKey(name)}`;
    const known = bible.entities.find((entity) => entity.id === name);
    if (known) return known.id;
    let id = names.get(key) ?? names.get(name);
    if (id) return id;
    id = ids.next("ent");
    names.set(key, id);
    const pendingId = ids.next("p");
    created.set(id, pendingId);
    result.push({
      id: pendingId,
      op: {
        type: "entity.upsert",
        entity: { id, kind, name, aliases: [], summary: "", locked: [], rev: 0, provenance },
      },
      change: "new",
      group: id,
      dependsOn: [],
      notes: ["import.unresolved_reference"],
      decision: "undecided",
    });
    return id;
  }
  const entityId = (name: string, kind: Entity["kind"] = "character") =>
    names.get(`${kind}:${nameKey(name)}`) ?? names.get(name) ?? ensureEntity(name, kind);
  const nodeId = (name: string) => names.get(name) ?? names.get(`node:${nameKey(name)}`);
  const threadId = (name: string) => names.get(name) ?? names.get(`thread:${nameKey(name)}`);
  for (const row of located) {
    const { item, hit } = row;
    if (item.type === "note") continue;
    const src: SourceRef = {
      batch,
      section: hit.para ? `S${hit.para.slice(1).split(".")[0]}` : "unknown",
      paras: hit.para ? [hit.para] : item.src,
      quote: (hit.text ?? item.quote).slice(0, 80),
      located: hit.located,
      start: hit.start,
      end: hit.end,
    };
    let op: AnyOp | undefined,
      current: Entity | undefined,
      key = "",
      dependencies: string[] = [],
      notes: string[] = [];
    if (item.type === "entity") {
      const id = names.get(item.tmp) ?? entityId(item.name, item.kind),
        variantKey = `${item.kind}:${nameKey(item.name)}`,
        variants = seenEntityVariants.get(variantKey) ?? [],
        separate = variants.some(
          (variant) => variant.id !== id && attrCompat(item.attributes, variant.attributes) === 0,
        );
      if (separate) notes.push("import.same_name_separate");
      if (!variants.some((variant) => variant.id === id))
        variants.push({ id, attributes: item.attributes });
      seenEntityVariants.set(variantKey, variants);
      key = `entity:${id}`;
      current = bible.entities.find((entity) => entity.id === id);
      const clash = bible.entities.find(
        (entity) => nameKey(entity.name) === nameKey(item.name) && entity.kind !== item.kind,
      );
      if (clash) notes.push("import.kind_clash");
      const attributes = { ...(item.attributes ?? {}), ...(current?.attributes ?? {}) };
      const entity: Entity = {
        id,
        kind: item.kind,
        name: current?.name ?? item.name + (separate ? "（二）" : ""),
        aliases: [...new Set([...(current?.aliases ?? []), ...(item.aliases ?? [])])],
        summary: current?.summary || item.summary || "",
        attributes,
        locked: current?.locked ?? item.locked ?? [],
        parent: item.parent
          ? entityId(item.parent, item.kind === "place" ? "place" : "faction")
          : current?.parent,
        rev: current?.rev ?? 0,
        provenance,
        src: [src],
      };
      const ambiguous = bible.entities.filter(
        (candidate) =>
          candidate.kind === item.kind &&
          candidate.id !== id &&
          matchCandidate(
            item.name,
            item.attributes,
            candidate,
            row.paragraphText &&
              [candidate.name, ...candidate.aliases].some((name) =>
                row.paragraphText?.includes(name),
              )
              ? 1
              : 0,
          ) > 0.4,
      );
      if (ambiguous.length) {
        notes.push("import.ambiguous_name");
        for (const candidate of ambiguous) notes.push(`import.candidate:${candidate.id}`);
      }
      if (
        current &&
        Object.entries(item.attributes ?? {}).some(
          ([field, value]) =>
            current?.attributes?.[field] !== undefined && current.attributes[field] !== value,
        )
      )
        notes.push("import.attribute_conflict");
      op = { type: "entity.upsert", entity, expectedRev: current?.rev };
    } else if (item.type === "volume" || item.type === "act" || item.type === "chapter") {
      const id = nodeId(item.tmp) ?? nodeId(item.title) ?? ids.next("pl");
      key = `node:${id}`;
      const existing = nodesOf(outline).find(({ node }) => node.id === id);
      const base: PlanNodeBase = {
        id,
        title: item.title,
        summary: item.summary,
        goal: item.goal,
        conflict: item.conflict,
        payoffs: item.payoffs,
        hook: item.hook,
        wordTarget: item.wordTarget,
        planStatus: "draft",
        provenance,
        src: [src],
        rev: existing?.node.rev ?? 0,
      };
      let node: PlanNodeBase | ChapterPlan = base;
      if (item.type === "chapter") {
        node = {
          ...base,
          cast: item.cast?.map((name) => entityId(name)),
          pov: item.pov ? entityId(item.pov) : undefined,
          location: item.location ? entityId(item.location, "place") : undefined,
          plant: item.plant?.map((title) => ({
            thread: threadId(title),
            ...(threadId(title) ? {} : { title }),
          })),
          pay: item.pay?.map((title) => ({
            thread: threadId(title),
            ...(threadId(title) ? {} : { title }),
          })),
          beats: item.beats,
          mustInclude: item.mustInclude,
          mustAvoid: item.mustAvoid,
          timeAnchor: item.timeAnchor,
        };
      }
      const parent = "parent" in item ? nodeId(item.parent) : undefined;
      if (item.type !== "volume" && !parent) notes.push("import.parent_unresolved");
      const position = nextNodeIndex(outline, item.type, parent, item.order, createdSiblings);
      if (existing) {
        op = {
          type: "node.update",
          id,
          patch: {
            title: node.title,
            summary: node.summary,
            goal: node.goal,
            conflict: node.conflict,
          },
          expectedRev: existing.node.rev,
        };
      } else {
        createdSiblings.set(position.key, (createdSiblings.get(position.key) ?? 0) + 1);
        op = {
          type: "node.create",
          level: item.type,
          parent,
          index: position.index,
          node,
        };
      }
      dependencies = [parent, ...(node.cast ?? [])].filter((id): id is string => !!id);
    } else if (item.type === "state") {
      const entity = entityId(item.entity),
        target = item.target ? entityId(item.target) : undefined;
      key = `state:${entity}:${item.facet}:${item.field ?? item.facet}:${item.since ?? 1}`;
      const existing = bible.states.find(
        (state) =>
          state.entity === entity &&
          state.facet === item.facet &&
          state.since === (item.since ?? 1),
      );
      if (existing && existing.value !== item.value) notes.push("import.state_conflict");
      op = {
        type: "state.add",
        entry: {
          id: existing?.id ?? ids.next("st"),
          entity,
          target,
          facet: item.facet,
          field: item.field ?? item.facet,
          value: item.value,
          since: item.since ?? 1,
          until: item.until,
          mode: "replace",
          status: "planned",
          provenance,
          src: [src],
          rev: 0,
        },
      };
      dependencies = [entity, ...(target ? [target] : [])];
    } else if (item.type === "thread") {
      const id = threadId(item.tmp) ?? threadId(item.title) ?? ids.next("th");
      key = `thread:${id}`;
      const existing = bible.threads.find((thread) => thread.id === id);
      op = {
        type: "thread.upsert",
        thread: {
          id,
          title: item.title,
          kind: item.kind,
          opened: item.plantAt ?? 1,
          plannedPlant: item.plantAt,
          plannedPayoff: item.payAt,
          importance: item.importance ?? "minor",
          beats: existing?.beats ?? [],
          status: existing?.status ?? "open",
          provenance,
          src: [src],
          rev: existing?.rev ?? 0,
        },
        expectedRev: existing?.rev,
      };
    } else if (item.type === "timeline") {
      const existing = bible.timeline.find((event) => nameKey(event.title) === nameKey(item.title));
      key = `timeline:${nameKey(item.title)}`;
      op = {
        type: "timeline.upsert",
        event: {
          id: existing?.id ?? ids.next("ev"),
          title: item.title,
          when: item.when,
          order: item.order ?? 0,
          chapter: item.chapter,
          entities: (item.entities ?? []).map((name) => entityId(name)),
          summary: item.summary ?? "",
          canon: item.canon ?? "backstory",
          provenance,
          src: [src],
          rev: existing?.rev ?? 0,
        },
        expectedRev: existing?.rev,
      };
    } else if (item.type === "knowledge") {
      const holder = entityId(item.holder);
      key = `knowledge:${holder}:${item.fact}`;
      op = {
        type: "knowledge.set",
        row: {
          id: ids.next("kn"),
          holder,
          fact: item.fact,
          level: item.level,
          since: item.since ?? 1,
          provenance,
          rev: 0,
        },
      };
      dependencies = [holder];
    }
    if (!op) continue;
    const previous = clusters.get(key);
    if (previous) {
      if (op.type === "node.create") {
        removeCreatedSibling(createdSiblings, op.level, op.parent);
      }
      if (previous.src && previous.src.length < 10) previous.src.push(src);
      if (previous.confidence)
        previous.confidence = confidence({
          self: previous.confidence.parts.self ?? 0,
          loc: previous.confidence.parts.loc ?? 0,
          kindFit: previous.confidence.parts.kindFit ?? 0,
          crossChunk: 1,
          noConflict: previous.confidence.parts.noConflict ?? 0,
        });
      previous.notes.push("import.cross_chunk");
      continue;
    }
    const kind = docmap.sections.find((section) => section.id === src.section)?.kind ?? "unknown";
    const kindFit =
      kind.endsWith(item.type) || (item.type === "entity" && kind === `setting-${item.kind}`)
        ? 1
        : 0;
    const scored = confidence({
      self: item.confidence,
      loc: hit.located === "exact" ? 1 : hit.located === "fuzzy" ? 0.6 : 0,
      kindFit,
      crossChunk: 0,
      noConflict: notes.length ? 0 : 1,
    });
    const { band } = scored;
    const unchanged =
      current &&
      op.type === "entity.upsert" &&
      current.name === op.entity.name &&
      current.summary === op.entity.summary &&
      JSON.stringify(current.attributes ?? {}) === JSON.stringify(op.entity.attributes ?? {}) &&
      current.aliases.length === op.entity.aliases.length;
    const change = unchanged
      ? "same"
      : notes.some((note) => note.includes("conflict") || note.includes("clash"))
        ? "conflict"
        : current
          ? "update"
          : "new";
    const pending: PendingItem = {
      id: ids.next("p"),
      op,
      change,
      group: key,
      dependsOn: dependencies,
      notes: [...notes, ...(!hit.located ? ["import.unlocated"] : [])],
      src: [src],
      baseRev: current?.rev,
      decision: change === "new" && band === "high" && !notes.length ? "accept" : "undecided",
      confidence: scored,
    };
    clusters.set(key, pending);
    result.push(pending);
    const id =
      op.type === "entity.upsert"
        ? op.entity.id
        : op.type === "node.create"
          ? op.node.id
          : op.type === "thread.upsert"
            ? op.thread.id
            : undefined;
    if (id) created.set(id, pending.id);
  }
  addRelations(located, result, entityId, ids, provenance);
  completeThreadRefs(result, ids, provenance, created);
  for (const pending of result)
    pending.dependsOn = pending.dependsOn
      .map((id) => created.get(id) ?? (result.some((item) => item.id === id) ? id : undefined))
      .filter((id): id is string => !!id && id !== pending.id);
  return result;
}
