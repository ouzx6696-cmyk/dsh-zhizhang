/**
 * MethodRegistry — on-demand creative method assets (Contract 4.0 + skill rules).
 */
import { CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS, METHOD_ASSET_IDS, type MethodAsset, type ReaderContractInput } from "../method-assets.js";
export declare const MethodRegistry: {
    ids: readonly string[];
    briefDefaultIds: readonly string[];
    briefFullIds: readonly string[];
    list(): Pick<MethodAsset, "id" | "title" | "whenToUse">[];
    get(id: string): MethodAsset | undefined;
    getMany(ids: string[]): {
        found: MethodAsset[];
        missing: string[];
    };
    formatForAgent(asset: MethodAsset): string;
    /** Default lean pack + extras; pass mode full for legacy four-pack. */
    resolveBriefAssets(extraIds?: string[], mode?: "lean" | "full"): {
        found: MethodAsset[];
        missing: string[];
    };
    /** Top-of-brief「本书读者合同」. */
    formatReaderContract(input: ReaderContractInput): string;
};
export type { MethodAsset, ReaderContractInput };
export { METHOD_ASSET_IDS, CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS };
