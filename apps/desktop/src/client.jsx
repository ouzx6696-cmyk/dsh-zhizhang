import React, { useEffect, useState, useRef } from "react";
import { createRoot } from "react-dom/client";
import { Shell } from "../../../packages/workbench/src/client/Shell.jsx";
import "../../../packages/workbench/src/client/styles.css";
import "./desktop.css";
import {
  PREF,
  writePref,
  readPref,
} from "../../../packages/workbench/src/client/shared/prefs.js";
import { VERSION } from "../../../packages/core/src/version";
import { scopeId, focusLabel, promptContext, toolLabel } from "./context";
const api = window.writerDesktop;
const refresh = () => window.dispatchEvent(new Event("writer:refresh"));
function messageText(message) {
  const text =
    typeof message.content === "string"
      ? message.content
      : (message.content || [])
          .filter((c) => c.type === "text")
          .map((c) => c.text)
          .join("\n");
  return message.role === "user" ? promptContext(text).text : text;
}
function prefs(target, focus = {}, keepPosition = false) {
  if (target.mode === "fanqie") {
    writePref(PREF.project, "");
    writePref(PREF.work, target.work || "");
    if (!keepPosition) writePref(PREF.chapter, focus.chapter || "");
    if (focus.chapter) writePref(PREF.view, "chapters");
    if (!keepPosition)
      writePref(PREF.readerView, focus.candidate ? "candidate" : "official");
  } else {
    writePref(PREF.ttRoot, target.root);
    if (!keepPosition) writePref(PREF.ttArticle, focus.article || "");
  }
}
function App() {
  const [state, setState] = useState(null),
    [settings, setSettings] = useState(false),
    [chat, setChat] = useState(true);
  const [text, setText] = useState(""),
    [messages, setMessages] = useState([]),
    [stream, setStream] = useState("");
  const [busy, setBusy] = useState(false),
    [phase, setPhase] = useState(""),
    [error, setError] = useState("");
  const [taskFocus, setTaskFocus] = useState({});
  const [focus, setFocus] = useState({}),
    [running, setRunning] = useState([]),
    [total, setTotal] = useState(0);
  const [form, setForm] = useState({}),
    [workspace, setWorkspace] = useState(0);
  const selected = useRef(null),
    focused = useRef({}),
    viewRequest = useRef(0),
    historyLimit = useRef(80),
    loadingMessages = useRef(null);
  const setCurrentFocus = (value) => {
    focused.current = value;
    setFocus(value);
  };

  async function loadView(target, limit = 80) {
    const version = ++viewRequest.current;
    const pending = [];
    loadingMessages.current = pending;
    let view;
    try {
      view = await api.view(target, limit);
    } catch (error) {
      if (loadingMessages.current === pending) {
        loadingMessages.current = null;
        setMessages((current) => [...current, ...pending]);
      }
      throw error;
    }
    if (
      version !== viewRequest.current ||
      scopeId(selected.current) !== scopeId(target)
    ) {
      if (loadingMessages.current === pending) loadingMessages.current = null;
      return;
    }
    loadingMessages.current = null;
    const known = new Set(view.messages.map((m) => JSON.stringify(m)));
    const extra = pending.filter((m) => !known.has(JSON.stringify(m)));
    setMessages([...view.messages, ...extra]);
    setTotal(view.total + extra.length);
    setBusy(view.busy);
    setStream(view.stream);
    setPhase(view.phase);
    setTaskFocus(view.focus || {});
  }
  async function showTarget(next, persist = true) {
    if (!next) return;
    const { focus: nextFocus = {}, ...scope } = next;
    const previous = selected.current;
    setCurrentFocus(nextFocus);
    if (scopeId(previous) === scopeId(scope)) return;
    if (
      !previous ||
      previous.root !== scope.root ||
      previous.mode !== scope.mode ||
      previous.work !== scope.work
    )
      prefs(
        scope,
        nextFocus,
        !previous &&
          (scope.mode === "fanqie"
            ? readPref(PREF.work) === (scope.work || "")
            : readPref(PREF.ttRoot) === scope.root),
      );
    selected.current = scope;
    setMessages([]);
    setTotal(0);
    setStream("");
    setPhase("");
    setBusy(false);
    historyLimit.current = 80;
    const chosen = persist ? await api.select(scope) : scope;
    if (scopeId(selected.current) !== scopeId(scope)) return;
    selected.current = chosen;
    setState((s) => ({ ...s, target: chosen }));
    await loadView(chosen);
  }
  useEffect(() => {
    api
      .state()
      .then(async (value) => {
        setState(value);
        setForm(value.model);
        if (value.notice) setError(value.notice);
        if (value.target) await showTarget(value.target, false);
        setRunning(await api.running());
      })
      .catch((e) => setError(e.message));
  }, []);
  useEffect(() => {
    const select = (event) => {
      showTarget(event.detail).catch((e) => setError(e.message));
    };
    window.addEventListener("writer:target", select);
    const unsubscribe = api.subscribe((value) => {
      if (value.running) setRunning(value.running);
      if (value.selection) {
        showTarget(value.selection, false).catch((e) => setError(e.message));
        return;
      }
      if (value.target && scopeId(value.target) !== scopeId(selected.current))
        return;
      if (value.error) {
        setError(value.error);
        return;
      }
      if (value.refresh) refresh();
      const event = value.event;
      if (!event) return;
      if (value.editor) {
        setPhase(value.phase || "编辑任务已结束");
        return;
      }
      if (event.type === "agent_start") {
        setBusy(true);
        setStream("");
      }
      if (
        event.type === "compaction_start" ||
        event.type === "auto_retry_start"
      )
        setBusy(true);
      if (value.phase) setPhase(value.phase);
      if (event.type === "message_end" && event.message.role === "user")
        setTaskFocus(value.focus || {});
      if (
        event.type === "message_update" &&
        event.assistantMessageEvent?.type === "text_delta"
      )
        setStream((s) => s + event.assistantMessageEvent.delta);
      if (event.type === "message_end") {
        if (loadingMessages.current)
          loadingMessages.current.push(event.message);
        else {
          setMessages((current) =>
            [...current, event.message].slice(-historyLimit.current),
          );
          setTotal((n) => n + 1);
        }
        if (event.message.role === "assistant") setStream("");
        if (event.message.errorMessage) setError(event.message.errorMessage);
      }
      if (event.type === "agent_settled") {
        setBusy(false);
        setStream("");
        setPhase(
          event.aborted
            ? "已停止；已保存的结果保留"
            : "任务已结束，结果见稿件与回报",
        );
        refresh();
      }
    });
    return () => {
      unsubscribe();
      window.removeEventListener("writer:target", select);
    };
  }, []);
  function canLeave() {
    return (
      !focused.current.dirty ||
      window.confirm("当前段落有未保存修改，离开将放弃这些修改。是否继续？")
    );
  }
  async function choose(mode) {
    if (!canLeave()) return;
    try {
      const next = await api.choose(mode);
      if (!next) return;
      prefs(next);
      await showTarget(next, false);
      setWorkspace((n) => n + 1);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function jump(target, nextFocus = {}) {
    if (!canLeave()) return;
    try {
      prefs(target, nextFocus);
      await showTarget({ ...target, focus: nextFocus });
      setWorkspace((n) => n + 1);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function older() {
    try {
      historyLimit.current += 80;
      await loadView(selected.current, historyLimit.current);
    } catch (e) {
      setError(e.message);
    }
  }
  async function restore() {
    try {
      await loadView(selected.current, historyLimit.current);
      refresh();
    } catch (e) {
      setError(e.message);
    }
  }
  async function send(event) {
    event.preventDefault();
    const input = text,
      target = selected.current,
      snapshot = { ...focused.current };
    if (!input.trim() || !target) return;
    try {
      await api.send(input, target, snapshot);
      setText((current) => (current === input ? "" : current));
      setError("");
    } catch (e) {
      setError(e.message);
    }
  }
  async function stop(target) {
    try {
      await api.stop(target);
    } catch (e) {
      setError(e.message);
    }
  }
  function message(message, index) {
    const text = messageText(message);
    if (!text) return null;
    if (message.role === "toolResult") {
      const result = message.details?.writerResult;
      return (
        <details key={index} className="desktop-tool">
          <summary>
            {result
              ? result.summary
              : text.startsWith("{")
                ? toolLabel(message.toolName || "") + " · 查看结果"
                : text.split("\n")[0].slice(0, 160)}
          </summary>
          {result && (
            <button onClick={() => jump(result.target, result.focus)}>
              {result.target.mode === "fanqie"
                ? "查看本章结果"
                : "查看文章结果"}
            </button>
          )}
          <pre>{text}</pre>
        </details>
      );
    }
    if (message.role === "custom" && message.display === false) return null;
    return (
      <article key={index} data-role={message.role}>
        <small>
          {message.customType === "writer-author"
            ? "作者操作"
            : message.role === "user"
              ? "作者"
              : "Agent"}
        </small>
        <pre>{text}</pre>
      </article>
    );
  }
  if (!state) return <p>正在打开写作 Agent…</p>;
  const background = running.filter(
    (item) => scopeId(item.target) !== scopeId(state.target),
  );
  return (
    <>
      <header className="desktop-toolbar">
        <strong>写作 Agent {VERSION}</strong>
        <button onClick={() => choose("fanqie")}>打开长篇目录</button>
        <button onClick={() => choose("toutiao")}>打开头条目录</button>
        <span title={state.target?.root}>
          {state.target?.root || "请选择数据目录"}
        </span>
        <button
          onClick={() => {
            setForm(state.model);
            setSettings(true);
          }}
        >
          模型设置
        </button>
        <button
          onClick={() => api.profiles().catch((e) => setError(e.message))}
        >
          方法目录
        </button>
        <button onClick={() => setChat(!chat)}>对话</button>
      </header>
      {background.length > 0 && (
        <div className="desktop-running">
          {background.map((item) => (
            <span key={scopeId(item.target)}>
              {focusLabel(item.target, item.focus)}：{item.phase}
              <button onClick={() => jump(item.target, item.focus)}>
                返回
              </button>
              <button onClick={() => stop(item.target)}>停止</button>
            </span>
          ))}
        </div>
      )}
      {error && (
        <div className="desktop-error" role="alert">
          {error}
          <button onClick={() => setError("")}>关闭</button>
        </div>
      )}
      <div className={"desktop-workspace" + (chat ? " with-chat" : "")}>
        <main className="desktop-canvas">
          {state.target ? (
            <Shell
              key={scopeId(state.target) + workspace}
              modeOverride={state.target.mode}
              onModeChange={choose}
            />
          ) : (
            <div className="desktop-empty">
              <h1>打开你的创作目录</h1>
              <p>
                长篇选择包含 works
                的数据根；头条选择文章目录。也可选择空目录，再让 Agent
                创建作品。
              </p>
            </div>
          )}
        </main>
        {chat && (
          <aside className="desktop-chat">
            <header>
              <strong>写作对话</strong>
              <button onClick={restore} disabled={!state.target}>
                刷新对话
              </button>
              <button onClick={() => setChat(false)}>收起</button>
            </header>
            <div className="desktop-task">
              当前阅读：
              {state.target ? focusLabel(state.target, focus) : "尚未选择作品"}
              {busy && (
                <small>运行任务：{focusLabel(state.target, taskFocus)}</small>
              )}
              {focus.revision !== undefined && (
                <small>已加载版本：{focus.revision}</small>
              )}
              {focus.dirty && (
                <small>当前段落尚未保存；Agent 使用已保存稿件。</small>
              )}
            </div>
            <div className="desktop-messages">
              {messages.length < total && (
                <button onClick={older}>
                  查看更早消息（已显示 {messages.length} / {total}）
                </button>
              )}
              {messages.map(message)}
              {stream && (
                <article>
                  <small>Agent</small>
                  <pre>{stream}</pre>
                </article>
              )}
            </div>
            {phase && (
              <p className="desktop-phase" role="status">
                {phase}
              </p>
            )}
            <form onSubmit={send}>
              <textarea
                value={text}
                onChange={(e) => setText(e.target.value)}
                placeholder="说明题材、续写目标或修改要求…"
              />
              <button disabled={!state.target}>
                发送{busy ? "（排队）" : ""}
              </button>
              <button
                type="button"
                onClick={() => stop(state.target)}
                disabled={!busy}
              >
                停止
              </button>
            </form>
          </aside>
        )}
      </div>
      {settings && (
        <div className="desktop-backdrop">
          <form
            onSubmit={async (event) => {
              event.preventDefault();
              try {
                await api.model(form);
                const next = await api.state();
                setState(next);
                setSettings(false);
                setWorkspace((n) => n + 1);
                if (next.target) await loadView(next.target);
              } catch (e) {
                setError(e.message);
              }
            }}
          >
            <h2>模型连接</h2>
            <p>保存连接会停止正在运行的写作任务，历史稿件与对话保留。</p>
            {[
              ["baseUrl", "接口地址"],
              ["model", "模型 ID"],
              ["apiKey", "API Key（留空保留）"],
              ["contextWindow", "上下文窗口"],
              ["maxTokens", "最大输出"],
            ].map(([key, label]) => (
              <label key={key}>
                {label}
                <input
                  type={key === "apiKey" ? "password" : "text"}
                  value={form[key] || ""}
                  onChange={(e) =>
                    setForm((f) => ({ ...f, [key]: e.target.value }))
                  }
                />
              </label>
            ))}
            <button type="button" onClick={() => setSettings(false)}>
              取消
            </button>
            <button>保存</button>
          </form>
        </div>
      )}
    </>
  );
}
createRoot(document.getElementById("root")).render(<App />);
