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
        正文字体
        <select
          value={appearance.font}
          onChange={(event) =>
            onChange({ ...appearance, font: event.target.value as Appearance["font"] })
          }
        >
          <option value="serif">思源宋体</option>
          <option value="sans">思源黑体</option>
        </select>
      </label>
      <label>
        正文字号
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
      <div className="lamp-theme-options" aria-label="主题预览">
        {[
          ["dark", "夜灯"],
          ["light", "晨光"],
          ["system", "跟随系统"],
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
          <h3>灯下的一页</h3>
          <p>雨停了。林川合上笔记本，窗外的末班车正慢慢驶过。那些还没写完的故事，明天可以继续。</p>
          <small>{appearance.fontSize} 字号 · 阅读与编辑使用相同排版</small>
        </div>
      </div>
      <Toggle
        label="减少透明效果"
        checked={!!appearance.reducedTransparency}
        onChange={(reducedTransparency: boolean) =>
          onChange({ ...appearance, reducedTransparency })
        }
      />
      <p className="form-note">字体随应用提供；稿纸行宽与行距针对长篇阅读设置。</p>
    </>
  );
}
