import React from "react";
import { type DialogProps, type EmptyProps, type KbdProps, type NoticeProps, type ProgressRailProps, type SkeletonProps, type SpinnerProps, type StatusChipProps, type TagProps } from "./types.js";
export declare function Dialog({ open, title, description, size, closeLabel, footer, className, onClose, children, }: DialogProps): React.JSX.Element;
export declare function Tag({ label, tone, removable, className, onRemove, }: TagProps): React.JSX.Element;
export declare function StatusChip({ tone, label, dot, className }: StatusChipProps): React.JSX.Element;
export declare function Notice({ tone, variant, message, detail, actionLabel, onAction, onClose, className, }: NoticeProps): React.JSX.Element;
export declare function Empty({ title, description, icon, action, className }: EmptyProps): React.JSX.Element;
export declare function Skeleton({ variant, width, height, lines, className, }: SkeletonProps): React.JSX.Element;
export declare function Spinner({ size, label, className }: SpinnerProps): React.JSX.Element;
export declare function ProgressRail({ steps, current, label, className }: ProgressRailProps): React.JSX.Element;
export declare function Kbd({ keys, className }: KbdProps): React.JSX.Element;
//# sourceMappingURL=feedback.d.ts.map