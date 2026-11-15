import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { SemanticTone } from "../tokens/tokens.js";
export declare function cx(...parts: Array<string | false | null | undefined>): string;
export declare function toneClass(tone: SemanticTone): string;
export type ButtonVariant = "primary" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";
export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    variant?: ButtonVariant;
    size?: ButtonSize;
    loading?: boolean;
    children?: ReactNode;
}
export declare function buttonClasses(options?: Pick<ButtonProps, "variant" | "size" | "className">): string;
export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
    label: string;
    variant?: ButtonVariant;
    size?: ButtonSize;
    pressed?: boolean;
    icon?: ReactNode;
    children?: ReactNode;
}
export declare function iconButtonClasses(options?: Pick<IconButtonProps, "variant" | "size" | "className">): string;
export type DialogSize = "sm" | "md" | "lg" | "full";
export interface DialogProps {
    open?: boolean;
    title: string;
    description?: ReactNode;
    size?: DialogSize;
    closeLabel?: string;
    footer?: ReactNode;
    className?: string;
    onClose: () => void;
    children?: ReactNode;
}
export declare function dialogClasses(options?: Pick<DialogProps, "size" | "className">): string;
export type TabOrientation = "horizontal" | "vertical";
export interface TabItem {
    id: string;
    label: ReactNode;
    disabled?: boolean;
    badge?: ReactNode;
}
export interface TabsProps {
    id: string;
    label: string;
    items: TabItem[];
    value: string;
    orientation?: TabOrientation;
    className?: string;
    onChange: (tab: string) => void;
}
export declare function tabId(base: string, tab: string): string;
export declare function tabPanelId(base: string, tab: string): string;
export declare function tabPanelProps(base: string, tab: string, value: string): {
    readonly id: string;
    readonly role: "tabpanel";
    readonly "aria-labelledby": string;
    readonly hidden: boolean;
};
export declare function tabsClasses(options?: Pick<TabsProps, "orientation" | "className">): string;
export interface SegmentedOption<T extends string = string> {
    value: T;
    label: ReactNode;
    disabled?: boolean;
}
export interface SegmentedProps<T extends string = string> {
    label?: string;
    options: SegmentedOption<T>[];
    value: T;
    size?: "sm" | "md";
    className?: string;
    onChange: (value: T) => void;
}
export declare function segmentedClasses(options?: Pick<SegmentedProps, "size" | "className">): string;
export interface CheckboxProps {
    label: ReactNode;
    checked: boolean;
    indeterminate?: boolean;
    disabled?: boolean;
    description?: ReactNode;
    className?: string;
    onChange: (checked: boolean) => void;
}
export declare function checkboxClasses(options?: Pick<CheckboxProps, "disabled" | "className">): string;
export interface ToggleProps {
    label: ReactNode;
    checked: boolean;
    disabled?: boolean;
    description?: ReactNode;
    className?: string;
    onChange: (checked: boolean) => void;
}
export declare function toggleClasses(options?: Pick<ToggleProps, "disabled" | "className">): string;
export interface FieldProps {
    id?: string;
    label: ReactNode;
    hint?: ReactNode;
    error?: ReactNode;
    required?: boolean;
    className?: string;
    children?: ReactNode;
}
export declare function fieldClasses(options?: Pick<FieldProps, "error" | "className">): string;
export interface SelectOption<T extends string = string> {
    value: T;
    label: string;
    disabled?: boolean;
}
export interface SelectProps<T extends string = string> {
    id?: string;
    label?: string;
    options: SelectOption<T>[];
    value: T;
    placeholder?: string;
    disabled?: boolean;
    className?: string;
    onChange: (value: T) => void;
}
export declare function selectClasses(options?: Pick<SelectProps, "disabled" | "className">): string;
export interface TagProps {
    label: ReactNode;
    tone?: SemanticTone;
    removable?: boolean;
    className?: string;
    onRemove?: () => void;
}
export declare function tagClasses(options?: Pick<TagProps, "tone" | "className">): string;
export interface StatusChipProps {
    tone: SemanticTone;
    label: string;
    dot?: boolean;
    className?: string;
}
export declare function statusChipClasses(options: Pick<StatusChipProps, "tone" | "className">): string;
export type NoticeTone = Exclude<SemanticTone, "decide" | "run">;
export type NoticeVariant = "inline" | "banner" | "toast";
export interface NoticeProps {
    tone: NoticeTone;
    variant?: NoticeVariant;
    message: string;
    detail?: string;
    actionLabel?: string;
    onAction?: () => void;
    onClose?: () => void;
    className?: string;
}
export declare function noticeClasses(options: Pick<NoticeProps, "tone" | "variant" | "className">): string;
export interface EmptyProps {
    title: ReactNode;
    description?: ReactNode;
    icon?: ReactNode;
    action?: ReactNode;
    className?: string;
}
export declare function emptyClasses(options?: Pick<EmptyProps, "className">): string;
export type SkeletonVariant = "text" | "rect" | "circle";
export interface SkeletonProps {
    variant?: SkeletonVariant;
    width?: string | number;
    height?: string | number;
    lines?: number;
    className?: string;
}
export declare function skeletonClasses(options?: Pick<SkeletonProps, "variant" | "className">): string;
export type SpinnerSize = "sm" | "md" | "lg";
export interface SpinnerProps {
    size?: SpinnerSize;
    label?: string;
    className?: string;
}
export declare function spinnerClasses(options?: Pick<SpinnerProps, "size" | "className">): string;
export type ProgressStepState = "done" | "current" | "todo";
export interface ProgressStep {
    id: string;
    label: string;
    description?: string;
}
export interface ProgressRailProps {
    steps: ProgressStep[] | string[];
    current: number;
    label?: string;
    className?: string;
}
export declare function progressStepState(index: number, current: number): ProgressStepState;
export declare function progressRailClasses(options?: Pick<ProgressRailProps, "className">): string;
export interface KbdProps {
    keys: string | string[];
    className?: string;
}
export declare function kbdClasses(options?: Pick<KbdProps, "className">): string;
export interface MenuItem {
    id: string;
    label: ReactNode;
    shortcut?: string;
    danger?: boolean;
    disabled?: boolean;
    separator?: boolean;
    onSelect?: () => void;
}
export interface MenuProps {
    label: string;
    items: MenuItem[];
    open?: boolean;
    className?: string;
    onClose?: () => void;
}
export declare function menuClasses(options?: Pick<MenuProps, "open" | "className">): string;
export interface BrandProps {
    label?: string;
    className?: string;
    children?: ReactNode;
}
export interface CardProps {
    title?: ReactNode;
    description?: ReactNode;
    footer?: ReactNode;
    className?: string;
    children?: ReactNode;
}
export interface StatProps {
    label: ReactNode;
    value: ReactNode;
    detail?: ReactNode;
    className?: string;
}
export interface StepsProps {
    steps: Array<ProgressStep | string>;
    current: number;
    label?: string;
    className?: string;
}
//# sourceMappingURL=types.d.ts.map