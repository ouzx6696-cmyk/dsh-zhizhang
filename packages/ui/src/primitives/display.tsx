import {
  cx,
  progressStepState,
  type BrandProps,
  type CardProps,
  type StatProps,
  type StepsProps,
} from "./types.js";

export function Brand({ label = "织章", className, children = "章" }: BrandProps) {
  return (
    <span className={cx("zz-brand", className)} aria-label={label}>
      {children}
    </span>
  );
}

export function Card({ title, description, footer, className, children }: CardProps) {
  return (
    <section className={cx("zz-card", className)}>
      {title ? <h3 className="zz-card__title">{title}</h3> : null}
      {description ? <p className="zz-card__desc">{description}</p> : null}
      {children}
      {footer ? <footer>{footer}</footer> : null}
    </section>
  );
}

export function Stat({ label, value, detail, className }: StatProps) {
  return (
    <div className={cx("zz-stat", className)}>
      <span>{label}</span>
      <strong>{value}</strong>
      {detail ? <small>{detail}</small> : null}
    </div>
  );
}

export function Steps({ steps, current, label, className }: StepsProps) {
  return (
    <ol className={cx("zz-steps", className)} aria-label={label}>
      {steps.map((step, index) => {
        const state = progressStepState(index, current);
        const itemLabel = typeof step === "string" ? step : step.label;
        const key = typeof step === "string" ? `${index}-${step}` : step.id;
        return (
          <li key={key} data-state={state} aria-current={state === "current" ? "step" : undefined}>
            <span>{state === "done" ? "✓" : index + 1}</span>
            {itemLabel}
          </li>
        );
      })}
    </ol>
  );
}
