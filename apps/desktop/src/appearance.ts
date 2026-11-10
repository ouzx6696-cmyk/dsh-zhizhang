export const FONT_SIZE = { min: 16, max: 22, default: 18 } as const;
export type Appearance = {
  theme: "system" | "light" | "dark";
  font: "serif" | "sans";
  fontSize: number;
  reducedTransparency?: boolean;
  /** 大窗口的布局方式：fluid 栏宽与稿纸随窗口伸展（默认），zoom 整体等比放大，off 保持设计尺寸。 */
  layout?: "fluid" | "zoom" | "off";
};
