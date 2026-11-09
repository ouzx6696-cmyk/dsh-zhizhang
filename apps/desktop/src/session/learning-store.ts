import { assertWorkspaceWritable } from "../../../../packages/core/src/workspace-lock";
import path from "node:path";
import { rm } from "node:fs/promises";
import { atomicWrite, readJson, readText, nowIso } from "../../../../packages/core/src/fsx";
import { resolveFanqieWork } from "../main/storage";
import { FoundationPort } from "../../../../packages/fanqie/src/engine/ports/foundation";
import { withResourceLock } from "../../../../packages/fanqie/src/engine/storage/process-lock";
import { readWorkMeta } from "../../../../packages/fanqie/src/engine/storage/work-meta";
import { createToutiaoTools } from "../../../../packages/toutiao/src/tools";
import { createGateEngine } from "../../../../packages/core/src/gates";
import { executeTool } from "../../../../packages/core/src/execute";
import { toutiaoGateRules } from "../../../../packages/toutiao/src/gates";
import { parsePending, styleEntryOf, feedbackEntryOf, type LearnItem } from "./learning-data";
import { record, list, text } from "../workflow/schema";
import type { Sessions } from "./manager";
import type { Target } from "../context";
export async function learningFile(host: Sessions, target: Target) {
  return path.join(
    target.mode === "fanqie" ? await resolveFanqieWork(host.options, target) : target.root,
    "learn-pending.json",
  );
}
export async function readLearning(host: Sessions, target: Target) {
  const file = await learningFile(host, target),
    value = await readJson<unknown>(file);
  return value === undefined ? undefined : parsePending(value, file);
}
interface PersonalRule {
  id: string;
  condition: string;
  change: string;
  at: string;
  chapters: string[];
  example: { before: string; after: string };
}
async function personalFile(host: Sessions, target: Target) {
  return path.join(path.dirname(await learningFile(host, target)), "personal-rules.json");
}
async function readRules(host: Sessions, target: Target): Promise<PersonalRule[]> {
  const value = await readJson<unknown>(await personalFile(host, target));
  return value === undefined
    ? []
    : list(value, "个人规则", 1000).map((raw) => {
        const r = record(raw),
          example = record(r.example);
        return {
          id: text(r.id, "规则号"),
          condition: text(r.condition, "条件"),
          change: text(r.change, "改法"),
          at: text(r.at, "日期"),
          chapters: list(r.chapters, "应用起点", 10000).map((value) => text(value, "章节")),
          example: { before: text(example.before, "改前"), after: text(example.after, "改后") },
        };
      });
}
async function finalized(host: Sessions, target: Target) {
  return target.mode === "fanqie"
    ? (await readWorkMeta(await resolveFanqieWork(host.options, target))).chapters
        .filter((row) => row.status === "final")
        .map((row) => row.id)
    : [];
}
export async function learningStatus(host: Sessions, target: Target) {
  const pending = await readLearning(host, target),
    rules = await readRules(host, target),
    chapters = await finalized(host, target);
  return {
    pending: pending?.items ?? [],
    rules: rules.map((rule) => ({
      ...rule,
      subsequent: chapters.filter((id) => !rule.chapters.includes(id)).length,
      recurring: pending?.items.find((item) => item.id === rule.id)?.count ?? 0,
    })),
  };
}
async function appendFeedback(host: Sessions, target: Target, item: LearnItem, value?: string) {
  const config = { ...host.options.toutiao, storageRoot: target.root, python: host.python },
    gates = createGateEngine(toutiaoGateRules(config));
  const tool = (await createToutiaoTools({ config, role: "writer", gates: () => gates })).find(
    (tool) => tool.name === "toutiao_feedback_append",
  );
  if (!tool) throw new Error("改稿反馈工具不可用");
  const entry = feedbackEntryOf(item, value);
  await executeTool(
    tool,
    {
      original: entry.original,
      revised: entry.revised,
      motive: entry.motive,
      病型: entry.病型,
      改法: entry.改法,
    },
    { cwd: target.root, role: "writer", name: tool.name, arguments: {} },
    { gates, bind: (run) => run(), confirm: host.confirm },
  );
}
export async function decideLearning(
  host: Sessions,
  target: Target,
  id: string,
  action: "accept" | "reject",
  value?: string,
) {
  if (value !== undefined && id === "all") throw new Error("编辑内容只适用于单条规则");
  const file = await learningFile(host, target),
    snapshot = await readText(file),
    pending = await readLearning(host, target);
  await assertWorkspaceWritable(path.dirname(file));
  const chosen = pending?.items.filter((item) => id === "all" || item.id === id) ?? [];
  if (!chosen.length || !pending) throw new Error("没有这个待确认的改稿学习候选");
  if (
    action === "accept" &&
    !(await host.confirm(
      "采用以下个人规则？将写入本作品的文风或反馈层：\n" +
        chosen.map((item) => item.condition + " → " + (value?.trim() || item.change)).join("\n"),
    ))
  )
    throw new Error("作者取消了采用个人规则");
  return withResourceLock(path.dirname(file), async () => {
    if ((await readText(file)) !== snapshot) throw new Error("待确认规则已变化，请重新查看");
    const rules = await readRules(host, target),
      written: string[] = [];
    if (action === "accept") {
      const chapters = await finalized(host, target);
      for (const item of chosen) {
        if (!rules.some((row) => row.id === item.id)) {
          if (target.mode === "fanqie")
            await FoundationPort.appendStyleCard(
              await resolveFanqieWork(host.options, target),
              styleEntryOf(item, value),
            );
          else await appendFeedback(host, target, item, value);
          rules.push({
            id: item.id,
            condition: item.condition,
            change: value?.trim() || item.change,
            at: nowIso(),
            chapters,
            example: item.example,
          });
          await atomicWrite(await personalFile(host, target), JSON.stringify(rules, null, 2));
        }
      }
      written.push(target.mode === "fanqie" ? "作品文风与个人规则层" : "改稿反馈与个人规则层");
    }
    const remaining = pending.items.filter((item) => !chosen.some((row) => row.id === item.id));
    if (remaining.length)
      await atomicWrite(file, JSON.stringify({ ...pending, items: remaining }, null, 2));
    else await rm(file, { force: true });
    return { chosen, remaining, written };
  });
}
