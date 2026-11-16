const TITLE_SUFFIX = /(?:长老|师兄|师姐|执事|前辈|大人|公子|姑娘|掌门|宗主)$/u;

export function normalizeMatchKey(value) {
  return String(value ?? "")
    .normalize("NFKC")
    .toLowerCase()
    .replace(/[\s\p{P}\p{S}]+/gu, "")
    .replace(TITLE_SUFFIX, "");
}

function valueKey(value) {
  if (typeof value === "string") return value.normalize("NFKC").replace(/\s+/gu, "");
  if (Array.isArray(value)) return value.map(valueKey).join("|");
  if (value && typeof value === "object") {
    return JSON.stringify(
      Object.fromEntries(Object.entries(value).map(([k, v]) => [k, valueKey(v)])),
    );
  }
  return String(value);
}

function atPath(object, dotted) {
  return dotted.split(".").reduce((value, key) => value?.[key], object);
}

function unwrap(item) {
  const op = item?.op;
  if (!op) return item;
  if (op.type === "node.create") return { ...op.node, type: op.level, parent: op.parent };
  if (op.type === "entity.upsert") return { ...op.entity, type: "entity", src: item.src };
  if (op.type === "state.add") return { ...op.entry, type: "state", src: item.src };
  if (op.type === "thread.upsert") return { ...op.thread, type: "thread", src: item.src };
  if (op.type === "timeline.upsert") return { ...op.event, type: "timeline", src: item.src };
  if (op.type === "knowledge.set") return { ...op.row, type: "knowledge", src: item.src };
  return { ...item, type: "note" };
}

function identity(item) {
  return (
    item?.name ?? item?.title ?? item?.entity ?? item?.holder ?? item?.text ?? item?.fact ?? ""
  );
}

function aliases(item) {
  return [identity(item), ...(item?.aliases ?? [])].map(normalizeMatchKey).filter(Boolean);
}

function expectedFields(expected) {
  const fields = { ...(expected.fields ?? {}) };
  if (expected.parent !== undefined) fields.parent = expected.parent;
  if (expected.kind !== undefined) fields.kind = expected.kind;
  return Object.entries(fields);
}

function candidate(expected, actual) {
  if (expected.type !== actual.type) return undefined;
  const names = aliases(expected);
  if (!names.some((name) => aliases(actual).includes(name))) return undefined;
  const fields = expectedFields(expected);
  const hits = fields.filter(
    ([key, value]) => valueKey(atPath(actual, key)) === valueKey(value),
  ).length;
  const fieldRate = fields.length === 0 ? 1 : hits / fields.length;
  if (fieldRate < 0.8) return undefined;
  const exactName = normalizeMatchKey(identity(expected)) === normalizeMatchKey(identity(actual));
  return { fieldRate, score: fieldRate + (exactName ? 0.1 : 0) };
}

function locationOf(item) {
  if (Array.isArray(item.src) && item.src.some((ref) => typeof ref === "object")) {
    const locations = item.src.map((ref) => ref.located);
    if (locations.includes("exact")) return "exact";
    if (locations.includes("fuzzy")) return "fuzzy";
    return false;
  }
  if (item.located === "exact" || item.located === "fuzzy" || item.located === false)
    return item.located;
  return undefined;
}

/** Compare expected.json with ExtractItem[] or ImportProposal.items (PendingItem[]). */
export function matchProposals(expected, proposal, options = {}) {
  const wanted = expected.items ?? [];
  const forbidden = expected.mustNot ?? [];
  const actual = (Array.isArray(proposal) ? proposal : (proposal?.items ?? []))
    .map(unwrap)
    .filter((item) => item?.type !== "note");
  const pairs = [];
  for (let e = 0; e < wanted.length; e += 1) {
    for (let a = 0; a < actual.length; a += 1) {
      const result = candidate(wanted[e], actual[a]);
      if (result) pairs.push({ expectedIndex: e, actualIndex: a, ...result });
    }
  }
  pairs.sort(
    (a, b) =>
      b.score - a.score || a.expectedIndex - b.expectedIndex || a.actualIndex - b.actualIndex,
  );
  const usedExpected = new Set();
  const usedActual = new Set();
  const matched = [];
  for (const pair of pairs) {
    if (usedExpected.has(pair.expectedIndex) || usedActual.has(pair.actualIndex)) continue;
    usedExpected.add(pair.expectedIndex);
    usedActual.add(pair.actualIndex);
    matched.push(pair);
  }
  const mustNotHits = [];
  for (let a = 0; a < actual.length; a += 1) {
    for (const rule of forbidden) {
      if (candidate(rule, actual[a]))
        mustNotHits.push({ actualIndex: a, name: identity(actual[a]), type: actual[a].type });
    }
  }
  const matchRate = wanted.length === 0 ? 1 : matched.length / wanted.length;
  const falsePositiveRate =
    actual.length === 0 ? 0 : (actual.length - usedActual.size) / actual.length;
  const located = { exact: 0, fuzzy: 0, unlocated: 0 };
  let locationTotal = 0;
  for (const item of actual) {
    const location = locationOf(item);
    if (location === undefined) continue;
    locationTotal += 1;
    if (location === false) located.unlocated += 1;
    else located[location] += 1;
  }
  const locatedRate = locationTotal === 0 ? 1 : (located.exact + located.fuzzy) / locationTotal;
  const minMatchRate = options.minMatchRate ?? expected.stats?.minMatchRate ?? 0.9;
  const maxFalsePositiveRate =
    options.maxFalsePositiveRate ?? expected.stats?.maxFalsePositiveRate ?? 0.1;
  const minLocatedRate = options.minLocatedRate ?? expected.stats?.minLocatedRate ?? 0.9;
  return {
    matched: matched.length,
    expected: wanted.length,
    proposals: actual.length,
    matchRate,
    falsePositiveRate,
    locatedRate,
    located,
    passed:
      matchRate >= minMatchRate &&
      falsePositiveRate <= maxFalsePositiveRate &&
      locatedRate >= minLocatedRate &&
      mustNotHits.length === 0,
    mustNotHits,
    unmatchedExpected: wanted.flatMap((item, index) =>
      usedExpected.has(index) ? [] : [{ index, item }],
    ),
    unmatchedProposals: actual.flatMap((item, index) =>
      usedActual.has(index) ? [] : [{ index, item }],
    ),
    matches: matched,
  };
}
