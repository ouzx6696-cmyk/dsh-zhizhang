export const COMMON_COPY = {
    "app.name": "织章",
    loading: "正在载入写作台…",
    forbiddenHint: "当前操作无权限。请检查作品是否只读，以及是否已完成作者确认。",
    rateLimitedHint: "请求过于频繁，稍后会自动重试。",
    retry: "重试",
    refresh: "刷新",
    updatedAt: "{time} 更新",
    cancel: "取消",
    close: "关闭",
    more: "展开全部",
    details: "查看详情",
    less: "收起",
    accept: "采纳",
    notices: "通知",
    confirmDialogText1: "确认操作",
    confirmDialogText2: "继续",
    designPreviewText1: "夜灯 · 组件预览",
    designPreviewText2: "示例数据，仅用于开发时核对控件与文字。",
    designPreviewText3: "写作的决定",
    designPreviewText4: "派编辑审读",
    designPreviewText5: "保存中",
    designPreviewText6: "删除",
    designPreviewText7: "进度与状态",
    designPreviewText8: "审读",
    designPreviewText9: "初稿待改",
    designPreviewText10: "编辑沿用写手连接",
    designPreviewText11: "示例数值",
    designPreviewText12: "第三章 · 雨夜",
    designPreviewText13: "林川把车票放进大衣口袋。窗外的雨细了，站台尽头传来最后一班车的声音。",
};
export const UNLOAD_COPY = {
    title: "未保存的修改",
    message: "有未保存的修改，仍要关闭？",
    detail: "离开会放弃编辑器里尚未保存的修改。",
    stay: "留下",
    leave: "离开",
};
export const CRASH_COPY = {
    title: "界面出错了",
    hint: "作品文件不受影响。重新加载窗口后可继续；已暂存的未保存修改会在再次打开编辑器时提示恢复。",
    reload: "重新加载窗口",
    rejected: "后台操作失败：",
};
export const PROJECT_INDEX_FAILED = "项目列表暂时读不到，已按默认目录打开：";
export function formatCount(n) {
    const value = Number(n);
    return Number.isFinite(value) ? value.toLocaleString("zh-CN") : "0";
}
export function formatTokens(usage) {
    if (!usage)
        return "—";
    const input = (usage.input ?? 0) + (usage.cacheRead ?? 0) + (usage.cacheWrite ?? 0);
    return `输入 ${formatCount(input)} · 输出 ${formatCount(usage.output ?? 0)} tokens`;
}
export function formatCost(cost) {
    return typeof cost === "number" && Number.isFinite(cost) ? `$${cost.toFixed(4)}` : "费用未知";
}
export function formatElapsed(ms) {
    const seconds = Math.max(0, Math.floor(ms / 1000));
    return seconds < 60
        ? `${seconds}s`
        : `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}
export function formatClock(iso) {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime()))
        return "";
    return date.toLocaleTimeString("zh-CN", { hour12: false });
}
export function formatDateTime(iso) {
    const date = iso ? new Date(iso) : null;
    if (!date || Number.isNaN(date.getTime()))
        return "";
    const pad = (value) => String(value).padStart(2, "0");
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`;
}
export function taskEndCopy(reason, error) {
    if (reason === "failed")
        return `任务失败：${error || "请查看错误后重试"}`;
    if (reason === "cancelled")
        return "任务已停止，已保存结果保留";
    return "写作任务已结束，等待你查看稿件与回报。";
}
export function formatBytes(n) {
    const value = Number(n) || 0;
    if (value >= 1024 * 1024)
        return (value / (1024 * 1024)).toFixed(1) + " MB";
    return Math.max(1, Math.round(value / 1024)) + " KB";
}
export function chapterName(chapters, id) {
    const index = chapters.findIndex((chapter) => chapter.id === id);
    return index < 0
        ? "相关章节"
        : `第 ${index + 1} 章${chapters[index].title ? `《${chapters[index].title}》` : ""}`;
}
