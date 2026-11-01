import React from "react";
import {
  Send,
  Square,
  Plus,
  History,
  Feather,
  LoaderCircle,
  ArrowRight,
  AlertCircle,
} from "lucide-react";
import { Markdown } from "../../../Markdown";
import { humanVersion } from "../../../commands";
import { focusLabel, promptContext, toolLabel } from "../../../context";
import type { ChatMessage } from "../../state/store";
import { desktop } from "../../state/desktop";
import type { DesktopController } from "../../app/useDesktopController";

function messageBody(message: ChatMessage) {
  return typeof message.content === "string"
    ? message.content
    : (message.content || [])
        .filter((item: any) => item.type === "text")
        .map((item: any) => item.text)
        .join("\n");
}

export function AgentPanel({ app }: { app: DesktopController }) {
  const { state, selected, focus, context, fail, set, input } = app;
  const { task, busy, phase, messages, stream, total, archive, archives, text } = state;
  const steps =
    selected?.mode === "toutiao"
      ? ["S1 找题", "S2 立项", "S3 标题", "S4 成文", "S5 红笔", "S6 质检", "S7 交稿"]
      : ["读材料", "规划", "起草", "自检", "出候选", "送审"];
  const quick =
    context.kind === "article"
      ? context.article?.status === "已交稿"
        ? [
            ["续写", "继续推进"],
            ["交稿", "准备交稿"],
          ]
        : [
            ["续写", "继续推进"],
            ["派编辑", "派编辑红笔"],
            ["质检", "质检"],
          ]
      : context.chapter && !context.outlineReady
        ? [
            ["补全章纲", "补全章纲"],
            ["拆书", "参考拆书"],
          ]
        : context.hasCandidate
          ? [
              ["对照采纳", "对照采纳"],
              ["派编辑", "派编辑审"],
              ["改本章", "按回报修改"],
            ]
          : context.review?.verdict && context.review.verdict !== "通过"
            ? [
                ["改本章", "按回报修改"],
                ["派编辑", "重新审读"],
              ]
            : context.chapter?.status === "final"
              ? [
                  ["续写", "续写下一章"],
                  ["导出", "导出定稿"],
                ]
              : [
                  ["续写", "继续写作"],
                  ["派编辑", "派编辑审"],
                  ["质检", "检查本章"],
                ];
  function resultCard(result: any) {
    return (
      <div className={"result-card " + (result.failed ? "failed" : "")} data-kind={result.kind || "review"}>
        <strong>
          {{
            candidate: "候选稿",
            review: "审读回报",
            qa: "质检结果",
            delivery: "交稿单",
            planning: "规划回报",
          }[result.kind as string] || "任务回报"}
        </strong>
        <p>{result.summary}</p>
        <button onClick={() => app.jump(result.target, result.focus).catch(fail)}>
          对照查看 <ArrowRight size={14} />
        </button>
      </div>
    );
  }
  function renderMessage(message: ChatMessage, index: number) {
    const original = messageBody(message);
    if (!original) return null;
    if (message.role === "custom" && message.display === false) return null;
    if (message.role === "toolResult") {
      const result = message.details?.writerResult;
      return (
        <div key={index}>
          {result && resultCard(result)}
          <details className="tool-action">
            <summary>
              {toolLabel(message.toolName || "")}
              {!original.startsWith("{")
                ? " · " + original.split("\n")[0].replace(/^#+\s*/, "").slice(0, 54)
                : ""}
            </summary>
            <pre>{original}</pre>
          </details>
        </div>
      );
    }
    const parsed =
      message.role === "user"
        ? promptContext(original)
        : { text: original, context: null as any };
    return (
      <article className={"chat-message " + message.role} key={index}>
        <small>
          {message.role === "user" ? "你" : message.role === "custom" ? "作者操作" : "Agent"}
          {parsed.context?.focus?.title ? " · " + parsed.context.focus.title : ""}
          {parsed.context?.focus?.revision
            ? " · " + humanVersion(parsed.context.focus.revision)
            : ""}
        </small>
        <Markdown text={parsed.text} />
      </article>
    );
  }
  return (
    <div className="agent-panel">
      {task && (
        <section className="task-card" aria-label="当前任务">
          <header>
            <strong>
              {busy ? "正在进行" : "任务结束"} · {task.name || phase}
            </strong>
            <button
              className="icon-button"
              disabled={!busy}
              aria-label="停止任务"
              onClick={() => app.stop().catch(fail)}
            >
              <Square size={13} />
            </button>
          </header>
          <div className="task-track">
            {steps.map((step) => (
              <span
                key={step}
                title={step}
                className={
                  task.completed?.includes(step) ? "done" : task.current === step ? "current" : ""
                }
              />
            ))}
          </div>
          <p>
            {task.completed?.length ? "已完成：" + task.completed.join(" → ") + " · " : ""}
            {busy ? "当前：" + (task.current || phase) : task.waiting}
          </p>
        </section>
      )}
      <div className="conversation-tools">
        <button
          onClick={async () => {
            try {
              set({ archives: await desktop.conversations(selected!) });
              set({ palette: false });
            } catch (error) {
              fail(error);
            }
          }}
        >
          <History size={13} />
          历史
        </button>
        <select
          aria-label="历史对话"
          value={archive ?? "current"}
          onChange={async (event) => {
            const value = event.target.value === "current" ? undefined : Number(event.target.value);
            app.archived.current = value;
            set({ archive: value });
            await app.loadView(selected!, 80, value);
          }}
        >
          <option value="current">当前对话</option>
          {archives.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button title="新对话，保留作品" onClick={() => app.command("新对话").catch(fail)}>
          <Plus size={14} />
        </button>
      </div>
      <div className="chat-messages">
        {messages.length < total && (
          <button
            onClick={() => {
              app.limit.current += 80;
              void app.loadView(selected!, app.limit.current, archive).catch(fail);
            }}
          >
            查看更早记录
          </button>
        )}
        {messages.map(renderMessage)}
        {stream && (
          <article className="chat-message assistant">
            <small>Agent</small>
            <Markdown text={stream} />
          </article>
        )}
        {!messages.length && !stream && (
          <div className="chat-empty">
            <Feather size={24} />
            <p>从一句想法开始，或选择下方动作。稿件、候选与作者决定都会保留在作品里。</p>
          </div>
        )}
      </div>
      <div className="agent-input-area">
        <div className="quick-actions">
          {quick.map(([id, label]) => (
            <button
              disabled={state.system?.access?.readOnly || !selected}
              key={id}
              onClick={() => app.command(id).catch(fail)}
            >
              {label}
            </button>
          ))}
          <button onClick={() => set({ palette: true, query: "" })}>/ 更多命令</button>
        </div>
        <form onSubmit={app.send}>
          <div className="input-target">
            {selected ? focusLabel(selected, focus) : "尚未选择作品"}
            {focus.revision !== undefined ? " · " + humanVersion(focus.revision) : ""}
          </div>
          {busy && task && <small className="running-target">运行任务仍处理发送时的对象</small>}
          {focus.dirty && <small className="form-warning">段落尚未保存；Agent 使用已保存稿件。</small>}
          <textarea
            ref={input}
            aria-label="写作要求"
            placeholder="继续说要求，Enter 发送 · Shift+Enter 换行"
            value={text}
            onChange={(event) => set({ text: event.target.value })}
            onKeyDown={(event) => {
              if (event.key === "/" && !text) {
                event.preventDefault();
                set({ palette: true, query: "" });
              }
              if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
                event.preventDefault();
                void app.send();
              }
            }}
          />
          <footer>
            <span>
              {task?.tokens ? task.tokens.toLocaleString() + " tokens" : "本地作品 · 由你决定"}
              {task?.tokens
                ? " · " + (task.cost > 0 ? "$" + task.cost.toFixed(4) : "费用以服务商账单为准")
                : ""}
            </span>
            <button
              className="primary"
              disabled={!selected || archive !== undefined}
              aria-label="发送"
            >
              <Send size={14} />
              {busy ? "排队" : "发送"}
            </button>
          </footer>
        </form>
      </div>
    </div>
  );
}
