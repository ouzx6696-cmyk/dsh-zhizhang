import type { ButtonHTMLAttributes, ReactNode } from "react";
import type { SemanticTone } from "../tokens/tokens.js";

export function cx(...parts: Array<string | false | null | undefined>): string {
  return parts.filter(Boolean).join(" ");
}

export function toneClass(tone: SemanticTone): string {
  return `zz-tone-${tone}`;
}

/** primary = 琥珀（只给拍板）；strong = 墨色实底（编辑态保存等常用但非拍板的主操作）。 */
export type ButtonVariant = "primary" | "strong" | "secondary" | "ghost" | "danger";
export type ButtonSize = "sm" | "md" | "lg";

export interface ButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  variant?: ButtonVariant;
  size?: ButtonSize;
  loading?: boolean;
  children?: ReactNode;
}

export function buttonClasses(
  options: Pick<ButtonProps, "variant" | "size" | "className"> = {},
): string {
  const { variant = "secondary", size = "md", className } = options;
  return cx("zz-btn", `zz-btn--${variant}`, `zz-btn--${size}`, className);
}

export interface IconButtonProps extends Omit<ButtonHTMLAttributes<HTMLButtonElement>, "children"> {
  label: string;
  variant?: ButtonVariant;
  size?: ButtonSize;
  pressed?: boolean;
  icon?: ReactNode;
  children?: ReactNode;
}

export function iconButtonClasses(
  options: Pick<IconButtonProps, "variant" | "size" | "className"> = {},
): string {
  const { variant = "ghost", size = "md", className } = options;
  return cx("zz-icon-btn", `zz-btn--${variant}`, `zz-icon-btn--${size}`, className);
}

export type DialogSize = "sm" | "md" | "lg" | "full";

