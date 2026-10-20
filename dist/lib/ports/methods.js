/**
 * MethodRegistry — on-demand creative method assets (Contract 4.0 + skill rules).
 */
import { CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS, formatAssetForAgent, formatReaderContract as formatReaderContractText, getMethodAsset, getMethodAssets, listMethodAssets, METHOD_ASSET_IDS, } from "../method-assets.js";
export const MethodRegistry = {
    ids: METHOD_ASSET_IDS,
    briefDefaultIds: CHAPTER_BRIEF_ASSET_IDS,
    briefFullIds: CHAPTER_BRIEF_FULL_ASSET_IDS,
    list() {
        return listMethodAssets();
    },
    get(id) {
        return getMethodAsset(id);
    },
    getMany(ids) {
        return getMethodAssets(ids);
    },
    formatForAgent(asset) {
        return formatAssetForAgent(asset);
    },
    /** Default lean pack + extras; pass mode full for legacy four-pack. */
    resolveBriefAssets(extraIds = [], mode = "lean") {
        const base = mode === "full" ? CHAPTER_BRIEF_FULL_ASSET_IDS : CHAPTER_BRIEF_ASSET_IDS;
        return getMethodAssets([...base, ...extraIds]);
    },
    /** Top-of-brief「本书读者合同」. */
    formatReaderContract(input) {
        return formatReaderContractText(input);
    },
};
export { METHOD_ASSET_IDS, CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS };
