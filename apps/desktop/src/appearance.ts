import type { AppearanceSettings } from "./shared/settings.js";

export const FONT_SIZE = { min: 16, max: 22, default: 18 } as const;
export type Appearance = AppearanceSettings;
