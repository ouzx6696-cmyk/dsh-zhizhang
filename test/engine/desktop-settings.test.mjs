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

test("D11: 只保存 shell → engine 与 appearance 不变，关闭标记落盘", async () => {
  const { stateRoot, config } = await freshConfig();
  await config.savePatch(
    desk.parseSettingsPatch({
      appearance: { ...desk.DEFAULT_SETTINGS.appearance, theme: "dark" },
    }),
  );
  const saved = await config.savePatch(
    desk.parseSettingsPatch({ shell: { onboardingDismissed: true } }),
  );
  assert.equal(saved.shell.onboardingDismissed, true);
  assert.equal(saved.appearance.theme, "dark");
  assert.deepEqual(plain(saved.engine), plain(desk.DEFAULT_SETTINGS.engine));
  const onDisk = JSON.parse(await fs.readFile(path.join(stateRoot, "settings.json"), "utf8"));
  assert.equal(onDisk.shell.onboardingDismissed, true);
  assert.deepEqual(onDisk.engine, plain(desk.DEFAULT_SETTINGS.engine));
});

test("D11: v1.3 的旧 settings.json（无 shell 分区）→ 照常解析，引导视为未关闭", async () => {
  const { stateRoot, config } = await freshConfig();
  await config.savePatch(desk.parseSettingsPatch({ assistant: { preferences: "简洁" } }));
  const onDisk = JSON.parse(await fs.readFile(path.join(stateRoot, "settings.json"), "utf8"));
  delete onDisk.shell;
  await fs.writeFile(path.join(stateRoot, "settings.json"), JSON.stringify(onDisk), "utf8");
  const fresh = await desk.createConfigService({ stateRoot, cipher: plainCipher });
  const settings = fresh.publicSettings();
  assert.equal(settings.shell?.onboardingDismissed, undefined);
  assert.equal(settings.assistant.preferences, "简洁");
});
