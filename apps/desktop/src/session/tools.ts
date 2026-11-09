import { localDay, sha256 } from "../../../../packages/core/src/fsx";
import { asRecord } from "../main/ipc/validate";
import { resolveFanqieWork } from "../main/storage";
import { findChapter } from "../../../../packages/fanqie/src/engine/work-store";
import { rootIdentity } from "../../../../packages/core/src/identity";
import path from "node:path";
import { Type } from "typebox";
import type { SessionManager, ToolDefinition } from "./pi-adapter";
import type { Focus, Target } from "../context";
import { focusLabel } from "../context";
import { PLANNING_WRITES } from "./roles";
import { ArticleStore } from "../../../../packages/toutiao/src/store";
import { executeTool } from "../../../../packages/core/src/execute";
import { WriterError } from "../../../../packages/core/src/tool";
import { formatToolError } from "../../../../packages/fanqie/src/engine/errors";
import { withPluginConfig } from "../../../../packages/fanqie/src/engine/tools/context";
import type {
  ToolDefinition as WriterToolDefinition,
  ToolExecution,
} from "../../../../packages/core/src/tool";
import type { createGateEngine } from "../../../../packages/core/src/gates";
import type { Sessions } from "./manager";
import type { SessionEntry } from "./types";

/** The SDK hands only an error's message to the model and the task tracker; keep the code in it. */
async function withErrorCode<T>(run: () => Promise<T>) {
  try {
    return await run();
  } catch (error) {
    if (error instanceof WriterError) throw new Error(formatToolError(error), { cause: error });
    throw error;
  }
}
function candidateSummary(text: string) {
  const words = /约\s*(\d+)\s*字/.exec(text)?.[1];
  const at = new Date().toLocaleTimeString("zh-CN", {
    hour: "2-digit",
    minute: "2-digit",
  });
  return `候选稿${words ? ` · ${words} 字` : ""} · ${at}`;
}

/**
 * 方法回执（entry.methods 的 {id, profile, hash} 凭据，供重复读取去重、压缩清空与前端展示）。
 * toutiao_method_get 返回 {id, text, profile} 对象回执；fanqie_method_get（引擎版）返回拼接字符串，
 * 每份方法以标题行「## 方法 · <id>（方案「<方案名>」）」或「## 方法资产 · <id> · <标题>」开头。
 * 方法原文里可能有与段分隔符同款的「---」横线，所以按标题行定位、取相邻标题之间的内容，
 * hash 按这段实际进入上下文的内容计算；引擎资产没有方案，profile 记 engine；
 * 解析不出标题行的部分（如「（未找到：…）」提示）不记回执，工具结果照常返回。
 */
