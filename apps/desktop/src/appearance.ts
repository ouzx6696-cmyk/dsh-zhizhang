export const FONT_SIZE = { min: 16, max: 22, default: 18 } as const;
export type Appearance = {
  theme: "system" | "light" | "dark";
  font: "serif" | "sans";
  fontSize: number;
  reducedTransparency?: boolean;
};
