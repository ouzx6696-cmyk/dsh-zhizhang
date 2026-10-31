import path from "node:path";
import { createHash } from "node:crypto";
import { access, mkdir, readFile, writeFile, rm } from "node:fs/promises";
import {
  createAgentSession,
  DefaultResourceLoader,
  SessionManager,
  ModelRuntime,
  type AgentSession,
  type ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import type { ToutiaoConfig } from "../../../packages/toutiao/src/config";
import type { ChapterMeta } from "../../../packages/fanqie/src/engine/types";
import type { FanqieConfig } from "../../../packages/fanqie/src/config";
import {
  createToutiaoTools,
  EDITOR_TOOLS,
  validPassingQa,
} from "../../../packages/toutiao/src/tools";
import { toutiaoGateRules } from "../../../packages/toutiao/src/gates";
import {
  buildToutiaoBrief,
  TOUTIAO_EDITOR_BRIEF,
} from "../../../packages/toutiao/src/brief";
import { createFanqieTools } from "../../../packages/fanqie/src/tools";
import { engineTools } from "../../../packages/fanqie/src/engine/bootstrap";
import { SYSTEM_BRIEF } from "../../../packages/fanqie/src/engine/tools/brief";
import { withPluginConfig } from "../../../packages/fanqie/src/engine/tools/context";
import {
  fanqieGateRules,
  EDITOR_DENY,
} from "../../../packages/fanqie/src/gates";
import {
  buildFanqieBrief,
  FANQIE_EDITOR_BRIEF,
} from "../../../packages/fanqie/src/brief";
import {
  listProjects,
  projectIdOf,
  ensureStorage,
  readWorkMeta,
  resolveWorkDir,
  readChapter,
} from "../../../packages/fanqie/src/engine/work-store";
import { activeProfile } from "../../../packages/core/src/profiles";
import { ArticleStore } from "../../../packages/toutiao/src/store";
import { chapterReviewInfo } from "../../../packages/fanqie/src/review";
import {
  promptText,
  promptContext,
  toolLabel,
  focusLabel,
  type Target,
  type Focus,
} from "./context";
export type { Target, Focus } from "./context";
import { createGateEngine } from "../../../packages/core/src/gates";
import type {
  HostToolDefinition,
  HostToolExecution,
} from "../../../packages/host/src/index";

export type ModelSettings = {
  baseUrl: string;
  apiKey: string;
  model: string;
  contextWindow: number;
  maxTokens: number;
};
export class Sessions {
  private sessions = new Map<
    string,
    { session: AgentSession; target: Target; focus: Focus; phase: string }
  >();
  private opening = new Map<string, Promise<AgentSession>>();
  private children = new Map<AgentSession, AgentSession>();
  constructor(
    private home: string,
    private python: string,
    private settings: () => ModelSettings,
    private emit: (event: unknown) => void,
    private confirm: (text: string, signal?: AbortSignal) => Promise<boolean>,
    private options: { toutiao?: ToutiaoConfig; fanqie?: FanqieConfig } = {},
    private created: (
      previous: Target,
      next: Target,
    ) => Promise<void> = async () => {},
  ) {}
  key(target: Target) {
    return createHash("sha256")
      .update(
        JSON.stringify({
          mode: target.mode,
          root: path.resolve(target.root),
          ...(target.work ? { work: target.work } : {}),
        }),
      )
      .digest("hex")
      .slice(0, 24);
  }
  async open(target: Target, editor = false): Promise<AgentSession> {
    if (editor) return this.create(target, true);
    const key = this.key(target);
    if (this.sessions.has(key)) return this.sessions.get(key)!.session;
    if (!this.opening.has(key))
      this.opening.set(
        key,
        this.create(target, false).finally(() => this.opening.delete(key)),
      );
    return this.opening.get(key)!;
  }
  private async create(target: Target, editor: boolean): Promise<AgentSession> {
    target = { ...target };
    const key = this.key(target);
    if (!editor && this.sessions.has(key))
      return this.sessions.get(key)!.session;
    const dir = path.join(this.home, "sessions", key);
    await mkdir(dir, { recursive: true });
    let manager = SessionManager.inMemory(target.root);
    if (!editor) {
      const marker = await readFile(path.join(dir, "current"), "utf8").catch(
        () => "",
      );
      manager =
        marker &&
        (await access(marker).then(
          () => true,
          () => false,
        ))
          ? SessionManager.open(marker)
          : SessionManager.create(target.root, dir);
    }
    const role = editor ? "editor" : "writer";
    const project =
      target.mode === "fanqie"
        ? (await listProjects()).find((p) => p.id === projectIdOf(target.root))
        : undefined;
    const config = {
      ...this.options[target.mode],
      storageRoot: target.root,
      ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
      python: this.python,
    };
    const gates = createGateEngine(
      target.mode === "toutiao"
        ? toutiaoGateRules(config)
        : fanqieGateRules(config, role),
    );
    let definitions: HostToolDefinition[] =
      target.mode === "toutiao"
        ? createToutiaoTools({ config, role, gates: () => gates })
        : [...engineTools(config), ...createFanqieTools({ config, role })];
    if (editor)
      definitions = definitions.filter((t) =>
        target.mode === "toutiao"
          ? EDITOR_TOOLS.has(t.name)
          : !EDITOR_DENY.has(t.name),
      );
    const customTools: ToolDefinition[] = definitions.map((def) => ({
      name: def.name,
      label: def.name,
      description: def.description,
      parameters: Type.Unsafe<any>(def.parameters),
      execute: async (callId, raw, signal) => {
        const args = raw as Record<string, unknown>;
        const input =
          target.mode === "fanqie"
            ? { ...(target.work ? { work: target.work } : {}), ...args }
            : args;
        let createdWork: { base: string; key: string } | undefined;
        const exec: HostToolExecution & {
          onWorkCreated: (base: string, key: string) => void;
        } = {
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
        const decision = await withPluginConfig(config, () =>
          gates.evaluate(exec),
        );
        if (decision?.kind === "deny") throw new Error(decision.reason);
        if (
          decision?.kind === "ask" &&
          !(await this.confirm(
            String(input.work || input.id || target.work || target.root) +
              "\n" +
              (decision.reason || "确认操作？"),
            signal,
          ))
        )
          throw new Error("作者取消了操作");
        const value = await withPluginConfig(config, () =>
          def.execute(input, exec),
        );
        if (
          !editor &&
          createdWork &&
          !target.work &&
          path.resolve(createdWork.base) === target.root
        ) {
          try {
            await this.attachCreated(entry, createdWork.key);
          } catch (error) {
            this.emit({
              target,
              error: "作品已创建，但对话关联未完成：" + String(error),
            });
          }
        }
        return { content: def.output.render(input, value), details: {} };
      },
    }));
    if (!editor)
      customTools.push({
        name: "writer_review",
        label: "编辑审读",
        description:
          "派当前模式的独立编辑审读指定文章或章节，交回原有审读回报或编辑稿。",
        parameters: Type.Object({
          task: Type.String({ description: "审读任务说明" }),
          work: Type.Optional(Type.String({ description: "作品 key" })),
          chapter: Type.Optional(Type.String({ description: "章节 id" })),
          article: Type.Optional(Type.String({ description: "头条文章 id" })),
        }),
        execute: async (_id, args, signal) => {
          const task = args as {
            task: string;
            work?: string;
            chapter?: string;
            article?: string;
          };
          const childTarget = {
            ...target,
            ...(task.work ? { work: task.work } : {}),
          };
          const focus: Focus = {
            ...(task.work && task.work !== target.work ? {} : entry.focus),
            ...(task.chapter && task.chapter !== entry.focus.chapter
              ? { title: undefined, revision: undefined }
              : {}),
            ...(task.article && task.article !== entry.focus.article
              ? { title: undefined, revision: undefined }
              : {}),
            ...(task.chapter
              ? {
                  chapter: task.chapter,
                  candidate: undefined,
                  source: "chapter" as const,
                }
              : {}),
            ...(task.article ? { article: task.article } : {}),
          };
          entry.phase = "编辑审读中…";
          const child = await this.open(childTarget, true);
          this.children.set(session, child);
          const abort = () => {
            void child.abort();
          };
          signal?.addEventListener("abort", abort, { once: true });
          try {
            signal?.throwIfAborted();
            await child.prompt(
              await this.taskPrompt(childTarget, task.task, focus),
            );
            const last = child.messages.findLast(
              (message) => message.role === "assistant",
            );
            if (
              last?.role === "assistant" &&
              (last.stopReason === "error" || last.stopReason === "aborted")
            )
              throw new Error(
                last.errorMessage || "编辑已停止，未交回完整结论",
              );
            const result = await this.reviewResult(childTarget, focus);
            return {
              content: [
                {
                  type: "text",
                  text:
                    result.summary +
                    "\n\n" +
                    (child.getLastAssistantText() || "编辑未返回文字结论。"),
                },
              ],
              details: { writerResult: result },
            };
          } finally {
            signal?.removeEventListener("abort", abort);
            this.children.delete(session);
            child.dispose();
            entry.phase = "编辑任务结束，正在整理结果…";
          }
        },
      });
    customTools.push({
      name: "writer_read_url",
      label: "读取来源",
      description:
        "读取作者给出的 HTTP(S) 页面，返回来源地址与文本；不登录网站。",
      parameters: Type.Object({ url: Type.String() }),
      execute: async (_id, raw, signal) => {
        const url = new URL((raw as { url: string }).url);
        if (!["https:", "http:"].includes(url.protocol))
          throw new Error("只支持 HTTP(S) 地址");
        const response = await fetch(url, {
          signal: AbortSignal.any([
            ...(signal ? [signal] : []),
            AbortSignal.timeout(20000),
          ]),
        });
        if (!response.ok) throw new Error("来源返回 HTTP " + response.status);
        const kind = response.headers.get("content-type") || "";
        if (!kind.includes("text/"))
          throw new Error("该来源不是可读取的文本页面");
        const html = await response.text();
        const text = html
          .replace(/<(script|style)[\s\S]*?<\/\1>/gi, "")
          .replace(/<[^>]*>/g, " ")
          .replace(/&nbsp;/g, " ")
          .replace(/&amp;/g, "&")
          .replace(/\s+/g, " ")
          .trim();
        return {
          content: [
            {
              type: "text",
              text:
                response.url +
                "\n" +
                text.slice(0, 80000) +
                (text.length > 80000 ? "\n（文本已截断）" : ""),
            },
          ],
          details: {},
        };
      },
    });
    const prompt =
      target.mode === "toutiao"
        ? editor
          ? TOUTIAO_EDITOR_BRIEF
          : buildToutiaoBrief(
              "S5 红笔与 S6 质检使用 writer_review 派独立编辑，传入 article 和完整任务；编辑交回回报后再推进验收。",
            )
        : [
            SYSTEM_BRIEF,
            editor
              ? FANQIE_EDITOR_BRIEF
              : buildFanqieBrief(
                  "使用 writer_review 派独立编辑，传入 work、chapter 和任务；按 fanqie_forge_get edit 审读，用 fanqie_review_report 交回报。",
                ),
          ].join("\n");
    const loader = new DefaultResourceLoader({
      cwd: target.root,
      agentDir: path.join(this.home, "agent"),
      noExtensions: true,
      noSkills: true,
      noPromptTemplates: true,
      systemPromptOverride: () =>
        prompt +
        "\n【独立客户端调用说明】当前模式与角色已启用，不调用 writer_enable。任务开头的 writer-context 是发送时的对象与已保存状态。它不是完整阅读凭据，版本变化时重读。按任务用既有工具读取必要规划、前章和正文；压缩摘要不代替作品事实。作者切页不改变本次任务。",
      appendSystemPromptOverride: () => [],
    });
    await loader.reload();
    const settings = this.settings();
    if (!settings.apiKey || !settings.model || !settings.baseUrl)
      throw new Error("请先在设置中填写模型接口、Key 和模型 ID。");
    const runtime = await ModelRuntime.create({
      authPath: path.join(this.home, "agent", "auth.json"),
      modelsPath: null,
      refreshOnCreate: false,
    });
    runtime.registerProvider("writer", {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      api: "openai-completions",
      models: [
        {
          id: settings.model,
          name: settings.model,
          reasoning: false,
          input: ["text"],
          cost: { input: 0, output: 0, cacheRead: 0, cacheWrite: 0 },
          contextWindow: settings.contextWindow,
          maxTokens: settings.maxTokens,
        },
      ],
    });
    const model = runtime.getModel("writer", settings.model);
    if (!model) throw new Error("模型配置未生效");
    const { session } = await createAgentSession({
      cwd: target.root,
      agentDir: path.join(this.home, "agent"),
      modelRuntime: runtime,
      model,
      thinkingLevel: "off",
      resourceLoader: loader,
      sessionManager: manager,
      tools: customTools.map((t) => t.name),
      customTools,
    });
    session.agent.toolExecution = "sequential";
    const entry = { session, target, focus: {} as Focus, phase: "" };
    session.subscribe((event) => {
      if (event.type === "message_end" && event.message.role === "user") {
        const content = event.message.content;
        const text =
          typeof content === "string"
            ? content
            : content
                .filter((c) => c.type === "text")
                .map((c) => c.text)
                .join("\n");
        entry.focus = promptContext(text).context?.focus || {};
      }
      if (event.type === "agent_start")
        entry.phase = editor ? "编辑审读中…" : "正在创作…";
      if (event.type === "tool_execution_start")
        entry.phase = toolLabel(event.toolName) + "…";
      if (event.type === "compaction_start")
        entry.phase = "正在整理对话上下文…";
      if (event.type === "auto_retry_start") entry.phase = "模型连接重试中…";
      if (event.type === "agent_settled") entry.phase = "";
      this.emit({
        key: this.key(target),
        target,
        editor,
        event,
        phase: entry.phase,
        focus: entry.focus,
      });
      if (
        [
          "agent_start",
          "tool_execution_start",
          "compaction_start",
          "auto_retry_start",
          "agent_settled",
        ].includes(event.type)
      )
        this.emit({ running: this.running() });
      if (event.type === "agent_settled") this.emit({ target, refresh: true });
    });
    if (!editor) {
      this.sessions.set(key, entry);
      await writeFile(
        path.join(dir, "current"),
        manager.getSessionFile()!,
        "utf8",
      );
    }
    return session;
  }
  private async paths(target: Target) {
    const project = (await listProjects()).find(
      (p) => p.id === projectIdOf(target.root),
    );
    return ensureStorage(null, {
      ...this.options.fanqie,
      storageRoot: target.root,
      ...(project?.worksRoot ? { worksRoot: project.worksRoot } : {}),
    });
  }
  private async taskPrompt(target: Target, text: string, focus: Focus) {
    const profile = await activeProfile(
      target.mode,
      this.options[target.mode]?.profile,
    );
    let saved: unknown;
    if (target.mode === "fanqie" && target.work) {
      const dir = await resolveWorkDir(await this.paths(target), target.work);
      const meta = await readWorkMeta(dir);
      const chapters: ChapterMeta[] = meta.chapters;
      const chapter = chapters.find((c) => c.id === focus.chapter);
      saved = {
        title: meta.title,
        chapters: meta.chapters.length,
        chapter: chapter
          ? {
              id: chapter.id,
              title: chapter.title,
              status: chapter.status,
              updatedAt: chapter.updatedAt,
            }
          : undefined,
      };
    } else if (target.mode === "toutiao" && focus.article) {
      const article = await new ArticleStore(target.root).get(focus.article);
      saved = {
        article: article.id,
        status: article.status,
        revision: article.current_rev,
      };
    }
    return promptText(text, {
      target,
      focus,
      profile: { id: profile.id, name: profile.name },
      saved,
    });
  }
  async send(target: Target, text: string, focus: Focus = {}) {
    const session = await this.open(target);
    const prepared = await this.taskPrompt(target, text, focus);
    // The SDK acknowledges preparation/queueing before the model finishes.
    await new Promise<void>((resolve, reject) => {
      let accepted = false;
      void session
        .prompt(prepared, {
          streamingBehavior: "followUp",
          expandPromptTemplates: false,
          preflightResult: () => {
            accepted = true;
            resolve();
          },
        })
        .then(
          () => resolve(),
          (error) => {
            if (!accepted) {
              reject(error);
              return;
            }
            const current =
              [...this.sessions.values()].find(
                (entry) => entry.session === session,
              )?.target || target;
            this.emit({
              target: current,
              error: String(error instanceof Error ? error.message : error),
            });
          },
        );
    });
  }
  private async attachCreated(
    entry: {
      session: AgentSession;
      target: Target;
      focus: Focus;
      phase: string;
    },
    work: string,
  ) {
    const previous = { ...entry.target },
      next = { ...previous, work };
    const key = this.key(next),
      dir = path.join(this.home, "sessions", key);
    if (this.sessions.has(key)) return;
    const exists = await access(path.join(dir, "current")).then(
      () => true,
      (error) => {
        if (error.code === "ENOENT") return false;
        throw error;
      },
    );
    if (exists) return;
    await mkdir(dir, { recursive: true });
    await writeFile(
      path.join(dir, "current"),
      entry.session.sessionManager.getSessionFile()!,
    );
    await rm(path.join(this.home, "sessions", this.key(previous), "current"), {
      force: true,
    });
    Object.assign(entry.target, next);
    this.sessions.delete(this.key(previous));
    this.sessions.set(key, entry);
    await this.created(previous, next);
  }
  private history(manager: SessionManager) {
    return manager.getBranch().flatMap<unknown>((entry) => {
      if (entry.type === "message") return [entry.message];
      if (entry.type === "custom_message" && entry.display)
        return [
          {
            role: "custom" as const,
            customType: entry.customType,
            content: entry.content,
            display: true,
            timestamp: Date.parse(entry.timestamp),
          },
        ];
      return [];
    });
  }
  running() {
    return [...this.sessions.values()]
      .filter((entry) => !entry.session.isIdle)
      .map((entry) => ({
        target: entry.target,
        focus: entry.focus,
        phase: entry.phase || "任务处理中…",
      }));
  }
  async view(target: Target, limit = 80) {
    const entry = this.sessions.get(this.key(target));
    let manager = entry?.session.sessionManager;
    if (!manager) {
      const marker = await readFile(
        path.join(this.home, "sessions", this.key(target), "current"),
        "utf8",
      ).catch((error) => {
        if (error.code === "ENOENT") return "";
        throw error;
      });
      if (
        marker &&
        (await access(marker).then(
          () => true,
          () => false,
        ))
      )
        manager = SessionManager.open(marker);
    }
    const messages = manager ? this.history(manager) : [];
    const streaming = entry?.session.agent.state.streamingMessage;
    const stream =
      streaming?.role === "assistant"
        ? streaming.content
            .filter((c) => c.type === "text")
            .map((c) => c.text)
            .join("")
        : "";
    return {
      messages: messages.slice(-limit),
      total: messages.length,
      busy: entry ? !entry.session.isIdle : false,
      stream,
      phase: entry?.phase || "",
      focus: entry?.focus,
    };
  }
  private async reviewResult(target: Target, focus: Focus) {
    let summary = "编辑运行结束，未读取到对应的审读结果，请查看回报。";
    if (target.mode === "fanqie" && target.work && focus.chapter) {
      const dir = await resolveWorkDir(await this.paths(target), target.work);
      const chapter = await readChapter(dir, focus.chapter);
      const info = await chapterReviewInfo(
        dir,
        focus.chapter,
        chapter.body,
        !!this.options.fanqie?.requireEditorPass,
      );
      const review = info.editorReview;
      summary = review
        ? `当前审读回报${review.stale ? "（对应旧正文）" : ""}：${review.verdict}，硬伤 ${review.hardIssues} 处，L1–L3 ${review.levels} 处。`
        : "编辑已结束，但没有本章的审读回报。";
    } else if (target.mode === "toutiao" && focus.article) {
      const store = new ArticleStore(target.root),
        meta = await store.get(focus.article),
        qa = meta.qa.at(-1);
      const valid = await validPassingQa(store, meta);
      summary = qa
        ? `质检 ${qa.score} 分，${valid.ok ? "当前有效" : valid.reason}；当前稿 rev ${meta.current_rev}。`
        : "编辑已结束，尚无质检结果。";
    }
    return {
      target: { ...target },
      focus,
      label: focusLabel(target, focus),
      summary,
    };
  }
  release(target: Target) {
    const key = this.key(target),
      entry = this.sessions.get(key);
    if (entry?.session.isIdle && !this.children.has(entry.session)) {
      entry.session.dispose();
      this.sessions.delete(key);
    }
  }
  async notify(
    target: Target,
    value: {
      operation: string;
      article?: string;
      chapter?: string;
      candidate?: string;
      revision?: string | number;
      status?: string;
      profile?: string;
    },
  ) {
    const session = this.sessions.get(this.key(target))?.session;
    if (session) {
      const names: Record<string, string> = {
        "/candidate/accept": "采纳候选稿",
        "/chapter/review": "声明已审读",
        "/chapter/finalize": "定稿",
        "/revision/acknowledge": "核对修订影响",
        "/diagnostics/stage": "保存修订候选",
        "/toutiao/adopt": "采用文章",
      };
      const action = names[value.operation] || "更新方法方案";
      const content = `作者已${action}；对象：${value.article || value.chapter || value.candidate || target.work || "当前项目"}${value.revision !== undefined ? `；版本：${value.revision}` : ""}${value.status ? `；状态：${value.status}` : ""}${value.profile ? `；方案：${value.profile}` : ""}。`;
      await session.sendCustomMessage(
        {
          customType: "writer-author",
          content,
          display: true,
        },
        { triggerTurn: false },
      );
    }
  }
  async stop(target: Target) {
    if (this.opening.has(this.key(target)))
      await this.opening.get(this.key(target));
    const session = this.sessions.get(this.key(target))?.session;
    if (session)
      await Promise.all([this.children.get(session)?.abort(), session.abort()]);
  }
  async dispose() {
    await Promise.allSettled(this.opening.values());
    for (const s of [
      ...this.children.values(),
      ...[...this.sessions.values()].map((entry) => entry.session),
    ]) {
      await s.abort();
      s.dispose();
    }
    this.sessions.clear();
  }
}
