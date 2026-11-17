import React from "react";
import type { PendingItem } from "@zhizhang/fanqie/bible";
import { P } from "../shared";

const changes: PendingItem["change"][] = [
  "new",
  "update",
  "same",
  "conflict",
  "fulfill",
  "diverge",
];
const decisions: PendingItem["decision"][] = ["undecided", "accept", "reject", "edit"];

export function PendingFilters({
  change,
  decision,
  onChange,
  onDecision,
}: {
  change: PendingItem["change"] | undefined;
  decision: PendingItem["decision"] | undefined;
  onChange: (value: PendingItem["change"] | undefined) => void;
  onDecision: (value: PendingItem["decision"] | undefined) => void;
}) {
  return (
    <>
      <label>
        {P["plan.change.conflict"]}
        <select
          value={change ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onChange(
              value === "new" ||
                value === "update" ||
                value === "same" ||
                value === "conflict" ||
                value === "fulfill" ||
                value === "diverge"
                ? value
                : undefined,
            );
          }}
        >
          <option value="">{P["plan.all"]}</option>
          {changes.map((value) => (
            <option key={value} value={value}>
              {P[`plan.change.${value}`]}
            </option>
          ))}
        </select>
      </label>
      <label>
        {P["plan.decision.undecided"]}
        <select
          value={decision ?? ""}
          onChange={(event) => {
            const value = event.target.value;
            onDecision(
              value === "undecided" || value === "accept" || value === "reject" || value === "edit"
                ? value
                : undefined,
            );
          }}
        >
          <option value="">{P["plan.all"]}</option>
          {decisions.map((value) => (
            <option key={value} value={value}>
              {P[`plan.decision.${value}`]}
            </option>
          ))}
        </select>
      </label>
    </>
  );
}
