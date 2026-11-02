import {
  ensureStorage,
  resolveWorkDir,
  readChapter,
} from "../../../../packages/fanqie/src/engine/work-store";
import { rootIdentity } from "../../../../packages/core/src/identity";
import path from "node:path";
import { Type } from "typebox";
import type { SessionManager, ToolDefinition } from "./pi-adapter";
import type { Focus, Target } from "../context";
import { focusLabel } from "../context";
import { PLANNING_WRITES, roleAllows } from "./roles";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { executeTool } from "../../../../packages/core/src/execute";
import { withPluginConfig } from "../../../../packages/fanqie/src/engine/tools/context";
import type { ToolDefinition as WriterToolDefinition, ToolExecution } from "../../../../packages/core/src/tool";
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
  definitions: WriterToolDefinition[];
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

  const articleBasis = new Map<string, { rev: number; sha256: string }>();
  return definitions.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: Type.Unsafe<any>(def.parameters),
    execute: async (callId, raw, signal) => {
      const entry = getEntry();
      if (!roleAllows(role, def.name, target.mode)) throw new Error("当前角色无权执行此操作");
      signal?.throwIfAborted();
      config.profile = entry.profile;
      const args = raw as Record<string, unknown>;
      if (def.name === "fanqie_status" && args.recovery === "resume")
        throw new Error("恢复写入请由作者在设置的作品恢复入口中检查、备份并确认");
      if (
        args.working_dir &&
        rootIdentity(path.resolve(target.root, String(args.working_dir))) !==
          rootIdentity(target.root)
      )
        throw new Error("本次任务不能切换项目目录");
      if (
        target.mode === "fanqie" &&
        !target.work &&
        (args.work ||
          args.project ||
          "work" in (def.parameters as any).properties ||
          "project" in (def.parameters as any).properties)
      )
        throw new Error("请先从作品列表选择小说，或创建新作");
      if (
        target.mode === "toutiao" &&
        !target.article &&
        !["toutiao_method_get", "toutiao_profile"].includes(def.name) &&
        args.id
      )
        throw new Error("请先从作品列表选择文章，或新建文章");
      if (target.work && args.project && args.project !== target.work)
        throw new Error("本次任务只能操作当前小说");
      if (
        (target.work && def.name === "fanqie_project_create") ||
        (target.article && def.name === "toutiao_article_create")
      )
        throw new Error("请通过新作入口创建另一作品");
      if (target.work && args.work && args.work !== target.work)
        throw new Error("本次任务只能操作当前小说");
      if (
        target.article &&
        !["toutiao_method_get", "toutiao_profile"].includes(def.name) &&
        args.id &&
        args.id !== target.article
      )
        throw new Error("本次任务只能操作当前文章");
      const input =
        target.mode === "fanqie"
          ? { ...(target.work ? { work: target.work } : {}), ...args }
          : args;
      if (
        def.name === "fanqie_chapter_save" &&
        input.content !== undefined &&
        !input.expected_revision
      ) {
        const dir = await resolveWorkDir(await ensureStorage(null, config), String(target.work));
        const chapter = await readChapter(dir, String(input.chapter));
        if (chapter.body.trim())
          throw new Error("保存已有正文须提供已读取的 expected_revision；新正文可走候选稿流程");
        input.expected_revision = chapter.revision;
      }
      if (def.name === "toutiao_draft_stage") {
        const basis = articleBasis.get(String(input.id));
        if (!basis) throw new Error("存稿前请先读取当前稿件；首次立项后可直接写初稿");
        Object.assign(input, { expected_rev: basis.rev, expected_sha256: basis.sha256 });
      }
      let createdWork: { base: string; key: string } | undefined;
      let stagedCandidate:
        { id: string; chapterId: string; work: string; base: string } | undefined;
      const exec: ToolExecution & {
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
      if (def.name === "toutiao_article_create") {
        const meta = (value as any).article;
        articleBasis.set(meta.id, { rev: 0, sha256: "" });
      }
      if (def.name === "toutiao_article_get" && input.include_draft)
        articleBasis.set(String(input.id), (value as any).basis);
      if (def.name === "toutiao_draft_get") {
        const meta = await new ArticleStore(target.root).get(String(input.id));
        const rev =
          def.name === "toutiao_draft_get"
            ? (value as any).rev
            : (value as any).article?.current_rev;
        const record =
          def.name === "toutiao_draft_get"
            ? (value as any).record
            : meta.drafts.find((d) => d.rev === rev);
        articleBasis.set(meta.id, { rev: rev ?? meta.current_rev, sha256: record?.sha256 || "" });
      }
      if (
        def.name === "fanqie_chapter_save" &&
        input.content !== undefined &&
        !input.expected_revision
      ) {
        const dir = await resolveWorkDir(await ensureStorage(null, config), String(target.work));
        const chapter = await readChapter(dir, String(input.chapter));
        if (chapter.body.trim())
          throw new Error("保存已有正文须提供已读取的 expected_revision；新正文可走候选稿流程");
        input.expected_revision = chapter.revision;
      }
      if (def.name === "toutiao_draft_stage") {
        const meta = await new ArticleStore(target.root).get(String(input.id));
        articleBasis.set(meta.id, {
          rev: meta.current_rev,
          sha256: meta.drafts.find((d) => d.rev === meta.current_rev)?.sha256 || "",
        });
      }
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
      if (target.mode === "toutiao" && def.name === "toutiao_article_create" && !target.article) {
        const article = (value as any).id || (value as any).article?.id;
        if (article) {
          if (primary) await host.attachCreated(entry, String(article));
          else {
            target.article = String(article);
            await onCreated?.(String(article));
          }
        }
      }
      const text = content.map((item) => item.text).join("\n");
      const resultFocus: Focus = {
        ...entry.focus,
        chapter: typeof input.chapter === "string" ? input.chapter : entry.focus.chapter,
        article:
          target.mode === "toutiao" && typeof input.id === "string"
            ? input.id
            : entry.focus.article,
      };
      const resultTarget = {
        ...target,
        ...(target.mode === "fanqie" && typeof input.work === "string" ? { work: input.work } : {}),
        ...(stagedCandidate ? { root: stagedCandidate.base, work: stagedCandidate.work } : {}),
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
                draftLabel: typeof input.draft_label === "string" ? input.draft_label : undefined,
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
                failed: output?.ok === false,
              },
            }
          : {},
      };
    },
  }));
}
