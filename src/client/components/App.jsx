/** Panel root: composes header, workbench / overview, dialogs and feedback. */
import React from "react";
import { t } from "../copy.js";
import { useWorkbench } from "../useWorkbench.js";
import { Button, Icon } from "../ui.jsx";
import { ChapterList } from "./ChapterList.jsx";
import { Callout, Empty, Notices, Skeleton, WithCode } from "./common.jsx";
import { Dialogs } from "./Dialogs.jsx";
import { Header } from "./Header.jsx";
import { Inspector } from "./Inspector.jsx";
import { Pipeline } from "./Pipeline.jsx";
import { Reader } from "./Reader.jsx";

const { useCallback } = React;

/* global __ZZ_VERSION__ */
const VERSION = typeof __ZZ_VERSION__ === "string" ? __ZZ_VERSION__ : "";

function Onboarding({ empty, message }) {
  const heading = empty ? t("onboardEmpty") : t("onboardNoWork");
  return (
    <div className="zz-onboarding">
      <Empty title={heading} hint={message && message.indexOf(heading) < 0 ? message : t("onboardLead")} />
      <ol className="zz-onboarding-steps" aria-label={t("onboardSteps")}>
        <li>
          <WithCode text={t("onboardStep1")} code="zhizhang_enable" />
        </li>
        <li>
          <WithCode text={t("onboardStep2")} code="zhizhang_project_create" />
        </li>
        <li>{t("onboardStep3")}</li>
      </ol>
      <p className="zz-muted">{t("onboardLibrary")}</p>
    </div>
  );
}

function Workbench({ state, view, actions }) {
  const { dispatch } = actions;
  const onSelectChapter = useCallback((id) => dispatch({ type: "selectChapter", id }), [dispatch]);
  const onSelectCandidate = useCallback((chapterId, id) => dispatch({ type: "selectCandidate", chapterId, id }), [dispatch]);
  return (
    <div className="zz-workbench">
      <nav className="zz-column zz-column-nav" aria-label={t("chapters")}>
        <h2 className="zz-column-head">{t("chapters")}</h2>
        <div className="zz-column-body">
          <ChapterList
            chapters={view.chapters}
            byChapter={view.byChapter}
            impacts={view.impacts}
            chapterId={state.chapterId}
            candidateId={state.candidateId}
            readerView={state.readerView}
            onSelectChapter={onSelectChapter}
            onSelectCandidate={onSelectCandidate}
          />
        </div>
      </nav>
      <section className="zz-column zz-column-reader" aria-label={t("readerViews")}>
        <Reader state={state} view={view} actions={actions} />
      </section>
      <aside className="zz-column zz-column-inspector" aria-label={t("inspector")}>
        <h2 className="zz-column-head">{t("inspector")}</h2>
        <div className="zz-column-body">
          <Inspector state={state} view={view} actions={actions} />
        </div>
      </aside>
    </div>
  );
}

export function PanelApp() {
  const { state, view, actions } = useWorkbench();
  const dismiss = useCallback((id) => actions.dispatch({ type: "dismissNotice", id }), [actions]);

  let content;
  if (state.phase === "boot" && !view.snap) {
    content = (
      <div className="zz-boot" role="status">
        <span className="zz-visually-hidden">{t("loading")}</span>
        <Skeleton lines={5} />
      </div>
    );
  } else if (state.phase === "error") {
    content = (
      <div className="zz-onboarding">
        <Empty title={t("errorTitle")} hint={t("errorHint")} />
        <Callout tone="danger" role="alert">
          {state.error}
        </Callout>
        <Button variant="outline" onClick={actions.refresh} icon={<Icon name="refresh" size={14} />}>
          {t("retry")}
        </Button>
      </div>
    );
  } else if (!view.snap) {
    content = <Onboarding empty={state.empty} message={state.message} />;
  } else {
    content = (
      <div id={"zz-mode-" + state.mode + "-panel"} role="tabpanel" aria-labelledby={"zz-mode-" + state.mode} className="zz-mode-panel">
        {state.mode === "novel" ? <Workbench state={state} view={view} actions={actions} /> : <Pipeline state={state} view={view} actions={actions} />}
      </div>
    );
  }

  return (
    <div className="zz-root" data-mode={state.mode}>
      <Header state={state} view={view} actions={actions} />
      {!state.hostOk && view.snap ? (
        <Callout tone="warning" role="alert">
          {t("staleData")}
          {state.error ? " " + state.error : ""}
        </Callout>
      ) : null}
      <Notices notices={state.notices} onDismiss={dismiss} />
      {content}
      <footer className="zz-footer">{t("footer", { version: VERSION })}</footer>
      <Dialogs state={state} view={view} actions={actions} />
    </div>
  );
}
