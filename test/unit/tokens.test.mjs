import assert from "node:assert/strict";
import fs from "node:fs";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { WINDOW_BACKGROUND } = await importTs("packages/ui/src/tokens/tokens.ts");

test("main-process window background matches the palette tokens", () => {
  const palette = fs.readFileSync("packages/ui/src/tokens/palette.css", "utf8");
  const raw = (name) => new RegExp(`--zz-raw-${name}:\\s*(#[0-9a-fA-F]{6})`).exec(palette)?.[1];
  assert.equal(WINDOW_BACKGROUND.dark.toLowerCase(), raw("night-bg")?.toLowerCase());
  assert.equal(WINDOW_BACKGROUND.light.toLowerCase(), raw("day-bg")?.toLowerCase());
});
