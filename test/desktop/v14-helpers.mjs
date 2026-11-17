import { expect, _electron as electron } from "@playwright/test";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import path from "node:path";
import { fakeModel } from "./fake-model.mjs";
export async function invoke(page, channel, ...args) {
  const reply = await page.evaluate(
    async ({ channel, args }) => window.zhizhangBridge.invoke(channel, ...args),
    { channel, args },
  );
  if (!reply.ok) throw new Error(JSON.stringify(reply.error));
  return reply.value;
}
export const command = (page, command, input) => invoke(page, "workbench.call", { command, input });
export async function launchV14(respond) {
  await mkdir("test/.tmp", { recursive: true });
  const home = await mkdtemp(path.resolve("test/.tmp/v14-home-")),
    root = await mkdtemp(path.resolve("test/.tmp/v14-root-")),
    model = await fakeModel(respond);
  const app = await electron.launch({
    args: [
      path.resolve("apps/desktop"),
      `--user-data-dir=${path.join(home, "chromium")}`,
      ...(process.platform === "linux" ? ["--no-sandbox"] : []),
    ],
    env: { ...process.env, ZHIZHANG_USER_DATA: home, NO_PROXY: "127.0.0.1,localhost" },
  });
  await app.evaluate(({ dialog }, folder) => {
    dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [folder] });
    dialog.showMessageBoxSync = () => 1;
  }, root);
  const page = await app.firstWindow(),
    tid = (id) => page.getByTestId(id);
  await expect(tid("onboarding")).toBeVisible();
  await tid("onboarding-choose-workspace").click();
  await tid("onboarding-next").click();
  await tid("connection-label").fill("本地假模型");
  await tid("connection-api").selectOption("openai-completions");
  await tid("connection-base-url").fill(model.url);
  await tid("connection-keyless").check();
  await tid("connection-model").fill("fake");
  await tid("connection-test").click();
  await expect(tid("connection-result")).toHaveAttribute("data-ok", "true");
  await tid("connection-save").click();
  await tid("onboarding-finish").click();
  await expect(tid("onboarding")).toHaveCount(0);
  await tid("target-switch").click();
  await tid("target-menu").getByRole("menuitem", { name: "新建长篇" }).click();
  await tid("new-work-title").fill("夜航计划");
  await tid("new-work-premise").fill("林川守灯的故事");
  await tid("new-work-submit").click();
  await expect(tid("target-label")).toContainText("夜航计划");
  const work = (await invoke(page, "targets.list")).find((t) => t.label === "夜航计划").target.path;
  return {
    app,
    page,
    model,
    home,
    root,
    work,
    tid,
    close: async () => {
      await app.close();
      await model.close();
    },
    pickFile: async (name, text) => {
      const file = path.join(root, name);
      await writeFile(file, text);
      await app.evaluate(({ dialog }, file) => {
        dialog.showOpenDialog = async () => ({ canceled: false, filePaths: [file] });
      }, file);
    },
  };
}
export function v14Answer(_body, user) {
  if (user.includes("【阶段】docmap"))
    return {
      text: JSON.stringify({
        mapping: {},
        sections: [{ id: "S1", kind: "setting-character" }],
        naming: [],
        editedByAuthor: false,
      }),
    };
  if (user.includes("【阶段】extract")) {
    const data = JSON.parse(user.slice(0, user.indexOf("\n\nJSON:"))),
      para = data.text.match(/\[(P[^\]]+)\]/u)[1];
    return {
      text: JSON.stringify({
        items: [
          {
            type: "entity",
            tmp: "lin",
            kind: "character",
            name: "林川",
            summary: "守灯人",
            src: [para],
            quote: "林川是守灯人。",
            confidence: 0.99,
          },
        ],
        unassigned: [],
      }),
    };
  }
  if (user.includes('"deltas"'))
    return {
      text: JSON.stringify({
        deltas: [
          {
            kind: "entity",
            targetId: "lin",
            name: "林川",
            detail: "守灯人",
            quote: "林川是守灯人。",
            entityKind: "character",
          },
          {
            kind: "state",
            targetId: "lin",
            name: "林川",
            field: "伤势",
            facet: "condition",
            value: "受伤",
            detail: "左臂受伤",
            quote: "林川左臂受伤。",
          },
        ],
      }),
    };
  if (user.includes('"verdict"'))
    return { text: JSON.stringify({ verdict: "pass", issues: [], summary: "通过" }) };
  if (user.includes('"issues"')) return { text: JSON.stringify({ issues: [] }) };
  return { text: "好的。" };
}
