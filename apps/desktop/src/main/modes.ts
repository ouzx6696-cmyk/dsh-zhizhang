import { AppError } from "@zhizhang/core/errors";
import type { ModeModule, PipelineDefinition } from "@zhizhang/core/pipeline";
import { fanqieModule } from "@zhizhang/fanqie";
import { toutiaoModule } from "@zhizhang/toutiao";
import type { Mode } from "../shared/views.js";

const MODULES: { readonly [M in Mode]: ModeModule<M> } = {
  fanqie: fanqieModule,
  toutiao: toutiaoModule,
};

export function isMode(value: string): value is Mode {
  return value === "fanqie" || value === "toutiao";
}

/** ModeModule 注册表：命令前缀与目标模式都在这里查表，不写 if/else。 */
export const ModeRegistry = {
  get(mode: string): ModeModule {
    if (!isMode(mode)) {
      throw new AppError("input.invalid", `不支持的写作模式：${mode}`, { mode });
    }
    return MODULES[mode];
  },
  pipeline(mode: string, kind: string): PipelineDefinition<unknown, unknown> {
    const def = this.get(mode).pipelines[kind];
    if (!def) throw new AppError("input.invalid", `未知流水线：${kind}`, { kind, mode });
    return def;
  },
};
