import fs from "node:fs/promises";
import path from "node:path";
import { AppError } from "../errors/app-error.js";
import { classify } from "../errors/classify.js";
import { atomicWrite } from "../fs/atomic.js";
import { readTextIfExists } from "../fs/read.js";
import { resolveInside } from "../fs/sandbox.js";
import { stateSubpath } from "../paths.js";
const ALLOWED_ASSET_EXT = [".md", ".json"];
function assertSafeSegment(value, label) {
    const trimmed = value.trim();
    if (!trimmed || trimmed === "." || trimmed === ".." || /[\\/]/.test(trimmed)) {
        throw new AppError("input.invalid", `Invalid ${label}: ${value}`, { label, value });
    }
    return trimmed;
}
function assertAllowedAssetFile(fileName) {
    const clean = assertSafeSegment(fileName, "asset filename");
    if (!ALLOWED_ASSET_EXT.some((ext) => clean.endsWith(ext))) {
        throw new AppError("input.invalid", `Unsupported method asset extension: ${fileName}`, {
            fileName,
        });
    }
    return clean;
}
export function resolveUserProfilesDir(env) {
    return stateSubpath("profiles", env);
}
async function readProfileInfo(dir, mode, id) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    const files = [];
    let name = id;
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        if (!ALLOWED_ASSET_EXT.some((ext) => entry.name.endsWith(ext)))
            continue;
        files.push(entry.name);
        if (entry.name === "profile.json") {
            const raw = await readTextIfExists(path.join(dir, entry.name));
            if (raw) {
                const meta = JSON.parse(raw);
                if (meta.name)
                    name = meta.name;
            }
        }
    }
    files.sort();
    return { mode, id, name, files, dir };
}
export async function listUserProfiles(userDir, mode) {
    const modes = [];
    if (mode) {
        modes.push(assertSafeSegment(mode, "mode"));
    }
    else {
        const entries = await fs.readdir(userDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries) {
            if (entry.isDirectory())
                modes.push(entry.name);
        }
    }
    const results = [];
    for (const m of modes.sort()) {
        const modeDir = resolveInside(userDir, m);
        const entries = await fs.readdir(modeDir, { withFileTypes: true }).catch(() => []);
        for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
            if (!entry.isDirectory())
                continue;
            const profileDir = resolveInside(modeDir, entry.name);
            results.push(await readProfileInfo(profileDir, m, entry.name));
        }
    }
    return results;
}
export async function readUserAssetFile(userDir, mode, profileId, fileName) {
    const safeMode = assertSafeSegment(mode, "mode");
    const safeId = assertSafeSegment(profileId, "profileId");
    const safeFile = assertAllowedAssetFile(fileName);
    const target = resolveInside(userDir, path.join(safeMode, safeId, safeFile));
    return readTextIfExists(target);
}
export async function saveUserAssetFile(userDir, mode, profileId, fileName, content) {
    const safeMode = assertSafeSegment(mode, "mode");
    const safeId = assertSafeSegment(profileId, "profileId");
    const safeFile = assertAllowedAssetFile(fileName);
    const target = resolveInside(userDir, path.join(safeMode, safeId, safeFile));
    await atomicWrite(target, content);
    return target;
}
export async function deleteUserAssetFile(userDir, mode, profileId, fileName) {
    const safeMode = assertSafeSegment(mode, "mode");
    const safeId = assertSafeSegment(profileId, "profileId");
    const safeFile = assertAllowedAssetFile(fileName);
    const target = resolveInside(userDir, path.join(safeMode, safeId, safeFile));
    try {
        await fs.rm(target);
        return true;
    }
    catch (err) {
        const code = err.code;
        if (code === "ENOENT")
            return false;
        throw classify(err);
    }
}
export async function forkBuiltinProfile(roots, mode, sourceId, targetId, name) {
    if (!roots.userDir) {
        throw new AppError("input.invalid", "userDir is required to fork a profile", { mode, sourceId });
    }
    const safeMode = assertSafeSegment(mode, "mode");
    const safeSource = assertSafeSegment(sourceId, "sourceId");
    const safeTarget = assertSafeSegment(targetId, "targetId");
    const srcDir = resolveInside(roots.builtinDir, safeSource);
    const stat = await fs.stat(srcDir).catch(() => undefined);
    if (!stat?.isDirectory()) {
        throw new AppError("input.not_found", `Builtin profile not found: ${safeSource}`, {
            mode: safeMode,
            sourceId: safeSource,
        });
    }
    const destDir = resolveInside(roots.userDir, path.join(safeMode, safeTarget));
    const entries = await fs.readdir(srcDir, { withFileTypes: true });
    let hasProfileJson = false;
    for (const entry of entries) {
        if (!entry.isFile())
            continue;
        if (!ALLOWED_ASSET_EXT.some((ext) => entry.name.endsWith(ext)))
            continue;
        let content = await fs.readFile(path.join(srcDir, entry.name), "utf8");
        if (entry.name === "profile.json") {
            hasProfileJson = true;
            if (name) {
                const meta = JSON.parse(content);
                content = `${JSON.stringify({ ...meta, id: safeTarget, name }, null, 2)}\n`;
            }
        }
        await atomicWrite(path.join(destDir, entry.name), content);
    }
    if (!hasProfileJson && name) {
        await atomicWrite(path.join(destDir, "profile.json"), `${JSON.stringify({ id: safeTarget, name }, null, 2)}\n`);
    }
    return readProfileInfo(destDir, safeMode, safeTarget);
}
