/**
 * 报告节清单 — 唯一来源。
 * buildReport 按这个数组生成 `## N. 标题`；文档/工具描述只引用 REPORT_SECTION_COUNT。
 */
export const REPORT_SECTIONS = [
    { n: 1, title: "基本信息" },
    { n: 2, title: "读者承诺" },
    { n: 3, title: "黄金三章" },
    { n: 4, title: "开篇判断" },
    { n: 5, title: "结构骨架" },
    { n: 6, title: "剧情条" },
    { n: 7, title: "情绪节奏" },
    { n: 8, title: "爽点循环" },
    { n: 9, title: "断章钩子" },
    { n: 10, title: "伏笔地图" },
    { n: 11, title: "人物弧光" },
    { n: 12, title: "群像功能" },
    { n: 13, title: "文字定量" },
    { n: 14, title: "机制卡" },
    { n: 15, title: "可复现模块" },
    { n: 16, title: "不可照搬" },
    { n: 17, title: "对标建议" },
    { n: 18, title: "备注" },
    { n: 19, title: "结论与下一步" },
];
export const REPORT_SECTION_COUNT = REPORT_SECTIONS.length;
