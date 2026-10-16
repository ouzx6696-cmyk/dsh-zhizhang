/**
 * MethodRegistry — on-demand creative method assets (Contract 4.0 + skill rules).
 */
import {
  CHAPTER_BRIEF_ASSET_IDS,
  CHAPTER_BRIEF_FULL_ASSET_IDS,
  formatAssetForAgent,
  formatReaderContract as formatReaderContractText,
  getMethodAsset,
  getMethodAssets,
  listMethodAssets,
  METHOD_ASSET_IDS,
  type MethodAsset,
  type ReaderContractInput,
} from "../method-assets.js";

export const MethodRegistry = {
  ids: METHOD_ASSET_IDS,
  briefDefaultIds: CHAPTER_BRIEF_ASSET_IDS as readonly string[],
  briefFullIds: CHAPTER_BRIEF_FULL_ASSET_IDS as readonly string[],

  list() {
    return listMethodAssets();
  },

  get(id: string): MethodAsset | undefined {
    return getMethodAsset(id);
  },

  getMany(ids: string[]) {
    return getMethodAssets(ids);
  },

  formatForAgent(asset: MethodAsset): string {
    return formatAssetForAgent(asset);
  },

  /** Default lean pack + extras; pass mode full for legacy four-pack. */
  resolveBriefAssets(extraIds: string[] = [], mode: "lean" | "full" = "lean") {
    const base =
      mode === "full" ? CHAPTER_BRIEF_FULL_ASSET_IDS : CHAPTER_BRIEF_ASSET_IDS;
    return getMethodAssets([...base, ...extraIds]);
  },

  /** Top-of-brief「本书读者合同」. */
  formatReaderContract(input: ReaderContractInput): string {
    return formatReaderContractText(input);
  },
};

export type { MethodAsset, ReaderContractInput };
export { METHOD_ASSET_IDS, CHAPTER_BRIEF_ASSET_IDS, CHAPTER_BRIEF_FULL_ASSET_IDS };
