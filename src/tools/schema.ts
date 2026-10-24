/** JSON-schema helpers for zhizhang tool parameters (Chinese descriptions). */
export function S(description: any) {
    return { type: "string", description };
}
export function B(description: any) {
    return { type: "boolean", description };
}
export function I(description: any) {
    return { type: "integer", description };
}
export function E(values: any, description: any) {
    return { type: "string", enum: values, description };
}
export function O(properties: any, required: any = []) {
    return { type: "object", additionalProperties: false, properties, required };
}
// 两个可选参数注入 49+28 个工具 schema（合计约 23% 的注册面字符），
// 描述压到最短口径；语义不变：都可选、都有默认。
export const WORKING_DIR = S("可选：存储根（默认 <cwd>/.zhizhang/）");
export const WORK_OPT = S("可选：作品 key/标题（默认本会话最近作品）");
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
