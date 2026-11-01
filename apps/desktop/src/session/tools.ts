import path from "node:path";
import { Type } from "typebox";
import type { SessionManager, ToolDefinition } from "./pi-adapter";
import type { Focus, Target } from "../context";
import { focusLabel } from "../context";
import { PLANNING_WRITES, roleAllows } from "./roles";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { executeTool } from "../../../../packages/host-generic/src/index";
import { withPluginConfig } from "../../../../packages/fanqie/src/engine/tools/context";
import type { HostToolDefinition, HostToolExecution } from "../../../../packages/host/src/index";
import type { createGateEngine } from "../../../../packages/core/src/gates";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";

function candidateSummary(text: string) {
  const words = /约\s*(\d+)\s*字/.exec(text)?.[1];
  const at = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `候选稿${words ? ` · ${words} 字` : ""} · ${at}`;
}

export function createBusinessTools(options: {
  host: Sessions;
  target: Target;
  role: "writer" | "editor" | "planner";
  primary: boolean;
  manager: SessionManager;
  gates: ReturnType<typeof createGateEngine>;
  config: any;
  definitions: HostToolDefinition[];
  readUrls: Set<string>;
  getEntry: () => SessionEntry;
  onCreated?: (work: string) => Promise<void>;
  onSaved?: (tool: string, output: string) => void;
}): ToolDefinition[] {
  const {
    host,
    target,
    role,
    primary,
    manager,
    gates,
    config,
    definitions,
    readUrls,
    getEntry,
    onCreated,
    onSaved,
  } = options;

  return definitions.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: Type.Unsafe<any>(def.parameters),
    execute: async (callId, raw, signal) => {
      const entry = getEntry();
      if (!roleAllows(role, def.name, target.mode))
        throw new Error("当前角色无权执行此操作");
      signal?.throwIfAborted();
      const args = raw as Record<string, unknown>;
      if (def.name === "fanqie_status" && args.recovery === "resume")
        throw new Error("恢复写入请由作者在设置的作品恢复入口中检查、备份并确认");
      const input =
        target.mode === "fanqie"
          ? { ...(target.work ? { work: target.work } : {}), ...args }
          : args;
      let createdWork: { base: string; key: string } | undefined;
      let stagedCandidate:
        | { id: string; chapterId: string; work: string; base: string }
        | undefined;
      const exec: HostToolExecution & {
        onWorkCreated: (base: string, key: string) => void;
        onCandidateStaged: (candidate: {
          id: string;
          chapterId: string;
          work: string;
          base: string;
        }) => void;
      } = {
        onCandidateStaged: (candidate) => {
          stagedCandidate = candidate;
        },
        onWorkCreated: (base, key) => {
          createdWork = { base, key };
        },
        sessionId: manager.getSessionId(),
        cwd: target.root,
        role,
        callId,
        name: def.name,
        arguments: input,
        token: Symbol(callId),
        signal,
      };
      if (def.name === "toutiao_card_set" || def.name === "toutiao_card_patch") {
        const card = def.name.endsWith("patch")
          ? {
              ...(await new ArticleStore(target.root).readCard(String(input.id))),
              ...(input.patch as object),
            }
          : (input.card as any);
        if (card?.["内容线"] === "资讯线")
          for (const source of card["出处"] || []) {
            const url = String(source["链接"] || "");
            if (!readUrls.has(url) && !readUrls.has(new URL(url).href))
              throw new Error(
                "资讯出处须是本次已通过 writer_read_url 读取的网址；请先读取：" + url,
              );
          }
      }
      const { value, content } = await executeTool(def, input, exec, {
        gates,
        bind: (run) => withPluginConfig(config, run),
        confirm: host.confirm,
      });
      if (role === "planner" && PLANNING_WRITES.has(def.name))
        onSaved?.(
          def.name,
          (content as any[])
            .filter((c) => c.type === "text")
            .map((c) => ("text" in c ? c.text : ""))
            .join("\n"),
        );
      if (
        (primary || role === "planner") &&
        createdWork &&
        !target.work &&
        path.resolve(createdWork.base) === target.root
      ) {
        try {
          if (primary) await host.attachCreated(entry, createdWork.key);
          else {
            target.work = createdWork.key;
            await onCreated?.(createdWork.key);
          }
        } catch (error) {
          host.emit({
            target,
            error: "作品已创建，但对话关联未完成：" + String(error),
          });
        }
      }
      const text = content.map((item) => item.text).join("\n");
      const resultFocus: Focus = {
        ...entry.focus,
        chapter:
          typeof input.chapter === "string" ? input.chapter : entry.focus.chapter,
        article:
          target.mode === "toutiao" && typeof input.id === "string"
            ? input.id
            : entry.focus.article,
      };
      const resultTarget = {
        ...target,
        ...(target.mode === "fanqie" && typeof input.work === "string"
          ? { work: input.work }
          : {}),
        ...(stagedCandidate
          ? { root: stagedCandidate.base, work: stagedCandidate.work }
          : {}),
      };
      if (stagedCandidate)
        Object.assign(resultFocus, {
          candidate: stagedCandidate.id,
          chapter: stagedCandidate.chapterId,
          source: "candidate",
          revision: undefined,
          title: undefined,
          workTitle: undefined,
        });
      const resultKind = /review_report/.test(def.name)
        ? "review"
        : /qa_check/.test(def.name)
          ? "qa"
          : /delivery_save/.test(def.name)
            ? "delivery"
            : /candidate_.*stage|draft_stage/.test(def.name)
              ? "candidate"
              : null;
      const output = value as any;
      return {
        content,
        details: resultKind
          ? {
              writerResult: {
                kind: resultKind,
                target: resultTarget,
                focus: resultFocus,
                label: focusLabel(resultTarget, resultFocus),
                summary:
                  resultKind === "candidate"
                    ? candidateSummary(text)
                    : resultKind === "review"
                      ? "审读回报已交，请核对"
                      : resultKind === "delivery"
                        ? "交稿单已保存"
                        : resultKind === "qa"
                          ? `质检 ${output.score ?? output.qa?.score ?? ""} ${output.verdict || ""}`.trim()
                          : "任务已完成",
                failed: output?.ok === false || text.startsWith("错误"),
              },
            }
          : {},
      };
    },
  }));
}
