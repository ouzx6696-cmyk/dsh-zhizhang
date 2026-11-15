import React from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Segmented, Toggle } from "@zhizhang/ui/primitives";
import type { AppearanceSettings, PublicSettings } from "../../../shared/settings";
import { saveSettings } from "../../state/controller";
import { notifyError } from "../../format";
import { NumberField, Section } from "./fields";

/** 外观即改即存：每次修改整体写回 appearance 分区。 */
export function AppearanceTab({ settings }: { settings: PublicSettings }) {
  const appearance = settings.appearance;
  const update = (patch: Partial<AppearanceSettings>) => {
    saveSettings({ appearance: { ...appearance, ...patch } }).catch(notifyError);
  };
  return (
    <div className="zz-stack" data-testid="settings-appearance">
      <Section title={C.appearance.theme}>
        <Segmented<AppearanceSettings["theme"]>
          label={C.appearance.theme}
          testId="appearance-theme"
          value={appearance.theme}
          options={(["system", "light", "dark"] as const).map((v) => ({ value: v, label: C.appearance.themes[v] }))}
          onChange={(theme) => update({ theme })}
        />
      </Section>
      <Section title={C.appearance.paper}>
        <Segmented<AppearanceSettings["font"]>
          label={C.appearance.font}
          testId="appearance-font"
          value={appearance.font}
          options={(["serif", "sans"] as const).map((v) => ({ value: v, label: C.appearance.fonts[v] }))}
          onChange={(font) => update({ font })}
        />
        <Segmented<AppearanceSettings["paragraphStyle"]>
          label={C.appearance.paragraph}
          testId="appearance-paragraph"
          value={appearance.paragraphStyle}
          options={(["indent", "spaced"] as const).map((v) => ({ value: v, label: C.appearance.paragraphs[v] }))}
          onChange={(paragraphStyle) => update({ paragraphStyle })}
        />
        <div className="zz-row">
          <NumberField label={C.appearance.fontSize} value={appearance.fontSize} testId="appearance-font-size" hint={C.appearance.fontSizeHint} onChange={(fontSize) => fontSize >= 14 && fontSize <= 26 && update({ fontSize })} />
          <NumberField label={C.appearance.measure} value={appearance.measureChars} testId="appearance-measure" hint={C.appearance.measureHint} onChange={(measureChars) => measureChars >= 30 && measureChars <= 44 && update({ measureChars })} />
        </div>
      </Section>
      <Section title={C.appearance.window}>
        <Segmented<AppearanceSettings["layout"]>
          label={C.appearance.layout}
          testId="appearance-layout"
          value={appearance.layout}
          options={(["fluid", "zoom", "off"] as const).map((v) => ({ value: v, label: C.appearance.layouts[v] }))}
          onChange={(layout) => update({ layout })}
        />
        <Toggle
          label={C.appearance.reducedTransparency}
          checked={appearance.reducedTransparency}
          testId="appearance-transparency"
          onChange={(reducedTransparency) => update({ reducedTransparency })}
        />
      </Section>
      <div className="zz-paper zz-preview" data-testid="appearance-preview">
        <p>{C.appearance.sample}</p>
      </div>
    </div>
  );
}
