import React from "react";
import { statusInfo, type StatusMode } from "./status.js";

export function StatusBadge({
  mode,
  status,
  className,
}: {
  mode: StatusMode;
  status?: string;
  className?: string;
}) {
  const info = statusInfo(mode, status);
  return (
    <span className={["ui-badge", className].filter(Boolean).join(" ")} data-tone={info.tone}>
      {info.label}
    </span>
  );
}
