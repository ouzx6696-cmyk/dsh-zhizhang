import React, { useEffect, useState, useMemo } from "react";
import type { ReactNode } from "react";
import { useFanqie } from "../../../../../../packages/workbench/src/client/fanqie/useFanqie.js";
import { useToutiao } from "../../../../../../packages/workbench/src/client/toutiao/useToutiao.js";
import { ChapterList } from "../../../../../../packages/workbench/src/client/fanqie/ChapterList.jsx";
import { Reader } from "../../../../../../packages/workbench/src/client/fanqie/Reader.jsx";
import { Inspector } from "../../../../../../packages/workbench/src/client/fanqie/Inspector.jsx";
import { Pipeline } from "../../../../../../packages/workbench/src/client/fanqie/Pipeline.jsx";
import { Dialogs } from "../../../../../../packages/workbench/src/client/fanqie/Dialogs.jsx";
import {
  ArticleList,
  Body,
  ToutiaoSide,
} from "../../../../../../packages/workbench/src/client/toutiao/ToutiaoApp.jsx";
import { Notices } from "../../../../../../packages/workbench/src/client/shared/common.jsx";
import { profilesApi } from "../../../../../../packages/workbench/src/client/shared/api.js";
import { ProfilesDialog } from "../../../../../../packages/workbench/src/client/shared/Profiles.jsx";
import { Menu, PanelRightClose, Check, FileCheck, Layers } from "lucide-react";
import type { WorkspaceProps } from "../../../renderer-contracts";
type EditState = { dirty: boolean; saving: boolean };
const tabs = [
  ["agent", "Agent"],
  ["chapter", "本章"],
  ["methods", "方法方案"],
];
function MethodsPane({
  mode,
  onEditState,
}: {
  mode: "fanqie" | "toutiao";
  onEditState: (state: EditState) => void;
}) {
  const api = useMemo(() => profilesApi(mode), [mode]);
  return (
    <div className="method-panel">
      <ProfilesDialog
        mode={mode}
        api={api}
        inline
        onEditState={onEditState}
        onClose={() => {}}
        onChanged={() => {}}
      />
    </div>
  );
}
function Layout({
  navigation,
  center,
  inspector,
  agent,
  tab,
  setTab,
  mode,
  drawer,
  setDrawer,
  onMethodEditState,
}: {
  navigation: ReactNode;
  center: ReactNode;
  inspector: ReactNode;
  agent: ReactNode;
  tab: string;
  setTab: (tab: string) => void;
  mode: "fanqie" | "toutiao";
  drawer: boolean;
  setDrawer: (open: boolean) => void;
  onMethodEditState: (state: EditState) => void;
}) {
  const [navOpen, setNavOpen] = useState(false);
  return (
    <div className="studio-layout">
      <nav className={"studio-nav " + (navOpen ? "expanded" : "")}>
        <button
          className="nav-toggle icon-button"
          aria-label="展开章节导航"
          onClick={() => setNavOpen(!navOpen)}
        >
          <Menu size={18} />
        </button>
        {navigation}
      </nav>
      <section className="studio-paper-column">{center}</section>
      <aside className={"studio-sidebar " + (drawer ? "open" : "")}>
        <div className="studio-tabs" role="tablist">
          {tabs.map(([id, label]) => (
            <button
              role="tab"
              aria-selected={tab === id}
              key={id}
              onClick={() => setTab(id)}
            >
              {label}
            </button>
          ))}
          <button
            className="drawer-close icon-button"
            aria-label="收起右栏"
            onClick={() => setDrawer(false)}
          >
            <PanelRightClose size={16} />
          </button>
        </div>
        <div className="studio-side-body" data-tab={tab}>
          <div hidden={tab !== "agent"} className="agent-slot">
            {agent}
          </div>
          {tab === "chapter" && (
            <div className="decision-panel">{inspector}</div>
          )}
          <div hidden={tab !== "methods"} style={{ height: "100%" }}>
            <MethodsPane mode={mode} onEditState={onMethodEditState} />
          </div>
        </div>
      </aside>
    </div>
  );
}
function Novel(props: WorkspaceProps) {
  const { state, view, actions } = useFanqie({ onTarget: props.onTarget }),
    { dispatch } = actions;
  useEffect(() => {
    dispatch({
      type: "view",
      view: props.view === "writing" ? "chapters" : "overview",
    });
    if (props.view === "library") dispatch({ type: "tab", tab: "library" });
  }, [props.view]);
  useEffect(() => {
    const chapter = view.current,
      ready = state.chapter.status === "ready";
    props.onContext({
      target: props.target,
      focus: {
        workTitle: view.snap?.title,
        chapter: chapter?.id,
        title: chapter?.title,
      },
      chapter,
      hasCandidate: !!view.activeCand,
      candidate: view.activeCand,
      review: state.chapter.writer?.editorReview,
      dirty: !!state.edit?.dirty,
      ready,
      kind: "novel",
      outlineReady: [
        "pov",
        "targetWords",
        "locks",
        "knowledge",
        "synopsis",
        "conflict",
        "beats",
        "ending",
      ].every((key) => {
        const value = state.chapter.outline?.[key];
        return typeof value === "number"
          ? value > 0
          : typeof value === "string" && !!value.trim();
      }),
      actions: { saveParagraph: actions.diagnostics.save },
    });
  }, [
    view.current,
    view.activeCand,
    state.chapter,
    state.edit,
    view.snap?.title,
  ]);
  const current = view.current,
    meta = state.chapter.meta,
    review = meta?.review;
  const reviewed =
    review?.revision === meta?.revision && review?.result === "pass";
  const canRead = state.chapter.status === "ready" && !state.chapter.truncated;
  const finalizeBlocked =
    !canRead ||
    !reviewed ||
    !!state.chapter.writer?.finalizeBlocked ||
    meta?.status === "final" ||
    props.readOnly;
  const decisions = (
    <div className="paper-decisions">
      <span className="status-badge">
        {meta?.status || current?.status || "待规划"}
      </span>
      <span className="paper-progress">规划 · 写作 · 审读 · 定稿</span>
      {current && (
        <>
          <button
            disabled={!canRead || props.readOnly}
            onClick={() =>
              dispatch({ type: "openDialog", dialog: { kind: "review" } })
            }
          >
            <FileCheck size={14} />
            声明已审读
          </button>
          <button
            className="primary"
            disabled={finalizeBlocked}
            title={
              state.chapter.writer?.finalizeBlocked ||
              (!reviewed ? "请先完整审读当前版本" : "")
            }
            onClick={() =>
              dispatch({ type: "openDialog", dialog: { kind: "finalize" } })
            }
          >
            <Check size={14} />
            定稿
          </button>
        </>
      )}
    </div>
  );
  const assigned = new Set(),
    groups = (view.snap?.volumes || []).map((volume: any) => ({
      ...volume,
      rows: view.chapters.filter((chapter: any) => {
        if (!volume.chapters.includes(chapter.id) || assigned.has(chapter.id))
          return false;
        assigned.add(chapter.id);
        return true;
      }),
    }));
  const ungrouped = view.chapters.filter(
    (chapter: any) => !assigned.has(chapter.id),
  );
  if (ungrouped.length)
    groups.push({
      id: "ungrouped",
      title: groups.length ? "未分卷" : "",
      rows: ungrouped,
    });
  const navigation = (
    <>
      <h2>章节</h2>
      {groups.map((group: any) => (
        <section className="nav-volume" key={group.id}>
          {group.title && <h3>{group.title}</h3>}
          <ChapterList
            chapters={group.rows}
            byChapter={view.byChapter}
            impacts={view.impacts}
            chapterId={state.chapterId}
            candidateId={state.candidateId}
            readerView={state.readerView}
            onSelectChapter={(id: string) => dispatch({ type: "selectChapter", id })}
            onSelectCandidate={(chapterId: string, id: string) =>
              dispatch({ type: "selectCandidate", chapterId, id })
            }
          />
        </section>
      ))}
      <div className="nav-results">
        <h3>候选与回报</h3>
        {view.pending.map((candidate: any) => (
          <button
            key={candidate.id}
            onClick={() =>
              dispatch({
                type: "selectCandidate",
                chapterId: candidate.chapterId,
                id: candidate.id,
              })
            }
          >
            <Layers size={14} />
            {candidate.id}
          </button>
        ))}
      </div>
    </>
  );

  const center =
    props.view !== "writing" ? (
      <Pipeline state={state} view={view} actions={actions} />
    ) : (
      <>
        {decisions}
        {!view.snap ? (
          <div className="studio-empty">
            <h1>从一个故事开始</h1>
            <p>
              {state.error ||
                "使用“新书”命令，告诉 Agent 书名、题材或一句话想法。已有作品可从顶栏切换。"}
            </p>
          </div>
        ) : (
          <Reader state={state} view={view} actions={actions} />
        )}
      </>
    );
  return (
    <>
      <Layout
        tab={props.tab}
        setTab={props.setTab}
        drawer={props.drawer}
        setDrawer={props.setDrawer}
        onMethodEditState={props.onMethodEditState}
        mode="fanqie"
        navigation={navigation}
        center={center}
        inspector={
          <Inspector state={state} view={view} actions={actions} hideAgent />
        }
        agent={props.agent}
      />
      <Dialogs state={state} view={view} actions={actions} />
      <Notices
        notices={state.notices}
        onDismiss={(id: string) => dispatch({ type: "dismissNotice", id })}
      />
    </>
  );
}
function Articles(props: WorkspaceProps) {
  const tt = useToutiao({ onTarget: props.onTarget }),
    a: any = tt.detail.article;
  useEffect(() => {
    props.onContext({
      target: props.target,
      article: a || undefined,
      kind: "article",
    });
  }, [a, tt.selected]);
  const adopt = async () => {
    if (!a) return;
    if (
      window.confirm(
        `确认采用《${a.title}》第 ${a.rev} 版？发布时请按平台要求声明 AI 生成，故事或合成人物须注明虚构演绎。`,
      )
    )
      await tt.actions.adopt(a);
  };
  return (
    <>
      <Layout
        tab={props.tab}
        setTab={props.setTab}
        drawer={props.drawer}
        setDrawer={props.setDrawer}
        onMethodEditState={props.onMethodEditState}
        agent={props.agent}
        mode="toutiao"
        navigation={
          <>
            <h2>文章</h2>
            <ArticleList
              articles={tt.list.articles}
              statuses={tt.list.statuses || []}
              sel={tt.sel}
              onSelect={tt.actions.select}
            />
          </>
        }
        center={
          <>
            <div className="paper-decisions">
              <span className="status-badge">{a?.status || "尚未立项"}</span>
              <span className="paper-progress">选题 · 成稿 · 质检 · 交稿</span>
              {a && (
                <button
                  className="primary"
                  disabled={
                    !a.adoptable ||
                    !tt.adoptReady ||
                    !!tt.busy ||
                    props.readOnly
                  }
                  onClick={adopt}
                >
                  <Check size={14} />
                  采用
                </button>
              )}
            </div>
            <Body detail={tt.detail} />
          </>
        }
        inspector={<ToutiaoSide tt={tt} hideAgent />}
      />
      <Notices notices={tt.notices} onDismiss={tt.actions.dismiss} />
    </>
  );
}
export function Workspace(props: WorkspaceProps) {
  return props.target.mode === "fanqie" ? (
    <Novel {...props} />
  ) : (
    <Articles {...props} />
  );
}
