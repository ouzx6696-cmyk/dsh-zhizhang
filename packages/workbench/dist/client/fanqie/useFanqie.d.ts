export declare function useFanqie(workPath?: string): {
    state: import("./state.js").FanqieState;
    view: import("./state.js").FanqieDerived;
    dispatch: import("react").ActionDispatch<[action: import("./state.js").FanqieAction]>;
    refresh: () => Promise<void>;
    saveChapter: (body: string, base: string) => Promise<void>;
    finalizeChapter: (chapterId: string) => Promise<void>;
    acceptCandidate: (chapterId: string, candidateId: string, base: string) => Promise<void>;
};
//# sourceMappingURL=useFanqie.d.ts.map