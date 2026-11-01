import React, { useCallback, useEffect, useRef, useState } from "react";
import { createRoot } from "react-dom/client";
import "@fontsource/noto-sans-sc/400.css";
import "@fontsource/noto-sans-sc/600.css";
import "@fontsource/noto-serif-sc/400.css";
import "../../../packages/workbench/src/client/styles.css";
import "./desktop.css";
import {
  BookOpen,
  ChevronDown,
  Command,
  Settings as SettingsIcon,
  Send,
  Square,
  Plus,
  Search,
  History,
  FileDown,
  Copy,
  PanelRightOpen,
  X,
  Check,
  ArrowRight,
  AlertCircle,
  Feather,
  LoaderCircle,
} from "lucide-react";
import { Workspace } from "./Workspace";
import { Settings, ModelFields } from "./Settings.jsx";
import { Markdown } from "./Markdown";
import { COMMANDS, humanVersion } from "./commands";
import { scopeId, focusLabel, promptContext, toolLabel } from "./context";
import {
  PREF,
  readPref,
  writePref,
} from "../../../packages/workbench/src/client/shared/prefs.js";
const api = window.writerDesktop;
const refresh = () => window.dispatchEvent(new Event("writer:refresh"));
function messageBody(message) {
  return typeof message.content === "string"
    ? message.content
    : (message.content || [])
        .filter((item) => item.type === "text")
        .map((item) => item.text)
        .join("\n");
}
function remember(target, focus = {}, preserve = false) {
  if (target.mode === "fanqie") {
    writePref(PREF.project, "");
    writePref(PREF.work, target.work || "");
    if (!preserve) {
      writePref(PREF.chapter, focus.chapter || "");
      writePref(PREF.candidate, focus.candidate || "");
      writePref(PREF.readerView, focus.candidate ? "candidate" : "official");
    }
    if (focus.chapter) writePref(PREF.view, "chapters");
  } else {
    writePref(PREF.ttRoot, target.root);
    if (!preserve) writePref(PREF.ttArticle, focus.article || "");
  }
}
function App() {
  const [onboarding, setOnboarding] = useState(null);
  const [state, setState] = useState(null),
    [focus, setFocus] = useState({}),
    [context, setContext] = useState({});
  const [messages, setMessages] = useState([]),
    [stream, setStream] = useState(""),
    [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [task, setTask] = useState(null),
    [running, setRunning] = useState([]);
  const [text, setText] = useState(""),
    [error, setError] = useState(""),
    [tab, setTab] = useState("agent"),
    [view, setView] = useState("writing"),
    [drawer, setDrawer] = useState(false),
    [settings, setSettings] = useState(false);
  const [projects, setProjects] = useState([]),
    [picker, setPicker] = useState(false),
    [palette, setPalette] = useState(false),
    [query, setQuery] = useState(""),
    [workspaceKey, setWorkspaceKey] = useState(0);
  const [total, setTotal] = useState(0),
    [archive, setArchive] = useState(undefined),
    [archives, setArchives] = useState([]),
    [wizardStep, setWizardStep] = useState(0),
    [wizardModels, setWizardModels] = useState(null),
    [connectionResult, setConnectionResult] = useState(null);
  const selected = useRef(null),
    focused = useRef({}),
    limit = useRef(80),
    viewRequest = useRef(0),
    pendingMessages = useRef(null),
    input = useRef(null),
    archived = useRef(undefined);
  function fail(error) {
    setError(error?.message || String(error));
  }
  function setPosition(next) {
    focused.current = next;
    setFocus(next);
  }
  async function syncState() {
    const value = await api.state();
    setState(value);
    setWizardModels((previous) => previous || value.models);
    setOnboarding((previous) =>
      previous === null
        ? !value.models.writer.configured || !value.workspace
        : previous,
    );
    if (value.notice) setError(value.notice);
    return value;
  }
  async function loadProjects() {
    setProjects(await api.projects());
  }
  async function loadView(target, maximum = 80, old = undefined) {
    const request = ++viewRequest.current,
      buffer = [];
    pendingMessages.current = buffer;
    try {
      const value = await api.view(target, maximum, old);
      if (
        request !== viewRequest.current ||
        scopeId(target) !== scopeId(selected.current)
      )
        return;
      const known = new Set(
          value.messages.map((message) => message.writerMessageId),
        ),
        extra = buffer.filter((message) => !message.writerMessageId || !known.has(message.writerMessageId));
      setMessages([...value.messages, ...extra]);
      setTotal(value.total + extra.length);
      setBusy(value.busy);
      setPhase(value.phase || "");
      setStream(value.stream);
      setTask(value.task || null);
    } finally {
      if (pendingMessages.current === buffer) pendingMessages.current = null;
    }
  }
  async function selectSnapshot(next, persist = true, reopen = false) {
    if (!next) return;
    const { focus: nextFocus = {}, ...target } = next,
      previous = selected.current;
    if (scopeId(previous) === scopeId(target)) {
      if (reopen) {
        await api.select(target);
        if (scopeId(selected.current) !== scopeId(target)) return;
        await syncState();
      }
      if (next.focus) setPosition(nextFocus);
      return;
    }
    setPosition(nextFocus);
    const preserve =
      !previous &&
      (target.mode === "fanqie"
        ? readPref(PREF.work) === (target.work || "")
        : readPref(PREF.ttRoot) === target.root);
    remember(target, nextFocus, preserve);
    selected.current = target;
    archived.current = undefined;
    setArchive(undefined);
    limit.current = 80;
    setMessages([]);
    setStream("");
    setTask(null);
    setBusy(false);
    const chosen = persist ? await api.select(target) : target;
    if (scopeId(selected.current) !== scopeId(target)) return;
    selected.current = chosen;
    await syncState();
    await loadView(chosen);
    setArchives(await api.conversations(chosen));
  }
  useEffect(() => {
    void (async () => {
      const value = await syncState();
      if (value.target) await selectSnapshot(value.target, false);
      setRunning(await api.running());
      await loadProjects();
    })().catch(fail);
  }, []);
  useEffect(() => {
    if (!state) return;
    const appearance = state.appearance,
      media = window.matchMedia("(prefers-color-scheme: dark)");
    const update = () => {
      document.documentElement.dataset.theme =
        appearance.theme === "system"
          ? media.matches
            ? "dark"
            : "light"
          : appearance.theme;
      document.documentElement.dataset.font = appearance.font;
      document.documentElement.style.setProperty(
        "--paper-font-size",
        appearance.fontSize + "px",
      );
    };
    update();
    media.addEventListener("change", update);
    return () => media.removeEventListener("change", update);
  }, [state?.appearance]);
  useEffect(() => {
    const selection = (event) => {
      void selectSnapshot(event.detail).catch(fail);
    };
    window.addEventListener("writer:target", selection);
    const unsubscribe = api.subscribe((value) => {
      if (value.running) setRunning(value.running);
      if (value.updates)
        setState((previous) => ({ ...previous, updates: value.updates }));
      if (value.navigate) {
        void jump(value.navigate, value.focus).catch(fail);
        return;
      }
      if (value.selection) {
        void selectSnapshot(value.selection, false).catch(fail);
        return;
      }
      if (value.target && scopeId(value.target) !== scopeId(selected.current))
        return;
      if (value.error) {
        setError(value.error);
        return;
      }
      if (value.refresh) {
        refresh();
        void loadProjects().catch(fail);
      }
      const event = value.event;
      if (!event) return;
      if (value.phase) setPhase(value.phase);
      if (value.task && !value.editor) setTask({ ...value.task });
      if (value.editor) return;
      if (event.type === "agent_start") {
        setBusy(true);
        setStream("");
      }
      if (
        event.type === "compaction_start" ||
        event.type === "auto_retry_start"
      )
        setBusy(true);
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      )
        setStream((previous) => previous + event.assistantMessageEvent.delta);
      if (event.type === "message_end") {
        if (archived.current !== undefined) return;
        if (pendingMessages.current)
          pendingMessages.current.push(event.message);
        else {
          setMessages((previous) =>
            [...previous, event.message].slice(-limit.current),
          );
          setTotal((previous) => previous + 1);
        }
        if (event.message.role === "assistant") setStream("");
        if (event.message.errorMessage) setError(event.message.errorMessage);
      }
      if (event.type === "agent_settled") {
        setBusy(false);
        setStream("");
        setPhase(
          event.aborted ? "已停止，已保存结果保留" : "任务结束，等待你查看结果",
        );
        refresh();
      }
    });
    return () => {
      unsubscribe();
      window.removeEventListener("writer:target", selection);
    };
  }, []);
  useEffect(() => {
    const keyboard = (event) => {
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setPalette((value) => !value);
        setQuery("");
      }
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        window.dispatchEvent(new Event("writer:save-paragraph"));
      }
      if (
        (event.ctrlKey || event.metaKey) &&
        ["1", "2", "3"].includes(event.key)
      ) {
        event.preventDefault();
        setTab(["agent", "chapter", "methods"][Number(event.key) - 1]);
        setDrawer(true);
      }
      if (event.key === "Escape") {
        if (palette) {
          setPalette(false);
          return;
        }
        if (settings) {
          setSettings(false);
          return;
        }
        if (busy && window.confirm("停止当前任务？已保存的稿件不会撤销。"))
          void api.stop(selected.current).catch(fail);
        else setDrawer(false);
      }
    };
    window.addEventListener("keydown", keyboard);
    return () => window.removeEventListener("keydown", keyboard);
  }, [busy, palette, settings]);
  const methodEdit = useRef({ dirty: false, saving: false });
  const trackMethodEdit = useCallback((value) => {
    methodEdit.current = value;
  }, []);
  function canLeave() {
    if (methodEdit.current.saving) {
      setError("方法方案正在保存，请稍后再切换。");
      return false;
    }
    const unsaved = [
      focused.current.dirty && "段落",
      methodEdit.current.dirty && "方法方案",
    ].filter(Boolean);
    return (
      !unsaved.length ||
      window.confirm(
        `当前${unsaved.join("和")}有未保存修改，离开将放弃这些修改。是否继续？`,
      )
    );
  }
  async function chooseWorkspace() {
    if (!canLeave()) return;
    const value = await api.workspace();
    if (!value) return;
    await selectSnapshot(value.target, false);
    await syncState();
    setWorkspaceKey((key) => key + 1);
    refresh();
    await loadProjects();
  }
  async function importRoot(mode) {
    if (!canLeave()) return;
    const value = await api.choose(mode);
    if (!value) return;
    await selectSnapshot(value, false);
    await syncState();
    setWorkspaceKey((key) => key + 1);
    await loadProjects();
  }
  async function jump(target, nextFocus = {}) {
    if (!canLeave()) return;
    remember(target, nextFocus);
    await selectSnapshot({ ...target, focus: nextFocus }, true, true);
    setWorkspaceKey((key) => key + 1);
    setView("writing");
    setPicker(false);
    refresh();
  }
  async function sendText(value, snapshot = focused.current) {
    if (!selected.current) throw new Error("先选择作品或开始新作");
    if (archived.current !== undefined)
      throw new Error("当前查看的是旧对话，请先返回当前对话");
    await api.send(value, selected.current, { ...snapshot });
    setTab("agent");
    setDrawer(true);
    setError("");
  }
  async function send(event) {
    event?.preventDefault();
    if (!text.trim()) return;
    const original = text;
    try {
      if (original.startsWith("/")) {
        const [name, ...parts] = original.slice(1).split(/\s+/);
        await command(name, parts.join(" "));
      } else await sendText(original);
      setText((current) => (current === original ? "" : current));
    } catch (error) {
      fail(error);
    }
  }
  async function newWork(mode, note = "") {
    if (!canLeave()) return;
    const next = await api.newTarget(mode);
    await selectSnapshot(next, false);
    setWorkspaceKey((key) => key + 1);
    setView("writing");
    setTab("agent");
    setDrawer(true);
    if (mode === "toutiao")
      await api.request("/toutiao/agent/deliver", {
        method: "POST",
        body: {
          root: next.root,
          action: "new",
          note,
          confirm: true,
          requestId: crypto.randomUUID(),
        },
      });
    else
      await sendText(
        "创建一本新的长篇作品。" +
          (note
            ? "书名、题材或想法：" + note
            : "先和我确定书名与一句话题材。") +
          "作品创建后可用 writer_plan 完成开书规划；先完成本次规划，不自动写正文。",
        { intent: "plan" },
      );
    setPicker(false);
    setOnboarding(false);
  }
  async function deliver(action, note = "") {
    const target = selected.current,
      snapshot = { ...focused.current };
    if (!target) throw new Error("请先选择作品");
    const body =
      target.mode === "fanqie"
        ? {
            base: target.root,
            work: target.work,
            chapter: action === "continue" ? undefined : snapshot.chapter,
            action,
            note,
            confirm: true,
            requestId: crypto.randomUUID(),
          }
        : {
            root: target.root,
            id: snapshot.article,
            action,
            note,
            confirm: true,
            requestId: crypto.randomUUID(),
          };
    await api.request(
      target.mode === "fanqie" ? "/agent/deliver" : "/toutiao/agent/deliver",
      { method: "POST", body },
    );
    setTab("agent");
    setDrawer(true);
  }
  async function command(name, args = "") {
    setPalette(false);
    setQuery("");
    if (name === "对照采纳")
      return jump(selected.current, {
        ...focused.current,
        candidate: context.candidate?.id,
      });
    if (name === "补全章纲")
      return sendText(
        "使用 writer_plan 读取本书已保存的规划，补齐当前章纲缺项；不要写正文。" +
          args,
        { ...focused.current, intent: "plan" },
      );
    if (name === "新书") return newWork("fanqie", args);
    if (name === "续写") return deliver("continue", args);
    if (name === "改本章") return deliver("revise", args);
    if (name === "派编辑") return deliver("review", args);
    if (name === "拆书")
      return sendText(
        "使用 writer_plan 拆解以下指定原文或链接。只完成分析，不自动入库或改写本书。" +
          (args || "先请我提供原文片段或链接。"),
        { ...focused.current, intent: "plan" },
      );
    if (name === "质检")
      return sendText(
        selected.current?.mode === "toutiao"
          ? "对当前文章运行 toutiao_qa_check，回报实际分数、硬闸与 fails，不自动采用。"
          : "对当前章节运行 fanqie_style_lint 与 fanqie_ledger_check，回报值得核对的位置，不自动改稿或定稿。",
        { ...focused.current, intent: "review" },
      );
    if (name === "交稿") {
      if (selected.current?.mode === "toutiao")
        return deliver("continue", args);
      return exportFile("txt");
    }
    if (name === "导出") return exportFile("txt");
    if (name === "新对话") {
      if (!selected.current) throw new Error("请先打开作品");
      await api.newConversation(selected.current);
      archived.current = undefined;
      setArchive(undefined);
      setArchives(await api.conversations(selected.current));
      await loadView(selected.current);
      setPhase("新对话已准备，作品保留；下一条指令会自动带入交接。");
      return;
    }
    throw new Error("未识别的命令，请从命令面板选择");
  }
  async function exportFile(format) {
    if (!selected.current) return;
    const result = await api.export(selected.current, focused.current, format);
    if (result) setPhase(result.copied ? "标题与正文已复制" : "稿件已导出");
  }
  function resultCard(result) {
    return (
      <div
        className={"result-card " + (result.failed ? "failed" : "")}
        data-kind={result.kind || "review"}
      >
        <strong>
          {{
            candidate: "候选稿",
            review: "审读回报",
            qa: "质检结果",
            delivery: "交稿单",
            planning: "规划回报",
          }[result.kind] || "任务回报"}
        </strong>
        <p>{result.summary}</p>
        <button onClick={() => jump(result.target, result.focus).catch(fail)}>
          对照查看 <ArrowRight size={14} />
        </button>
      </div>
    );
  }
  function renderMessage(message, index) {
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
                ? " · " +
                  original
                    .split("\n")[0]
                    .replace(/^#+\s*/, "")
                    .slice(0, 54)
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
        : { text: original, context: null };
    return (
      <article className={"chat-message " + message.role} key={index}>
        <small>
          {message.role === "user"
            ? "你"
            : message.role === "custom"
              ? "作者操作"
              : "Agent"}
          {parsed.context?.focus?.title
            ? " · " + parsed.context.focus.title
            : ""}
          {parsed.context?.focus?.revision
            ? " · " + humanVersion(parsed.context.focus.revision)
            : ""}
        </small>
        <Markdown text={parsed.text} />
      </article>
    );
  }
  if (!state)
    return (
      <div className="startup">
        <LoaderCircle className="spin" />
        正在打开写作 Agent…
      </div>
    );
  const needsWizard = onboarding === true;
  const steps =
    selected.current?.mode === "toutiao"
      ? [
          "S1 找题",
          "S2 立项",
          "S3 标题",
          "S4 成文",
          "S5 红笔",
          "S6 质检",
          "S7 交稿",
        ]
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
  const agent = (
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
              onClick={() => api.stop(selected.current).catch(fail)}
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
                  task.completed?.includes(step)
                    ? "done"
                    : task.current === step
                      ? "current"
                      : ""
                }
              />
            ))}
          </div>
          <p>
            {task.completed?.length
              ? "已完成：" + task.completed.join(" → ") + " · "
              : ""}
            {busy ? "当前：" + (task.current || phase) : task.waiting}
          </p>
        </section>
      )}
      <div className="conversation-tools">
        <button
          onClick={async () => {
            try {
              setArchives(await api.conversations(selected.current));
              setPalette(false);
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
            const value =
              event.target.value === "current"
                ? undefined
                : Number(event.target.value);
            archived.current = value;
            setArchive(value);
            await loadView(selected.current, 80, value);
          }}
        >
          <option value="current">当前对话</option>
          {archives.map((item) => (
            <option key={item.id} value={item.id}>
              {item.name}
            </option>
          ))}
        </select>
        <button
          title="新对话，保留作品"
          onClick={() => command("新对话").catch(fail)}
        >
          <Plus size={14} />
        </button>
      </div>
      <div className="chat-messages">
        {messages.length < total && (
          <button
            onClick={() => {
              limit.current += 80;
              void loadView(selected.current, limit.current, archive).catch(
                fail,
              );
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
            <p>
              从一句想法开始，或选择下方动作。稿件、候选与作者决定都会保留在作品里。
            </p>
          </div>
        )}
      </div>
      <div className="agent-input-area">
        <div className="quick-actions">
          {quick.map(([id, label]) => (
            <button
              disabled={state.access?.readOnly || !selected.current}
              key={id}
              onClick={() => command(id).catch(fail)}
            >
              {label}
            </button>
          ))}
          <button
            onClick={() => {
              setPalette(true);
              setQuery("");
            }}
          >
            / 更多命令
          </button>
        </div>
        <form onSubmit={send}>
          <div className="input-target">
            {selected.current
              ? focusLabel(selected.current, focus)
              : "尚未选择作品"}
            {focus.revision !== undefined
              ? " · " + humanVersion(focus.revision)
              : ""}
          </div>
          {busy && task && (
            <small className="running-target">运行任务仍处理发送时的对象</small>
          )}
          {focus.dirty && (
            <small className="form-warning">
              段落尚未保存；Agent 使用已保存稿件。
            </small>
          )}
          <textarea
            ref={input}
            aria-label="写作要求"
            placeholder="继续说要求，Enter 发送 · Shift+Enter 换行"
            value={text}
            onChange={(event) => setText(event.target.value)}
            onKeyDown={(event) => {
              if (event.key === "/" && !text) {
                event.preventDefault();
                setPalette(true);
                setQuery("");
              }
              if (
                event.key === "Enter" &&
                !event.shiftKey &&
                !event.nativeEvent.isComposing
              ) {
                event.preventDefault();
                void send();
              }
            }}
          />
          <footer>
            <span>
              {task?.tokens
                ? task.tokens.toLocaleString() + " tokens"
                : "本地作品 · 由你决定"}
              {task?.tokens
                ? " · " +
                  (task.cost > 0
                    ? "$" + task.cost.toFixed(4)
                    : "费用以服务商账单为准")
                : ""}
            </span>
            <button
              className="primary"
              disabled={!selected.current || archive !== undefined}
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
  return (
    <div className="writer-desktop wb-scope">
      <header className="studio-topbar">
        <div className="studio-brand">
          <Feather size={18} />
        </div>
        <button className="project-switch" onClick={() => setPicker(!picker)}>
          <BookOpen size={15} />
          <span>
            {focus.workTitle ||
              focus.title ||
              selected.current?.work ||
              (selected.current?.mode === "toutiao" ? "今日头条" : "选择作品")}
          </span>
          <ChevronDown size={13} />
        </button>
        <nav className="view-switch">
          {[
            ["writing", "写作"],
            ["overview", "全书概况"],
            ["library", "拆书库"],
          ].map(([id, label]) => (
            <button
              className={view === id ? "active" : ""}
              key={id}
              onClick={() => setView(id)}
            >
              {label}
            </button>
          ))}
        </nav>
        <span className="model-status">
          <i data-ready={state.models.writer.configured} />
          {state.models.writer.model}
          <small> · 编辑 {state.models.editor.model}</small>
        </span>
        <button
          className="icon-button"
          aria-label="导出稿件"
          onClick={() => exportFile("txt").catch(fail)}
        >
          <FileDown size={16} />
        </button>
        <button
          className="icon-button"
          aria-label="复制标题与正文"
          onClick={() => exportFile("copy").catch(fail)}
        >
          <Copy size={15} />
        </button>
        <button
          className="icon-button"
          aria-label="导出 Word"
          onClick={() => exportFile("docx").catch(fail)}
        >
          W
        </button>
        <button
          className="command-button"
          onClick={() => {
            setPalette(true);
            setQuery("");
          }}
        >
          <Command size={14} />
          <span>Ctrl K</span>
        </button>
        <button
          className="icon-button"
          aria-label="设置"
          onClick={() => setSettings(true)}
        >
          <SettingsIcon size={17} />
        </button>
        <button
          className="sidebar-open icon-button"
          aria-label="打开右栏"
          onClick={() => setDrawer(!drawer)}
        >
          <PanelRightOpen size={18} />
        </button>
      </header>
      {picker && (
        <div className="project-menu">
          <h3>最近作品</h3>
          {projects.map((item, index) => (
            <button
              key={index}
              onClick={() => jump(item.target, item.focus).catch(fail)}
            >
              <BookOpen size={14} />
              {item.label}
              <small>{item.target.mode === "fanqie" ? "长篇" : "头条"}</small>
            </button>
          ))}
          <div className="menu-actions">
            <button onClick={() => newWork("fanqie").catch(fail)}>
              <Plus size={14} />
              新书
            </button>
            <button onClick={() => newWork("toutiao").catch(fail)}>
              <Plus size={14} />
              新头条
            </button>
            <button onClick={() => chooseWorkspace().catch(fail)}>
              选择写作根
            </button>
          </div>
        </div>
      )}
      {state.access?.readOnly && (
        <div className="readonly-banner">
          <AlertCircle size={15} />
          当前作品由 {state.access.owner?.host || "另一应用"}{" "}
          占用，只读。关闭另一应用中的作品后，重新打开即可写入。
        </div>
      )}
      {running.filter(
        (item) => scopeId(item.target) !== scopeId(selected.current),
      ).length > 0 && (
        <div className="background-tasks">
          {running
            .filter(
              (item) => scopeId(item.target) !== scopeId(selected.current),
            )
            .map((item) => (
              <button
                key={scopeId(item.target)}
                onClick={() => jump(item.target, item.focus).catch(fail)}
              >
                <LoaderCircle size={13} className="spin" />
                {focusLabel(item.target, item.focus)} · {item.phase}
              </button>
            ))}
        </div>
      )}
      {error && (
        <div className="studio-error" role="alert">
          <AlertCircle size={16} />
          {error}
          <button
            className="icon-button"
            aria-label="关闭提示"
            onClick={() => setError("")}
          >
            <X size={15} />
          </button>
        </div>
      )}
      {state.target ? (
        <Workspace
          key={scopeId(state.target) + workspaceKey}
          target={state.target}
          view={view}
          agent={agent}
          tab={tab}
          setTab={setTab}
          drawer={drawer}
          setDrawer={setDrawer}
          readOnly={state.access?.readOnly}
          onContext={setContext}
          onMethodEditState={trackMethodEdit}
        />
      ) : (
        <div className="studio-empty">
          <h1>你的下一篇，从这里开始</h1>
          <p>先连接模型并选择写作根，小说与头条会统一整理在本地。</p>
          <button className="primary" onClick={() => setWizardStep(0)}>
            开始设置
          </button>
        </div>
      )}
      {settings && (
        <Settings
          state={state}
          onClose={() => setSettings(false)}
          onSaved={async () => {
            await syncState();
            if (selected.current) await loadView(selected.current);
            refresh();
          }}
          onWorkspace={chooseWorkspace}
          onImport={importRoot}
        />
      )}
      {needsWizard && wizardModels && (
        <div className="studio-backdrop onboarding">
          <section role="dialog" aria-modal="true" aria-label="开始创作">
            <div className="onboarding-brand">
              <Feather size={28} />
              <h1>写作 Agent</h1>
              <p>把想法写成作品，让决定留在你手中。</p>
            </div>
            <ol className="onboarding-steps">
              {["连接模型", "选择写作根", "开始创作"].map((label, index) => (
                <li key={label} data-active={wizardStep === index}>
                  {index < wizardStep ? <Check size={13} /> : index + 1} {label}
                </li>
              ))}
            </ol>
            {wizardStep === 0 && (
              <>
                <ModelFields
                  role="writer"
                  model={wizardModels.writer}
                  onChange={(value) =>
                    setWizardModels((previous) => ({
                      ...previous,
                      writer: value,
                    }))
                  }
                  onTest={async () => {
                    setConnectionResult({ busy: true });
                    try {
                      setConnectionResult(
                        await api.testModel("writer", wizardModels.writer),
                      );
                    } catch (error) {
                      setConnectionResult({ error: error.message });
                    }
                  }}
                  result={connectionResult}
                />
                <p className="form-note">
                  编辑默认用 DeepSeek Reasoner 开启思考；可稍后在设置中更换。
                </p>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      if (
                        !wizardModels.writer.apiKey &&
                        !wizardModels.writer.configured
                      )
                        throw new Error("请填写写手模型的 API Key");
                      await api.model(wizardModels);
                      await syncState();
                      setWizardStep(1);
                    } catch (error) {
                      fail(error);
                    }
                  }}
                >
                  保存连接并继续 <ArrowRight size={14} />
                </button>
              </>
            )}
            {wizardStep === 1 && (
              <div className="wizard-root">
                <h2>作品都在你自己的目录里</h2>
                <p>
                  写作根下统一管理 novels、toutiao
                  和共用偏好。已有稿件仍可从设置中导入，不会搬动原文件。
                </p>
                <button
                  className="primary"
                  onClick={async () => {
                    try {
                      await chooseWorkspace();
                      const value = await syncState();
                      if (value.workspace) setWizardStep(2);
                    } catch (error) {
                      fail(error);
                    }
                  }}
                >
                  选择写作根 <ArrowRight size={14} />
                </button>
              </div>
            )}
            {wizardStep === 2 && (
              <div className="start-options">
                <button onClick={() => newWork("fanqie").catch(fail)}>
                  <BookOpen />
                  开第一本书
                </button>
                <button onClick={() => newWork("toutiao").catch(fail)}>
                  <Feather />
                  写一篇头条
                </button>
                <button
                  onClick={() => {
                    setPicker(true);
                    setOnboarding(false);
                  }}
                >
                  打开已有作品
                </button>
              </div>
            )}
          </section>
        </div>
      )}
      {palette && (
        <div
          className="studio-backdrop command-backdrop"
          onClick={() => setPalette(false)}
        >
          <section
            role="dialog"
            aria-modal="true"
            aria-label="命令面板"
            onClick={(event) => event.stopPropagation()}
          >
            <label className="command-search">
              <Search size={18} />
              <input
                autoFocus
                placeholder="输入命令或任务附言…"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
              />
            </label>
            <div className="command-list">
              {COMMANDS.filter(
                (item) =>
                  !query ||
                  item.id.includes(query.split(/\s+/)[0].replace(/^\//, "")) ||
                  item.label.includes(query),
              ).map((item) => (
                <button
                  key={item.id}
                  onClick={() =>
                    command(
                      item.id,
                      query.split(/\s+/).slice(1).join(" "),
                    ).catch(fail)
                  }
                >
                  <span>
                    <strong>/{item.id}</strong>
                    <small>{item.hint}</small>
                  </span>
                  <ArrowRight size={15} />
                </button>
              ))}
            </div>
          </section>
        </div>
      )}
    </div>
  );
}
createRoot(document.getElementById("root")).render(<App />);
