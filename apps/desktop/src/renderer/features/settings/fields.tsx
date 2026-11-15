import React from "react";
import { TextField } from "../workspace/TextField";

/** 数字输入：空串或非数字时回落到上一个合法值。 */
export function NumberField({
  label,
  value,
  onChange,
  testId,
  hint,
}: {
  label: string;
  value: number;
  onChange: (value: number) => void;
  testId: string;
  hint?: string;
}) {
  return (
    <TextField
      label={label}
      type="number"
      value={String(value)}
      testId={testId}
      hint={hint}
      onChange={(raw) => {
        const next = Number(raw);
        if (raw.trim() !== "" && Number.isFinite(next)) onChange(next);
      }}
    />
  );
}

export function Section({ title, children, testId }: { title: string; children: React.ReactNode; testId?: string }) {
  return (
    <section className="zz-settings__section" data-testid={testId}>
      <h3>{title}</h3>
      {children}
    </section>
  );
}
