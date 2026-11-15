import { AppError } from "@zhizhang/core/errors";
import { fanqieModule } from "@zhizhang/fanqie";
import { toutiaoModule } from "@zhizhang/toutiao";

const MODULES = {
  fanqie: fanqieModule,
  toutiao: toutiaoModule,
} as const;

export type ModeId = keyof typeof MODULES;
export type ModeModule = (typeof MODULES)[ModeId];

export const ModeRegistry = {
  has(mode: string): mode is ModeId {
    return mode === "fanqie" || mode === "toutiao";
  },
  get(mode: string): ModeModule {
    if (!this.has(mode)) {
      throw new AppError("input.invalid", `Unsupported mode: ${mode}`, { mode });
    }
    return MODULES[mode];
  },
  list(): ModeId[] {
    return Object.keys(MODULES) as ModeId[];
  },
};

export function getModeModule(mode: string): ModeModule {
  return ModeRegistry.get(mode);
}
