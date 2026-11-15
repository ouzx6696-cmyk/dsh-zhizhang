import { useEffect } from "react";
import type { AppearanceSettings } from "../../shared/settings";

/** 外观设置落到根元素属性与令牌：主题（夜灯/晨光）、正文字体、字号、行长、段落样式、缩放布局。 */
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
      root.style.setProperty("--zz-text-body", `${appearance.fontSize}px`);
      root.style.setProperty("--zz-paper-measure", `${appearance.measureChars}em`);
    };
    apply();
    media.addEventListener("change", apply);
    return () => media.removeEventListener("change", apply);
  }, [appearance]);
}
