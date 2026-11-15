export declare const PREF: {
    readonly project: "lastProject";
    readonly work: "lastWork";
    readonly chapter: "lastChapter";
    readonly candidate: "lastCandidate";
    readonly view: "fanqieView";
    readonly tab: "pipelineTab";
    readonly readerView: "readerView";
    readonly fontStep: "fontStep";
    readonly ttRoot: "toutiaoRoot";
    readonly ttArticle: "toutiaoArticle";
    readonly agentDraft: "agentDraft:";
};
export declare function readPref(key: string, fallback?: string): string;
export declare function writePref(key: string, value: unknown): void;
/** Constrain a stored value to an allowed set. */
export declare function oneOf<T extends string>(value: string, allowed: readonly T[], fallback: T): T;
//# sourceMappingURL=prefs.d.ts.map