function methodReceipts(
  tool: string,
  value: unknown,
): { id: string; profile: string; hash: string }[] {
  if (tool === "toutiao_method_get") {
    const method = asRecord(value, "方法回执");
    if (
      typeof method.id === "string" &&
      typeof method.text === "string" &&
      typeof method.profile === "string"
    )
      return [{ id: method.id, profile: method.profile, hash: sha256(method.text) }];
    return [];
  }
  if (typeof value !== "string") return [];
  const titles = [...value.matchAll(/^## 方法(?:资产)? · (.+?)(?:（方案「(.+?)」）| · .*)$/gm)];
  return titles.map((m, i) => {
    const start = (m.index ?? 0) + m[0].length;
    const next = titles[i + 1]?.index ?? value.length;
    return { id: m[1], profile: m[2] ?? "engine", hash: sha256(value.slice(start, next)) };
  });
}

export function createBusinessTools(options: {
  host: Sessions;
  target: Target;
  role: "writer" | "editor" | "planner";
  manager: SessionManager;
  gates: ReturnType<typeof createGateEngine>;
  config: import("../../../../packages/fanqie/src/config").FanqieConfig &
    import("../../../../packages/toutiao/src/config").ToutiaoConfig;
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
    manager,
    gates,
    config,
    definitions,
    readUrls,
    getEntry,
    onCreated,
    onSaved,
  } = options;

  const primary = role === "writer";
  const articleBasis = new Map<string, { rev: number; sha256: string }>();
  return definitions.map((def) => ({
    name: def.name,
    label: def.name,
    description: def.description,
    parameters: Type.Unsafe<Record<string, unknown>>(def.parameters),
    execute: async (callId, raw, signal) => {
      const entry = getEntry();
      signal?.throwIfAborted();
      config.profile = entry.profile;
      const args = asRecord(raw, "工具参数");
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
          "work" in (def.parameters.properties ?? {}) ||
          "project" in (def.parameters.properties ?? {}))
      )
        throw new Error("请先从作品列表选择小说，或创建新作");
      if (
        target.mode === "toutiao" &&
        !target.article &&
        !["toutiao_method_get", "toutiao_profile"].includes(def.name) &&
        args.id
      )
        throw new Error("请先从作品列表选择文章，或新建文章");
      if (
        (target.work && def.name === "fanqie_project_create") ||
        (target.article && def.name === "toutiao_article_create")
      )
        throw new Error("请通过新作入口创建另一作品");
      if (
        target.work &&
        [args.work, args.project].some((value) => value !== undefined && value !== target.work)
      )
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
        const dir = await resolveFanqieWork({ fanqie: config }, target);
        // A chapter with no file yet is a fresh save; only existing prose needs a read basis.
        const chapter = await findChapter(dir, String(input.chapter));
        if (chapter?.body.trim())
          throw new Error("保存已有正文须提供已读取的 expected_revision；新正文可走候选稿流程");
        if (chapter) input.expected_revision = chapter.revision;
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
              ...asRecord(input.patch, "立项卡修改"),
            }
          : asRecord(input.card, "立项卡");
        if (card["内容线"] === "资讯线") {
          const sources = card["出处"];
          if (!Array.isArray(sources)) throw new Error("资讯线立项卡须提供出处列表");
          for (const item of sources) {
            const source = asRecord(item, "出处");
            const url = typeof source["链接"] === "string" ? source["链接"] : "";
            if (url === "作者素材" || url === "用户素材") continue;
            let normalized: string;
            try {
              normalized = new URL(url).href;
            } catch {
              throw new Error("出处须填写作者素材或有效 HTTP(S) 网址：" + url);
            }
            if (!readUrls.has(url) && !readUrls.has(normalized))
              throw new Error(
                "资讯出处须是本次已通过 writer_read_url 读取的网址；请先读取：" + url,
              );
          }
        }
      }
      const { value, content } = await withErrorCode(() =>
        executeTool(def, input, exec, {
          gates,
          bind: (run) => withPluginConfig(config, run),
          confirm: host.confirm,
        }),
      );
      if (def.name === "fanqie_method_get" || def.name === "toutiao_method_get") {
        for (const receipt of methodReceipts(def.name, value)) {
          const duplicate = entry.methods.get(receipt.id)?.hash === receipt.hash;
          entry.methods.set(receipt.id, receipt);
          host.extras.log?.("method_loaded", {
            ...receipt,
            duplicate,
            taskId: entry.task.id,
            conversationId: manager.getSessionId(),
          });
        }
      }
      if (def.name === "toutiao_article_create") {
        const meta = asRecord(asRecord(value, "立项回执").article, "文章");
        articleBasis.set(String(meta.id), { rev: 0, sha256: "" });
      }
      if (def.name === "toutiao_article_get" && input.include_draft)
        articleBasis.set(
          String(input.id),
          asRecord(value, "文章读取回执").basis as { rev: number; sha256: string },
        );
      if (def.name === "toutiao_draft_get") {
        const meta = await new ArticleStore(target.root).get(String(input.id));
        const result = asRecord(value, "稿件读取回执");
        const record =
          result.record === undefined ? undefined : asRecord(result.record, "稿件记录");
        articleBasis.set(meta.id, {
          rev: typeof result.rev === "number" ? result.rev : meta.current_rev,
          sha256: typeof record?.sha256 === "string" ? record.sha256 : "",
        });
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
          content
            .filter((c) => c.type === "text")
            .map((c) => ("text" in c ? c.text : ""))
            .join("\n"),
        );
      const articleCreated =
        target.mode === "toutiao" && def.name === "toutiao_article_create" && !target.article
          ? asRecord(asRecord(value, "立项回执").article, "文章").id
          : undefined;
      const workCreated =
        createdWork && !target.work && path.resolve(createdWork.base) === target.root
          ? createdWork.key
          : undefined;
      const created = workCreated ?? articleCreated;
      if ((primary || role === "planner") && typeof created === "string") {
        try {
          if (primary) await host.attachCreated(entry, created);
          else {
            Object.assign(
              target,
              target.mode === "fanqie" ? { work: created } : { article: created },
            );
            await onCreated?.(created);
          }
        } catch (error) {
          host.emit({ target, error: "作品已创建，但对话关联未完成：" + String(error) });
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
      const output = typeof value === "object" && value !== null ? asRecord(value, "工具回执") : {};
      const qa = output.qa && typeof output.qa === "object" ? asRecord(output.qa, "质检回执") : {};
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
                          ? `质检 ${output.score ?? qa.score ?? ""} ${output.verdict || ""}`.trim()
                          : "任务已完成",
                failed: output.ok === false,
              },
            }
          : {},
      };
    },
  }));
}

/** writer_remember：作者长期约束追加进作者偏好（存储形态照旧，一行带日期），
 * 下一条任务的 writer-context preferences 自动带上。作者偏好文件不存在时由空文件起头。 */
export function createRememberTool(options: {
  read: () => Promise<string>;
  save: (text: string) => Promise<void>;
}): ToolDefinition {
  const { read, save } = options;
  return {
    name: "writer_remember",
    label: "记住作者约束",
    description:
      "作者明确说“记住/以后都要/别再”这类跨任务的长期约束时，把约束原文追加进作者偏好，后续任务会自动带上。不要拿它记本章情节、临时安排或一次性要求。",
    parameters: Type.Object({ text: Type.String({ description: "作者约束原文" }) }),
    execute: async (_id, raw) => {
      const text = (raw as { text: string }).text.trim();
      if (!text) throw new Error("约束内容不能为空");
      if (Array.from(text).length > 500) throw new Error("作者约束请控制在 500 字以内");
      const previous = (await read()).replace(/\n+$/, "");
      const line = `- ${localDay()} ${text}`;
      await save(previous ? `${previous}\n${line}\n` : `${line}\n`);
      return {
        content: [
          { type: "text", text: `已记住作者约束并写入作者偏好，后续任务会自动带上：${text}` },
        ],
        details: {},
      };
    },
  };
}
