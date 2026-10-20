/** On-disk + in-memory types for dsh-zhizhang. No Postgres. */
export const SCHEMA_VERSION = 1;
/** Five diagnostic evidence kinds for AI review *output* (agent-side; ledger stores them). */
export const REVIEW_EVIDENCE_KINDS = [
    "结构与锁定/伏笔咬合",
    "视角处境与注意力偏见",
    "亲历博弈充实度",
    "AI腔与心理偷懒诊断",
    "章末落点质感",
];
export const EMPTY_FOUNDATION = () => ({
    locks: "",
    happened: "",
    characters: "",
    readerKnowledge: "",
    planned: "",
    threads: "",
    style: "",
});
export const EMPTY_OUTLINE = () => ({
    pov: "",
    targetWords: 2500,
    locks: "",
    knowledge: "",
    synopsis: "",
    conflict: "",
    beats: "",
    ending: "",
    situationLens: "",
    livedScene: "",
    stateLens: "",
});
export const CHAPTER_STATUSES = [
    "planned",
    "drafting",
    "drafted",
    "reviewed",
    "final",
];
