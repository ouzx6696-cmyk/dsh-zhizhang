import { arr, bool, int, lit, num, obj, opt, str, type Infer } from "@zhizhang/core/schema";

export const ConnectionSchema = obj({
  id: str({ min: 1 }),
  provider: str({ min: 1 }),
  baseUrl: opt(str()),
  price: opt(obj({ inputPer1M: num({ min: 0 }), outputPer1M: num({ min: 0 }) })),
});

export const SettingsSchema = obj({
  workspaceRoot: opt(str()),
  engine: obj({
    grade: lit("economy", "standard", "premium"),
    inputBudget: int({ min: 1000, max: 200000 }),
    runBudget: int({ min: 10000, max: 10000000 }),
    moneyCap: opt(num({ min: 0 })),
    concurrency: obj({
      global: int({ min: 1, max: 16 }),
      perRun: int({ min: 1, max: 8 }),
    }),
  }),
  appearance: obj({
    theme: lit("night", "day"),
    fontSize: int({ min: 14, max: 26 }),
    measureChars: int({ min: 30, max: 44 }),
    paragraphStyle: lit("indent", "spaced"),
  }),
  models: obj({
    connections: arr(ConnectionSchema),
    roles: obj({
      writer: str({ min: 1 }),
      editor: str({ min: 1 }),
      planner: str({ min: 1 }),
      judge: opt(str()),
      extractor: opt(str()),
    }),
  }),
});

export type AppSettings = Infer<typeof SettingsSchema>;

export const DEFAULT_SETTINGS: AppSettings = {
  engine: {
    grade: "standard",
    inputBudget: 24000,
    runBudget: 1200000,
    concurrency: { global: 4, perRun: 3 },
  },
  appearance: {
    theme: "night",
    fontSize: 18,
    measureChars: 36,
    paragraphStyle: "indent",
  },
  models: {
    connections: [],
    roles: { writer: "default", editor: "default", planner: "default" },
  },
};

export function parseSettings(raw: unknown): AppSettings {
  return SettingsSchema(raw, "$settings");
}
