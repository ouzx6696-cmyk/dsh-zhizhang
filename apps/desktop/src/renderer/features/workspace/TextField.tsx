import React, { useId } from "react";
import { Field } from "@zhizhang/ui/primitives";

/** Field + 原生输入：label 与控件经同一个 id 关联，testId 落在控件上。 */
export function TextField({
  label,
  value,
  onChange,
  testId,
  hint,
  type = "text",
  multiline = false,
  required = false,
  placeholder,
  disabled,
  autoFocus,
}: {
  label: string;
  value: string;
  onChange: (value: string) => void;
  testId: string;
  hint?: string;
  type?: "text" | "password" | "number" | "url";
  multiline?: boolean;
  required?: boolean;
  placeholder?: string;
  disabled?: boolean;
  autoFocus?: boolean;
}) {
  const id = useId();
  return (
    <Field id={id} label={label} hint={hint} required={required}>
      {multiline ? (
        <textarea
          id={id}
          className="zz-input zz-input--area"
          data-testid={testId}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          onChange={(event) => onChange(event.target.value)}
        />
      ) : (
        <input
          id={id}
          className="zz-input"
          data-testid={testId}
          type={type}
          value={value}
          placeholder={placeholder}
          disabled={disabled}
          autoFocus={autoFocus}
          required={required}
          onChange={(event) => onChange(event.target.value)}
        />
      )}
    </Field>
  );
}
