import React, { useEffect, useRef, useState } from "react";
import { Monitor, Moon, Sun } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Segmented, Toggle } from "@zhizhang/ui/primitives";
import type { AppearanceSettings, PublicSettings } from "../../../shared/settings";
import { saveSettings } from "../../state/controller";
import { notifyError } from "../../format";
import { PAPER_MEASURE, PAPER_SIZE } from "../../app/useAppearance";
import { Section } from "./fields";

const THEMES: { value: AppearanceSettings["theme"]; icon: React.ReactNode }[] = [
  { value: "system", icon: <Monitor size={14} aria-hidden="true" /> },
  { value: "light", icon: <Sun size={14} aria-hidden="true" /> },
  { value: "dark", icon: <Moon size={14} aria-hidden="true" /> },
];

function ThemeCards({
  value,
  onChange,
}: {
  value: AppearanceSettings["theme"];
  onChange: (theme: AppearanceSettings["theme"]) => void;
}) {
  return (
    <div
      className="zz-theme-cards"
      role="radiogroup"
      aria-label={C.appearance.theme}
      data-testid="appearance-theme"
    >
      {THEMES.map((t) => (
        <button
          key={t.value}
          type="button"
          role="radio"
          aria-checked={value === t.value}
          className="zz-theme-card"
          data-theme-preview={t.value}
          data-testid={`appearance-theme-${t.value}`}
          onClick={() => onChange(t.value)}
        >
          <span className="zz-theme-card__swatch" aria-hidden="true">
            <i />
            <b />
            <b />
          </span>
          <span className="zz-theme-card__label">
            {t.icon}
            {C.appearance.themes[t.value]}
          </span>
        </button>
      ))}
    </div>
  );
}

function Slider({
  label,
  value,
  range,
  format,
  testId,
  onChange,
}: {
  label: string;
  value: number;
  range: { min: number; max: number };
  format: (n: number) => string;
  testId: string;
  onChange: (value: number) => void;
}) {
  return (
    <label className="zz-slider">
      <span className="zz-slider__head">
        <span>{label}</span>
        <output>{format(value)}</output>
      </span>
      <input
        type="range"
        min={range.min}
        max={range.max}
        step={1}
        value={value}
        data-testid={testId}
        onChange={(event) => onChange(Number(event.target.value))}
      />
    </label>
  );
}

/**
 * 外观：主题卡片、稿纸字体 / 段落 / 字号 / 行长，右侧预览即时反映；
 * 改动在本地立即生效，停手 300ms 后整体写回 appearance 分区。
 */
export function AppearanceTab({ settings }: { settings: PublicSettings }) {
  const saved = settings.appearance;
  const [draft, setDraft] = useState<AppearanceSettings>(saved);
  const pending = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => setDraft(saved), [saved]);
  useEffect(
    () => () => {
      if (pending.current) clearTimeout(pending.current);
    },
    [],
  );

  const update = (patch: Partial<AppearanceSettings>, delay = 0) => {
    const next = { ...draft, ...patch };
    setDraft(next);
    if (pending.current) clearTimeout(pending.current);
    pending.current = setTimeout(() => {
      saveSettings({ appearance: next }).catch(notifyError);
    }, delay);
  };

  const size = Math.min(PAPER_SIZE.max, Math.max(PAPER_SIZE.min, draft.fontSize));
  const measure = Math.min(PAPER_MEASURE.max, Math.max(PAPER_MEASURE.min, draft.measureChars));
  const previewStyle = {
    "--zz-body-size": `${size}px`,
    "--zz-paper-measure": String(measure),
  } as React.CSSProperties;

  return (
    <div className="zz-appearance" data-testid="settings-appearance">
      <div className="zz-appearance__form">
        <Section title={C.appearance.theme}>
          <ThemeCards value={draft.theme} onChange={(theme) => update({ theme })} />
        </Section>
        <Section title={C.appearance.paper}>
          <div className="zz-setting-row">
            <span className="zz-setting-row__label">{C.appearance.font}</span>
            <Segmented<AppearanceSettings["font"]>
              label={C.appearance.font}
              testId="appearance-font"
              value={draft.font}
              options={(["serif", "sans"] as const).map((v) => ({
                value: v,
                label: C.appearance.fonts[v],
              }))}
              onChange={(font) => update({ font })}
            />
          </div>
          <div className="zz-setting-row">
            <span className="zz-setting-row__label">{C.appearance.paragraph}</span>
            <Segmented<AppearanceSettings["paragraphStyle"]>
              label={C.appearance.paragraph}
              testId="appearance-paragraph"
              value={draft.paragraphStyle}
              options={(["indent", "spaced"] as const).map((v) => ({
                value: v,
                label: C.appearance.paragraphs[v],
              }))}
              onChange={(paragraphStyle) => update({ paragraphStyle })}
            />
          </div>
          <Slider
            label={C.appearance.fontSize}
            value={size}
            range={PAPER_SIZE}
            format={C.appearance.px}
            testId="appearance-font-size"
            onChange={(fontSize) => update({ fontSize }, 300)}
          />
          <Slider
            label={C.appearance.measure}
            value={measure}
            range={PAPER_MEASURE}
            format={C.appearance.chars}
            testId="appearance-measure"
            onChange={(measureChars) => update({ measureChars }, 300)}
          />
        </Section>
        <Section title={C.appearance.window}>
          <div className="zz-setting-row">
            <span className="zz-setting-row__label">{C.appearance.layout}</span>
            <Segmented<AppearanceSettings["layout"]>
              label={C.appearance.layout}
              testId="appearance-layout"
              value={draft.layout}
              options={(["fluid", "zoom", "off"] as const).map((v) => ({
                value: v,
                label: C.appearance.layouts[v],
              }))}
              onChange={(layout) => update({ layout })}
            />
          </div>
          <Toggle
            label={C.appearance.reducedTransparency}
            checked={draft.reducedTransparency}
            testId="appearance-transparency"
            onChange={(reducedTransparency) => update({ reducedTransparency })}
          />
        </Section>
      </div>
      <figure className="zz-appearance__preview" aria-label={C.appearance.preview}>
        <figcaption>{C.appearance.preview}</figcaption>
        <div
          className="zz-preview-paper"
          data-testid="appearance-preview"
          data-paragraph={draft.paragraphStyle}
          data-font={draft.font}
          style={previewStyle}
        >
          <div className="wb-manuscript">
            <h1 className="wb-manuscript-title">{C.appearance.sampleTitle}</h1>
            <p>{C.appearance.sample}</p>
            <p>{C.appearance.sample2}</p>
          </div>
        </div>
      </figure>
    </div>
  );
}
