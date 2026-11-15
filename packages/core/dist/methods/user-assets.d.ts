import type { ProfileRoots } from "./profiles.js";
export interface UserAssetInfo {
    mode: string;
    id: string;
    name: string;
    files: string[];
    dir: string;
}
export declare function resolveUserProfilesDir(env?: NodeJS.ProcessEnv): string;
export declare function listUserProfiles(userDir: string, mode?: string): Promise<UserAssetInfo[]>;
export declare function readUserAssetFile(userDir: string, mode: string, profileId: string, fileName: string): Promise<string | undefined>;
export declare function saveUserAssetFile(userDir: string, mode: string, profileId: string, fileName: string, content: string): Promise<string>;
export declare function deleteUserAssetFile(userDir: string, mode: string, profileId: string, fileName: string): Promise<boolean>;
export declare function forkBuiltinProfile(roots: ProfileRoots, mode: string, sourceId: string, targetId: string, name?: string): Promise<UserAssetInfo>;
//# sourceMappingURL=user-assets.d.ts.map