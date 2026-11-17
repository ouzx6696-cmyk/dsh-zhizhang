import assert from "node:assert/strict";
import fs from "node:fs/promises";
import path from "node:path";
import test from "node:test";
import { workspace, treeOps, chapter, bible, provenance } from "../support/v14.mjs";
const entity = (id, kind = "character") => ({
  id,
  kind,
  name: id,
  aliases: [],
  summary: "",
  locked: [],
  provenance,
  rev: 0,
});
const state = (patch = {}) => ({
  id: "st-1",
  entity: "ent-1",
  facet: "condition",
  field: "状态",
  value: "正常",
  since: 1,
  mode: "replace",
  status: "planned",
  provenance,
  rev: 0,
  ...patch,
});
const thread = (patch = {}) => ({
  id: "th-1",
  title: "旧账",
  kind: "mystery",
  opened: 1,
  importance: "major",
  beats: [],
  status: "open",
  provenance,
  rev: 0,
  ...patch,
});
const ledger = (id, patch = {}) => ({
  format: "zhizhang/1.3",
  chapter: id,
  revision: "old",
  position: 2,
  summary: "本章",
  handoff: { ending: "", openQuestions: [], positions: {}, carried: [] },
  hook: "",
  emotion: "",
  facts: [],
  appearances: [],
  ledgerRun: "run-1",
  rev: 0,
  ...patch,
});
const rules = [
  [
    "到期超过五章仍开放 → 严重超期",
    "thread_overdue",
    (x) => {
      x.threads = [thread({ dueBy: 2 })];
    },
  ],
  [
    "最后推进超过配置窗口 → 遗忘线",
    "thread_forgotten",
    (x) => {
      x.threads = [thread({ beats: [{ chapter: 3, kind: "push", note: "推进" }] })];
    },
  ],
  [
    "章纲安排回收且本章已记账 → 未见回收",
    "pay_unseen",
    (x) => {
      x.threads = [thread()];
      x.node.pay = [{ thread: "th-1" }];
      x.ledger = ledger(x.chapter);
    },
  ],
  [
    "章纲回收早于计划埋设 → 回收早于埋设",
    "pay_before_plant",
    (x) => {
      x.threads = [thread({ opened: 5, plannedPlant: 5 })];
      x.node.pay = [{ thread: "th-1" }];
    },
  ],
  [
    "终止状态角色仍列在出场人物 → 出场矛盾",
    "cast_retired",
    (x) => {
      x.states = [state({ value: "死亡" })];
      x.node.cast = ["ent-1"];
    },
  ],
  [
    "视角上一章在别处且无移动记录 → 地点跳变",
    "location_jump",
    (x) => {
      x.states = [state({ facet: "location", value: "ent-2", field: "地点" })];
      x.node.pov = "ent-1";
      x.node.location = "ent-3";
    },
  ],
  [
    "同一位置既知情又不知 → 知情冲突",
    "knowledge_leak",
    (x) => {
      x.knowledge = [
        { id: "kn-1", holder: "ent-1", fact: "密道", level: "知情", since: 1, provenance, rev: 0 },
        { id: "kn-2", holder: "ent-1", fact: "密道", level: "不知", since: 1, provenance, rev: 0 },
      ];
    },
  ],
  [
    "替换状态时间窗相交且值不同 → 状态冲突",
    "state_conflict",
    (x) => {
      x.states = [state(), state({ id: "st-2", since: 2, value: "受伤" })];
    },
  ],
  [
    "证据的正文版本与当前不同 → 证据过期",
    "evidence_stale",
    (x) => {
      x.states = [
        state({ evidence: { chapter: 2, revision: "old", quote: "正文", located: true } }),
      ];
      x.ledger = ledger(x.chapter);
    },
  ],
  [
    "已写章节偏离字数目标 → 字数目标提示",
    "word_target",
    (x) => {
      x.node.wordTarget = 500;
    },
  ],
  [
    "同位置计划与事实不同且保留 → 偏离计划",
    "plan_fact_divergence",
    (x) => {
      x.states = [
        state({ since: 2 }),
        state({ id: "st-2", since: 2, mode: "add", status: "confirmed", value: "受伤" }),
      ];
    },
  ],
  [
    "磁盘上的章纲人物引用被破坏 → 悬空引用",
    "dangling_ref",
    (x) => {
      x.node.cast = ["ent-missing"];
    },
  ],
];
for (const [name, kind, mutate] of rules)
  test(name, async (t) => {
    const env = await workspace(t),
      { ops, ids } = treeOps(1, 1, 2);
    await env.store.apply(env.work, ops, 0);
    const body = await env.store.createFromPlan(env.work, ids[1]);
    await chapter.saveChapter(
      env.work,
      { chapterId: body.chapterId, body: "正文", status: "drafted" },
      env.locks,
    );
    const outline = await env.store.get(env.work),
      volume = path.join(env.work, "outline", "volumes", outline.book.volumeOrder[0] + ".json"),
      file = JSON.parse(await fs.readFile(volume, "utf8"));
    const data = {
      node: file.acts[0].chapters[1],
      chapter: body.chapterId,
      states: [],
      threads: [],
      knowledge: [],
    };
    mutate(data);
    await fs.writeFile(volume, JSON.stringify(file));
    for (const [key, value] of Object.entries({
      entities: [entity("ent-1"), entity("ent-2", "place"), entity("ent-3", "place")],
      states: data.states,
      threads: data.threads,
      knowledge: data.knowledge,
    }))
      await fs.writeFile(path.join(env.work, "bible", key + ".json"), JSON.stringify(value));
    if (data.ledger)
      await fs.writeFile(
        path.join(env.work, "bible", "ledger", body.chapterId + ".json"),
        JSON.stringify(data.ledger),
      );
    const findings = await bible.auditWork(env.work, 20);
    assert.ok(
      findings.some((f) => f.kind === kind),
      JSON.stringify(findings),
    );
    assert.ok(findings.every((f) => f.jump.id));
    if (kind === "plan_fact_divergence")
      assert.ok(
        !findings.some((f) => f.kind === "state_conflict"),
        "保留事实的 add 状态不应触发 replace 区间冲突",
      );
  });
