import { useEffect } from "react";
import type { AppearanceSettings } from "../../shared/settings";

/** 稿纸字号与行长的可用范围（设置里滑块同一口径）。 */
export const PAPER_SIZE = { min: 16, max: 24 } as const;
export const PAPER_MEASURE = { min: 34, max: 40 } as const;

const clamp = (value: number, range: { min: number; max: number }) =>
  Math.min(range.max, Math.max(range.min, Math.round(value)));

/**
 * 外观设置落到根元素属性与稿纸令牌：
 * 主题（夜灯 / 晨光）、正文字体、段落样式（data-paragraph）、缩放布局；
 * 正文字号写 --zz-body-size（只作用于稿纸，不动界面字阶），行长写 --zz-paper-measure（字数），
 * 阅读态与编辑态共用这两个变量。
 */
export function useAppearance(appearance: AppearanceSettings | undefined): void {
  useEffect(() => {
    if (!appearance) return;
    const root = document.documentElement;
    const media = window.matchMedia("(prefers-color-scheme: dark)");
    const apply = () => {
      const dark = appearance.theme === "system" ? media.matches : appearance.theme === "dark";
      root.dataset.theme = dark ? "night" : "day";
      root.dataset.font = appearance.font;
      root.dataset.paragraph = appearance.paragraphStyle;
      root.dataset.layout = appearance.layout;
      root.dataset.transparency = appearance.reducedTransparency ? "reduced" : "normal";
      root.style.setProperty("--zz-body-size", `${clamp(appearance.fontSize, PAPER_SIZE)}px`);
      root.style.setProperty(
        "--zz-paper-measure",
        String(clamp(appearance.measureChars, PAPER_MEASURE)),
      );
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
}
