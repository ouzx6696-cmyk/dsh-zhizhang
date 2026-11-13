import assert from "node:assert/strict";
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createToolHarness } from "../helpers.mjs";
import { formatToolError } from "../../build/fanqie/src/engine/errors.js";
import { ensureStorage } from "../../build/fanqie/src/engine/storage/paths.js";

export const BOOK = [
  "第1章 差三罐",
  "凌晨两点，屏幕上的数字比昨天少了三罐咖啡。他把时间戳抄在纸条上。",
  "第2章 四秒",
  "他调出监控回放，侧窗的人影只用了四秒。",
].join("\n");
export async function setup(extraConfig = {}) {
  const root = await mkdtemp(path.join(tmpdir(), "writer-novel-workflow-"));
  const paths = await ensureStorage(null, { storageRoot: root });
  const harness = await createToolHarness({
    mode: "fanqie",
    cwd: root,
    config: { ...extraConfig, storageRoot: root },
  });
  const run = async (name, args = {}) => {
    try {
      return (await harness.execute(name, args)).value;
    } catch (error) {
      return formatToolError(error);
    }
  };
  return { root, paths, run, close: () => rm(root, { recursive: true, force: true }) };
}
export function id(text, expression) {
  const found = text.match(expression)?.[1];
  assert.ok(found, text);
  return found;
}
export function cardInput(sourceId) {
  return {
    title: "差数引出疑问",
    sourceId,
    axis: "craft",
    layer: "scene",
    dimension: "hook",
    body: "用可核对的细节引出疑问。",
    mechanisms: [
      {
        name: "差数",
        experience: "三罐",
        rebuild: "换成其他差数",
        discard: "便利店",
        failWhen: "差数无后果",
      },
    ],
    humanFeel: {
      writerCraft: "重数后再开口",
      craftRange: "近景",
      characterState: "怀疑",
      stateOnPage: "停半拍",
      allowedEdges: "一句噪音",
      failAsTemplate: "句句解释",
    },
    readerWant: "差数缘由",
    emotionArc: "平静到起疑",
    dramaticUnit: "盘点差数",
    replaceables: ["数字"],
    mustNotCopy: ["人物"],
    evidence: [{ quote: "屏幕上的数字比昨天少了三罐咖啡", chapter: 1 }],
    transfer: "其他可核对的差异",
    failWhen: "差数无后果",
  };
}
