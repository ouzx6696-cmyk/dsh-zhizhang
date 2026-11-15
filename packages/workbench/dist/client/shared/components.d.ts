import React from "react";
import type { ComponentProps, ReactNode } from "react";
import { type StatusMode } from "@zhizhang/ui/status";
export declare function cx(...parts: unknown[]): string;
export declare function clip(value: unknown, n: number): string;
export declare function Icon({ name, size, label }: {
    name: string;
    size?: number;
    label?: string;
}): React.JSX.Element;
export declare function Spinner({ size, label }: {
    size?: number;
    label?: string;
}): React.JSX.Element;
export declare function Tag({ tone, className, children, }: {
    tone?: string;
    className?: string;
    children?: ReactNode;
}): React.JSX.Element;
export declare function StateDot({ state, size, className, }: {
    state: string;
    size?: number;
    className?: string;
}): React.JSX.Element;
export declare function StatusTag({ status, mode }: {
    status?: string;
    mode?: StatusMode;
}): React.JSX.Element;
export declare function StatusDot({ status, mode }: {
    status?: string;
    mode?: StatusMode;
}): React.JSX.Element;
export interface SegmentedOption<T extends string = string> {
    value: T;
    label: ReactNode;
    disabled?: boolean;
    title?: string;
}
export declare function SegmentedControl<T extends string>({ id, value, options, onChange, label, disabled, className, }: {
    id: string;
    value: T;
    options: readonly SegmentedOption<T>[];
    onChange: (value: T) => void;
    label?: string;
    disabled?: boolean;
    className?: string;
}): React.JSX.Element;
export declare function Checkbox({ checked, onChange, label, disabled, title, className, }: {
    checked: boolean;
    onChange: (checked: boolean) => void;
    label: ReactNode;
    disabled?: boolean;
    title?: string;
    className?: string;
}): React.JSX.Element;
export declare function ActionButton({ busy, done, icon, children, disabled, variant, className, ...rest }: ComponentProps<"button"> & {
    variant?: string;
    busy?: boolean;
    done?: number;
    icon?: ReactNode;
}): React.JSX.Element;
export declare function Section({ title, aside, children, className, }: {
    title?: ReactNode;
    aside?: ReactNode;
    children?: ReactNode;
    className?: string;
}): React.JSX.Element;
export declare function Empty({ title, hint, icon, children, }: {
    title?: ReactNode;
    hint?: ReactNode;
    icon?: string | null;
    children?: ReactNode;
}): React.JSX.Element;
export declare function Skeleton({ lines }: {
    lines?: number;
}): React.JSX.Element;
export declare function Callout({ tone, role, children, onDismiss, }: {
    tone?: "info" | "warning" | "danger" | "success";
    role?: string;
    children?: ReactNode;
    onDismiss?: () => void;
}): React.JSX.Element;
export declare function ActionCard({ icon, title, hint, onClick, disabled, busy, primary, offReason, }: {
    icon: string;
    title: ReactNode;
    hint?: ReactNode;
    onClick: () => void;
    disabled?: boolean;
    busy?: boolean;
    primary?: boolean;
    offReason?: string;
}): React.JSX.Element;
export interface FoundationData {
    locks?: unknown;
    happened?: unknown;
    threads?: unknown;
    style?: unknown;
}
export declare function Foundation({ foundation, limit, }: {
    foundation?: FoundationData | null;
    limit?: number;
}): React.JSX.Element;
export declare function Hints({ hints, initial, }: {
    hints?: readonly string[];
    initial?: number;
}): React.JSX.Element;
//# sourceMappingURL=components.d.ts.map