export interface DialogProps {
  /** 端到端测试用的稳定选择器（渲染为 data-testid）。 */
  testId?: string;
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

export function dialogClasses(options: Pick<DialogProps, "size" | "className"> = {}): string {
  const { size = "md", className } = options;
  return cx("zz-dialog", `zz-dialog--${size}`, className);
}

export type TabOrientation = "horizontal" | "vertical";

export interface TabItem {
  id: string;
  label: ReactNode;
  disabled?: boolean;
  badge?: ReactNode;
}

export interface TabsProps {
  /** 端到端测试用的稳定选择器（渲染为 data-testid）。 */
  testId?: string;
  id: string;
  label: string;
  items: TabItem[];
  value: string;
  orientation?: TabOrientation;
  className?: string;
  onChange: (tab: string) => void;
}

export function tabId(base: string, tab: string): string {
  return `${base}-tab-${tab}`;
}

export function tabPanelId(base: string, tab: string): string {
  return `${base}-panel-${tab}`;
}

export function tabPanelProps(base: string, tab: string, value: string) {
  return {
    id: tabPanelId(base, tab),
    role: "tabpanel",
    "aria-labelledby": tabId(base, tab),
    hidden: tab !== value,
  } as const;
}

export function tabsClasses(options: Pick<TabsProps, "orientation" | "className"> = {}): string {
  const { orientation = "horizontal", className } = options;
  return cx("zz-tabs", `zz-tabs--${orientation}`, className);
}

export interface SegmentedOption<T extends string = string> {
  value: T;
  label: ReactNode;
  disabled?: boolean;
}

export interface SegmentedProps<T extends string = string> {
  /** 端到端测试用的稳定选择器（渲染为 data-testid）。 */
  testId?: string;
  label?: string;
  options: SegmentedOption<T>[];
  value: T;
  size?: "sm" | "md";
  className?: string;
  onChange: (value: T) => void;
}

export function segmentedClasses(options: Pick<SegmentedProps, "size" | "className"> = {}): string {
  const { size = "md", className } = options;
  return cx("zz-segmented", `zz-segmented--${size}`, className);
}

export interface CheckboxProps {
  /** 端到端测试用的稳定选择器（渲染为 data-testid）。 */
  testId?: string;
  label: ReactNode;
  checked: boolean;
  indeterminate?: boolean;
  disabled?: boolean;
  description?: ReactNode;
  className?: string;
  onChange: (checked: boolean) => void;
}

export function checkboxClasses(
  options: Pick<CheckboxProps, "disabled" | "className"> = {},
): string {
  return cx("zz-checkbox", options.disabled && "zz-is-disabled", options.className);
}

export interface ToggleProps {
  /** 端到端测试用的稳定选择器（渲染为 data-testid）。 */
  testId?: string;
  label: ReactNode;
  checked: boolean;
  disabled?: boolean;
  description?: ReactNode;
  className?: string;
  onChange: (checked: boolean) => void;
}

export function toggleClasses(options: Pick<ToggleProps, "disabled" | "className"> = {}): string {
  return cx("zz-toggle", options.disabled && "zz-is-disabled", options.className);
}

export interface FieldProps {
  id?: string;
  label: ReactNode;
  hint?: ReactNode;
  error?: ReactNode;
  required?: boolean;
  className?: string;
  children?: ReactNode;
}

export function fieldClasses(options: Pick<FieldProps, "error" | "className"> = {}): string {
  return cx("zz-field", Boolean(options.error) && "zz-field--error", options.className);
}

export interface SelectOption<T extends string = string> {
  value: T;
  label: string;
  disabled?: boolean;
}

export interface SelectProps<T extends string = string> {
  /** 端到端测试用的稳定选择器（渲染为 data-testid）。 */
  testId?: string;
  id?: string;
  label?: string;
  options: SelectOption<T>[];
  value: T;
  placeholder?: string;
  disabled?: boolean;
  className?: string;
  onChange: (value: T) => void;
}

export function selectClasses(options: Pick<SelectProps, "disabled" | "className"> = {}): string {
  return cx("zz-select", options.disabled && "zz-is-disabled", options.className);
}

export interface TagProps {
  label: ReactNode;
  tone?: SemanticTone;
  removable?: boolean;
  className?: string;
  onRemove?: () => void;
}

export function tagClasses(options: Pick<TagProps, "tone" | "className"> = {}): string {
  const { tone = "neutral", className } = options;
  return cx("zz-tag", toneClass(tone), className);
}

export interface StatusChipProps {
  tone: SemanticTone;
  label: string;
  dot?: boolean;
  className?: string;
}

export function statusChipClasses(options: Pick<StatusChipProps, "tone" | "className">): string {
  return cx("zz-status-chip", toneClass(options.tone), options.className);
}

export type NoticeTone = Exclude<SemanticTone, "decide" | "run">;
export type NoticeVariant = "inline" | "banner" | "toast";

export interface NoticeProps {
  tone: NoticeTone;
  variant?: NoticeVariant;
  message: ReactNode;
  detail?: string;
  actionLabel?: string;
  onAction?: () => void;
  onClose?: () => void;
  className?: string;
}

export function noticeClasses(
  options: Pick<NoticeProps, "tone" | "variant" | "className">,
): string {
  const { tone, variant = "inline", className } = options;
  return cx("zz-notice", `zz-notice--${variant}`, toneClass(tone), className);
}

export interface EmptyProps {
  title: ReactNode;
  description?: ReactNode;
  icon?: ReactNode;
  action?: ReactNode;
  className?: string;
}

export function emptyClasses(options: Pick<EmptyProps, "className"> = {}): string {
  return cx("zz-empty", options.className);
}

export type SkeletonVariant = "text" | "rect" | "circle";

export interface SkeletonProps {
  variant?: SkeletonVariant;
  width?: string | number;
  height?: string | number;
  lines?: number;
  className?: string;
}

export function skeletonClasses(
  options: Pick<SkeletonProps, "variant" | "className"> = {},
): string {
  const { variant = "text", className } = options;
  return cx("zz-skeleton", `zz-skeleton--${variant}`, className);
}

export type SpinnerSize = "sm" | "md" | "lg";

export interface SpinnerProps {
  size?: SpinnerSize;
  label?: string;
  className?: string;
}

export function spinnerClasses(options: Pick<SpinnerProps, "size" | "className"> = {}): string {
  const { size = "md", className } = options;
  return cx("zz-spinner", `zz-spinner--${size}`, className);
}

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

export function progressStepState(index: number, current: number): ProgressStepState {
  if (index < current) return "done";
  if (index === current) return "current";
  return "todo";
}

export function progressRailClasses(options: Pick<ProgressRailProps, "className"> = {}): string {
  return cx("zz-progress-rail", options.className);
}

export interface KbdProps {
  keys: string | string[];
  className?: string;
}

export function kbdClasses(options: Pick<KbdProps, "className"> = {}): string {
  return cx("zz-kbd", options.className);
}

export interface MenuItem {
  id: string;
  label: ReactNode;
  shortcut?: string;
  danger?: boolean;
  disabled?: boolean;
  separator?: boolean;
  /** 分组标题：只作说明，不是可选项（不渲染为 menuitem）。 */
  heading?: boolean;
  onSelect?: () => void;
}

export interface MenuProps {
  label: string;
  items: MenuItem[];
  open?: boolean;
  className?: string;
  onClose?: () => void;
}

export function menuClasses(options: Pick<MenuProps, "open" | "className"> = {}): string {
  return cx("zz-menu", options.open && "zz-menu--open", options.className);
}

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
