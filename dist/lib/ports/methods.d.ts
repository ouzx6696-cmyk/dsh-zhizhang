/**
 * MethodRegistry — on-demand creative method assets (Contract 4.0 + skill rules).
 */
import { CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS, METHOD_ASSET_IDS } from "../method-assets.js";
export declare const MethodRegistry: {
    ids: any[];
    briefDefaultIds: string[];
    briefFullIds: string[];
    list(): {
        id: string;
        title: string;
        whenToUse: string;
    }[];
    get(id: string): any;
    getMany(ids: any): {
        found: any[];
        missing: string[];
    };
    formatForAgent(asset: any): string;
    /** Default lean pack + extras; pass mode full for legacy four-pack. */
    resolveBriefAssets(extraIds?: any, mode?: any): {
        found: any[];
        missing: string[];
    };
    /** Top-of-brief「本书读者合同」. */
    formatReaderContract(input: any): string;
};
export { METHOD_ASSET_IDS, CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS };
