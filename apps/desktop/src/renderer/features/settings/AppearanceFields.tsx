import { COPY as viewCopy } from "../../../../../../packages/ui/src/copy.js";
import { FONT_SIZE, type Appearance } from "../../../appearance";
import React from "react";
import { Toggle } from "../../../../../../packages/ui/src/primitives";
export function AppearanceFields({
  appearance,
  onChange,
}: {
  appearance: Appearance;
  onChange: (value: Appearance) => void;
}) {
  return (
    <>
      <label>
        {viewCopy.appearanceFieldsText1}
        <select
          value={appearance.font}
          onChange={(event) =>
            onChange({ ...appearance, font: event.target.value as Appearance["font"] })
          }
        >
          <option value="serif">{viewCopy.appearanceFieldsText2}</option>
          <option value="sans">{viewCopy.appearanceFieldsText3}</option>
        </select>
      </label>
      <label>
        {viewCopy.appearanceFieldsText4}
        <input
          type="range"
          min={FONT_SIZE.min}
          max={FONT_SIZE.max}
          value={appearance.fontSize}
          onChange={(event) =>
            onChange({
              ...appearance,
              fontSize: Number(event.target.value),
            })
          }
        />
      </label>
      <label>
        {viewCopy.appearanceLayoutLabel}
        <select
          value={appearance.layout ?? "fluid"}
          onChange={(event) =>
            onChange({ ...appearance, layout: event.target.value as Appearance["layout"] })
          }
        >
          <option value="fluid">{viewCopy.appearanceLayoutFluid}</option>
          <option value="zoom">{viewCopy.appearanceLayoutZoom}</option>
          <option value="off">{viewCopy.appearanceLayoutOff}</option>
        </select>
      </label>
      <div className="lamp-theme-options" aria-label={viewCopy.appearanceFieldsText5}>
        {[
          ["dark", viewCopy.appearanceFieldsText6],
          ["light", viewCopy.appearanceFieldsText7],
          ["system", viewCopy.appearanceFieldsText8],
        ].map(([theme, label]) => (
          <button
            key={theme}
            aria-pressed={appearance.theme === theme}
            onClick={() => onChange({ ...appearance, theme: theme as Appearance["theme"] })}
          >
            {label}
          </button>
        ))}
      </div>
      <div
        className="lamp-settings-preview ui-theme-preview"
        data-theme={
          appearance.theme === "system"
            ? window.matchMedia("(prefers-color-scheme: dark)").matches
              ? "dark"
              : "light"
            : appearance.theme
        }
      >
        <div
          className="lamp-preview-paper"
          style={{
            fontSize: appearance.fontSize,
            fontFamily: appearance.font === "serif" ? "var(--ui-font-body)" : "var(--ui-font-ui)",
          }}
        >
          <h3>{viewCopy.appearanceFieldsText9}</h3>
          <p>{viewCopy.appearanceFieldsText10}</p>
          <small>
            {appearance.fontSize}
            {viewCopy.appearanceFieldsText11}
          </small>
        </div>
      </div>
      <Toggle
        label={viewCopy.appearanceFieldsText12}
        checked={!!appearance.reducedTransparency}
        onChange={(reducedTransparency: boolean) =>
          onChange({ ...appearance, reducedTransparency })
        }
      />
      <p className="form-note">{viewCopy.appearanceFieldsText13}</p>
    </>
  );
}
