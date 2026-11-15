import type { ReactNode } from "react";
import {
  Notice,
  StatusChip,
  Empty as UiEmpty,
  Skeleton as UiSkeleton,
} from "@zhizhang/ui/primitives";
import { statusChipTone, statusLabel, type StatusMode } from "@zhizhang/ui/status";

export function cx(...parts: unknown[]): string {
  return parts.filter(Boolean).join(" ");
}

const ICONS: Record<string, readonly string[]> = {
  book: [
    "M4 19.5A2.5 2.5 0 0 1 6.5 17H20",
    "M6.5 2H20v20H6.5A2.5 2.5 0 0 1 4 19.5v-15A2.5 2.5 0 0 1 6.5 2z",
    "M8 7h8M8 11h6",
  ],
  close: ["M6 6l12 12", "M18 6L6 18"],
  search: ["M11 18a7 7 0 1 0 0-14 7 7 0 0 0 0 14z", "M20 20l-3.5-3.5"],
  up: ["M6 15l6-6 6 6"],
  down: ["M6 9l6 6 6-6"],
  pen: ["M12 20h9", "M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"],
  news: [
    "M4 22h16a2 2 0 0 0 2-2V4a2 2 0 0 0-2-2H8a2 2 0 0 0-2 2v16a2 2 0 0 1-2 2zm0 0a2 2 0 0 1-2-2v-9c0-1.1.9-2 2-2h2",
    "M18 14h-8",
    "M15 18h-5",
    "M10 6h8v4h-8z",
  ],
};

export function Icon({ name, size = 16, label }: { name: string; size?: number; label?: string }) {
  const paths = ICONS[name] ?? ICONS.book;
  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.7}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden={label ? undefined : "true"}
      role={label ? "img" : undefined}
      aria-label={label}
      className="wb-icon"
    >
      {paths.map((d) => (
        <path key={d} d={d} />
      ))}
    </svg>
  );
}

/** 状态胶囊：状态词逐字取自 @zhizhang/ui/status，色调走语义（运行蓝 / 通过绿 / 注意黄 / 失败红）。 */
export function StatusTag({ status, mode = "fanqie" }: { status?: string; mode?: StatusMode }) {
  return <StatusChip tone={statusChipTone(mode, status)} label={statusLabel(mode, status)} dot />;
}

/** 列表里的状态点：颜色之外，读屏读出状态词。 */
export function StatusDot({ status, mode = "fanqie" }: { status?: string; mode?: StatusMode }) {
  return (
    <span
      className="wb-dot"
      data-tone={statusChipTone(mode, status)}
      role="img"
      aria-label={statusLabel(mode, status)}
      title={statusLabel(mode, status)}
    />
  );
}

export function Empty({
  title = null,
  hint = null,
  icon = null,
}: {
  title?: ReactNode;
  hint?: ReactNode;
  icon?: string | null;
}) {
  return (
    <UiEmpty
      className="wb-empty"
      title={title}
      description={hint}
      icon={icon ? <Icon name={icon} size={18} /> : undefined}
    />
  );
}

export function Skeleton({ lines = 6 }: { lines?: number }) {
  return <UiSkeleton lines={lines} className="wb-skeleton" />;
}

export function Callout({
  tone = "info",
  children,
}: {
  tone?: "info" | "warning" | "danger" | "success";
  role?: string;
  children?: ReactNode;
}) {
  const map = { info: "neutral", warning: "warn", danger: "bad", success: "ok" } as const;
  return <Notice tone={map[tone]} message={children} className="wb-callout" />;
}
