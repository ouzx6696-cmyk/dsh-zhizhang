/** JSON-schema helpers for zhizhang tool parameters (Chinese descriptions). */
export function S(description) {
    return { type: "string", description };
}
export function B(description) {
    return { type: "boolean", description };
}
export function I(description) {
    return { type: "integer", description };
}
export function E(values, description) {
    return { type: "string", enum: values, description };
}
export function O(properties, required = []) {
    return { type: "object", additionalProperties: false, properties, required };
}
export const WORKING_DIR = S("可选：织章存储根（绝对路径或相对会话 cwd）。默认 <cwd>/.zhizhang/");
export const WORK_OPT = S("可选：作品 key 或标题；省略时用本会话最近操作的作品");
export const OUTLINE_PROPS = {
    pov: S("视角人物与限知范围"),
    targetWords: I("本章目标字数"),
    locks: S("本章不得违背的锁定"),
    knowledge: S("读者/人物此刻知情范围"),
    synopsis: S("自由概要/章纲正文"),
    conflict: S("核心冲突"),
    beats: S("节拍"),
    ending: S("章末具体落点（人/事/声/器）"),
    situationLens: S("观察者处境与注意力偏见"),
    livedScene: S("亲历博弈重心 vs 概览节拍"),
    stateLens: S("本章角色状态/写法取舍透镜（非角色声纹）"),
};
