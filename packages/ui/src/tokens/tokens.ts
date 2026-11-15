export type ThemeMode = "night" | "day";
export type SemanticTone = "decide" | "run" | "ok" | "warn" | "bad" | "neutral";
export type FontMode = "serif" | "sans";
export type LayoutScaleMode = "fluid" | "zoom" | "off";

export const ZZ_TOKEN_PREFIX = "--zz-" as const;

export const ZZ_TOKENS = {
  bg: "var(--zz-bg)",
  bgGlow: "var(--zz-bg-glow)",
  surface1: "var(--zz-surface-1)",
  surface2: "var(--zz-surface-2)",
  panel: "var(--zz-panel)",
  paper: "var(--zz-paper)",
  paper2: "var(--zz-paper-2)",
  border: "var(--zz-border)",
  borderStrong: "var(--zz-border-strong)",
  text1: "var(--zz-text-1)",
  text2: "var(--zz-text-2)",
  text3: "var(--zz-text-3)",
  title: "var(--zz-title)",
  decide: "var(--zz-decide)",
  decideFill: "var(--zz-decide-fill)",
  onDecide: "var(--zz-on-decide)",
  run: "var(--zz-run)",
  ok: "var(--zz-ok)",
  warn: "var(--zz-warn)",
  bad: "var(--zz-bad)",
  fontUi: "var(--zz-font-ui)",
  fontPaper: "var(--zz-font-paper)",
  fontMono: "var(--zz-font-mono)",
} as const;

export const SEMANTIC_TONE_TOKENS: Record<SemanticTone, { fg: string; bg: string }> = {
  decide: { fg: "var(--zz-decide)", bg: "var(--zz-decide-fill)" },
  run: { fg: "var(--zz-run)", bg: "color-mix(in srgb, var(--zz-run) 14%, transparent)" },
  ok: { fg: "var(--zz-ok)", bg: "color-mix(in srgb, var(--zz-ok) 14%, transparent)" },
  warn: { fg: "var(--zz-warn)", bg: "color-mix(in srgb, var(--zz-warn) 14%, transparent)" },
  bad: { fg: "var(--zz-bad)", bg: "color-mix(in srgb, var(--zz-bad) 14%, transparent)" },
  neutral: { fg: "var(--zz-text-2)", bg: "var(--zz-fill-strong)" },
};

export function cssVar(token: string): string {
  const normalized = token.startsWith(ZZ_TOKEN_PREFIX) ? token : `${ZZ_TOKEN_PREFIX}${token}`;
  return `var(${normalized})`;
}

export function themeAttributes(options: {
  theme?: ThemeMode;
  font?: FontMode;
  reducedTransparency?: boolean;
}): Record<string, string> {
  const attrs: Record<string, string> = {};
  if (options.theme) attrs["data-theme"] = options.theme;
  if (options.font) attrs["data-font"] = options.font;
  if (options.reducedTransparency) attrs["data-transparency"] = "reduced";
  return attrs;
}

/**
 * 主进程窗口首帧底色（BrowserWindow 读不到 CSS 变量）。必须与 palette.css 的
 * `--zz-raw-night-bg` / `--zz-raw-day-bg` 一致，test/unit/tokens.test.mjs 会核对。
 */
export const WINDOW_BACKGROUND = { dark: "#101315", light: "#f3eee4" } as const;
