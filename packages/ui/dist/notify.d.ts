import React from "react";
import "./styles/notify.css";
export type NoticeTone = "success" | "info" | "warning" | "danger";
export interface NoticeAction {
    label: string;
    run: () => unknown;
}
export interface NoticeInput {
    tone: NoticeTone;
    text: string;
    /** 折叠在“查看详情”里的长说明；不给时取 text 第一行之后的内容。 */
    detail?: string;
    /** 就近的恢复动作，例如“重试”；执行后这条提示自动收起。 */
    action?: NoticeAction;
}
/**
 * 全应用唯一的提示队列：同样的提示只留最新一条；错误与警告、成功与信息两个分区各自最多五条，
 * 超出时只淘汰本分区最旧的一条。
 */
export declare function notify(input: NoticeInput): number;
export declare function dismissNotice(id: number): void;
/** 收起某一类提示，例如作者重新发起任务时旧的错误已不再适用。 */
export declare function dismissNotices(tone: NoticeTone): void;
/**
 * 提示栈：挂一次即可。两个分区常驻 DOM，读屏才能可靠播报后插入的内容：
 * 错误与警告进 role=alert，成功与信息进 role=status。
 */
export declare function NoticeStack({ label }: {
    label: string;
}): React.JSX.Element;
//# sourceMappingURL=notify.d.ts.map