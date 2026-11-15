import type { Profile } from "./stage-map.js";
export interface ProfileRoots {
    builtinDir: string;
    userDir?: string;
}
export declare function loadProfile(mode: string, id: string, roots: ProfileRoots): Promise<Profile>;
//# sourceMappingURL=profiles.d.ts.map