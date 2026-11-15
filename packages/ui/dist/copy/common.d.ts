export declare const COMMON_COPY: {
    readonly "app.name": "织章";
    readonly loading: "正在载入写作台…";
    readonly forbiddenHint: "当前操作无权限。请检查作品是否只读，以及是否已完成作者确认。";
    readonly rateLimitedHint: "请求过于频繁，稍后会自动重试。";
    readonly retry: "重试";
    readonly refresh: "刷新";
    readonly updatedAt: "{time} 更新";
    readonly cancel: "取消";
    readonly close: "关闭";
    readonly more: "展开全部";
    readonly details: "查看详情";
    readonly less: "收起";
    readonly accept: "采纳";
    readonly notices: "通知";
    readonly confirmDialogText1: "确认操作";
    readonly confirmDialogText2: "继续";
    readonly designPreviewText1: "夜灯 · 组件预览";
    readonly designPreviewText2: "示例数据，仅用于开发时核对控件与文字。";
    readonly designPreviewText3: "写作的决定";
    readonly designPreviewText4: "派编辑审读";
    readonly designPreviewText5: "保存中";
    readonly designPreviewText6: "删除";
    readonly designPreviewText7: "进度与状态";
    readonly designPreviewText8: "审读";
    readonly designPreviewText9: "初稿待改";
    readonly designPreviewText10: "编辑沿用写手连接";
    readonly designPreviewText11: "示例数值";
    readonly designPreviewText12: "第三章 · 雨夜";
    readonly designPreviewText13: "林川把车票放进大衣口袋。窗外的雨细了，站台尽头传来最后一班车的声音。";
};
export declare const UNLOAD_COPY: {
    readonly title: "未保存的修改";
    readonly message: "有未保存的修改，仍要关闭？";
    readonly detail: "离开会放弃编辑器里尚未保存的修改。";
    readonly stay: "留下";
    readonly leave: "离开";
};
export declare const CRASH_COPY: {
    readonly title: "界面出错了";
    readonly hint: "作品文件不受影响。重新加载窗口后可继续；已暂存的未保存修改会在再次打开编辑器时提示恢复。";
    readonly reload: "重新加载窗口";
    readonly rejected: "后台操作失败：";
};
export declare const PROJECT_INDEX_FAILED = "\u9879\u76EE\u5217\u8868\u6682\u65F6\u8BFB\u4E0D\u5230\uFF0C\u5DF2\u6309\u9ED8\u8BA4\u76EE\u5F55\u6253\u5F00\uFF1A";
export declare function formatCount(n: unknown): string;
type TokenUsage = {
    input?: number;
    output?: number;
    cacheRead?: number;
    cacheWrite?: number;
};
export declare function formatTokens(usage: TokenUsage | undefined): string;
export declare function formatCost(cost: number | null | undefined): string;
export declare function formatElapsed(ms: number): string;
export declare function formatClock(iso?: string): string;
export declare function formatDateTime(iso?: string): string;
export declare function taskEndCopy(reason: string | undefined, error?: string): string;
export declare function formatBytes(n: unknown): string;
export declare function chapterName(chapters: {
    id: string;
    title?: string;
}[], id: string): string;
export {};
//# sourceMappingURL=common.d.ts.map