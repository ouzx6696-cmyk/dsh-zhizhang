import { type LockService } from "@zhizhang/core/lock";
import { type Infer } from "@zhizhang/core/schema";
import type { TechniqueCard } from "../pipelines/dissect/index.js";
declare const LibrarySourceMetaSchema: import("@zhizhang/core/schema").Parser<{
    id: string;
    title: string;
    importedAt: string;
    chars: string;
}>;
export type LibrarySourceMeta = Infer<typeof LibrarySourceMetaSchema>;
export interface LibrarySourceSummary {
    id: string;
    title: string;
    importedAt: string;
    hasReport: boolean;
    cardCount: number;
}
export declare function importLibrarySource(libraryRoot: string, input: {
    id: string;
    title: string;
    content: string;
}, lock?: LockService): Promise<LibrarySourceMeta>;
export declare function listLibrarySources(libraryRoot: string): Promise<LibrarySourceSummary[]>;
export declare function readLibraryCards(libraryRoot: string, sourceId: string): Promise<{
    cards: TechniqueCard[];
    report?: string;
}>;
export {};
//# sourceMappingURL=library.d.ts.map