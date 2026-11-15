export interface StageTakeRule {
    file: string;
    sections?: string[];
    maxChars?: number;
}
export type StageMap = Record<string, {
    take: StageTakeRule[];
}>;
export interface Profile {
    id: string;
    name: string;
    mode: string;
    files: Record<string, string>;
    stageMap: StageMap;
    hash: string;
}
export declare function methodFor(profile: Profile, stage: string): {
    text: string;
    hash: string;
    omitted: string[];
};
//# sourceMappingURL=stage-map.d.ts.map