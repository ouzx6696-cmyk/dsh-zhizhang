import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importBundle } from "../support/bundle.mjs";

const desk = await importBundle("test/support/desktop-entry.ts");

const plain = (value) => JSON.parse(JSON.stringify(value));

const plainCipher = {
  available: () => true,
  encrypt: (value) => value,
  decrypt: (value) => value,
};

async function freshConfig() {
  const stateRoot = await fs.mkdtemp(path.join(os.tmpdir(), "zz-settings-"));
  return { stateRoot, config: await desk.createConfigService({ stateRoot, cipher: plainCipher }) };
}

test("只给外观分区的补丁 → 解析结果不带其他分区的 undefined 键", () => {
  const appearance = { ...desk.DEFAULT_SETTINGS.appearance, theme: "light" };
  const patch = desk.parseSettingsPatch({ appearance });
  assert.deepEqual(Object.keys(patch), ["appearance"]);
  assert.equal(patch.appearance.theme, "light");
});

test("补丁里显式为 undefined 的分区 → 合并时保留现有分区", () => {
  const merged = desk.mergeSettingsPatch(desk.DEFAULT_SETTINGS, {
    engine: undefined,
    appearance: { ...desk.DEFAULT_SETTINGS.appearance, fontSize: 22 },
  });
  assert.deepEqual(merged.engine, desk.DEFAULT_SETTINGS.engine);
  assert.equal(merged.appearance.fontSize, 22);
});

test("局部保存外观 → 成功落盘，写作引擎分区原样保留", async () => {
  const { stateRoot, config } = await freshConfig();
  const appearance = { ...desk.DEFAULT_SETTINGS.appearance, theme: "dark", fontSize: 20 };
  const saved = await config.savePatch(desk.parseSettingsPatch({ appearance }));
  assert.equal(saved.appearance.theme, "dark");
  assert.equal(saved.appearance.fontSize, 20);
  assert.deepEqual(plain(saved.engine), plain(desk.DEFAULT_SETTINGS.engine));
  const onDisk = JSON.parse(await fs.readFile(path.join(stateRoot, "settings.json"), "utf8"));
  assert.equal(onDisk.appearance.fontSize, 20);
  assert.deepEqual(onDisk.engine, plain(desk.DEFAULT_SETTINGS.engine));
});

test("局部保存写作引擎 → 外观分区不被清空", async () => {
  const { config } = await freshConfig();
  await config.savePatch(
    desk.parseSettingsPatch({
      appearance: { ...desk.DEFAULT_SETTINGS.appearance, measureChars: 38 },
    }),
  );
  const saved = await config.savePatch(
    desk.parseSettingsPatch({ engine: desk.DEFAULT_SETTINGS.engine }),
  );
  assert.equal(saved.appearance.measureChars, 38);
});
