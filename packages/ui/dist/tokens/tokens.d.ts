export type ThemeMode = "night" | "day";
export type SemanticTone = "decide" | "run" | "ok" | "warn" | "bad" | "neutral";
export type FontMode = "serif" | "sans";
export type LayoutScaleMode = "fluid" | "zoom" | "off";
export declare const ZZ_TOKEN_PREFIX: "--zz-";
export declare const ZZ_TOKENS: {
    readonly bg: "var(--zz-bg)";
    readonly bgGlow: "var(--zz-bg-glow)";
    readonly surface1: "var(--zz-surface-1)";
    readonly surface2: "var(--zz-surface-2)";
    readonly panel: "var(--zz-panel)";
    readonly paper: "var(--zz-paper)";
    readonly paper2: "var(--zz-paper-2)";
    readonly border: "var(--zz-border)";
    readonly borderStrong: "var(--zz-border-strong)";
    readonly text1: "var(--zz-text-1)";
    readonly text2: "var(--zz-text-2)";
    readonly text3: "var(--zz-text-3)";
    readonly title: "var(--zz-title)";
    readonly decide: "var(--zz-decide)";
    readonly decideFill: "var(--zz-decide-fill)";
    readonly onDecide: "var(--zz-on-decide)";
    readonly run: "var(--zz-run)";
    readonly ok: "var(--zz-ok)";
    readonly warn: "var(--zz-warn)";
    readonly bad: "var(--zz-bad)";
    readonly fontUi: "var(--zz-font-ui)";
    readonly fontPaper: "var(--zz-font-paper)";
    readonly fontMono: "var(--zz-font-mono)";
};
export declare const SEMANTIC_TONE_TOKENS: Record<SemanticTone, {
    fg: string;
    bg: string;
}>;
export declare function cssVar(token: string): string;
export declare function themeAttributes(options: {
    theme?: ThemeMode;
    font?: FontMode;
    reducedTransparency?: boolean;
}): Record<string, string>;
//# sourceMappingURL=tokens.d.ts.map