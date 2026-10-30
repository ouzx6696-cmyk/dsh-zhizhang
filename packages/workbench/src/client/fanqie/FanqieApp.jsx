/** 番茄长篇模式：页头、章节三栏 / 全书概况、确认对话框与提示。 */
import React from "react";
import { t } from "../shared/copy.js";
import { useFanqie } from "./useFanqie.js";
import { Button, Icon } from "../shared/ui.jsx";
import { ChapterList } from "./ChapterList.jsx";
import { Callout, Empty, Notices, Skeleton, WithCode } from "../shared/common.jsx";
import { Dialogs } from "./Dialogs.jsx";
import { Header } from "./Header.jsx";
import { Inspector } from "./Inspector.jsx";
import { Pipeline } from "./Pipeline.jsx";
import { Reader } from "./Reader.jsx";

const { useCallback } = React;

function Onboarding({ empty, message }) {
  const heading = empty ? t("onboardEmpty") : t("onboardNoWork");
  return (
    <div className="wb-onboarding">
      <Empty icon="book" title={heading} hint={message && message.indexOf(heading) < 0 ? message : t("onboardLead")} />
      <ol className="wb-onboarding-steps" aria-label={t("onboardSteps")}>
        <li>
          <WithCode text={t("onboardStep1")} code="writer_enable mode=fanqie" />
        </li>
        <li>
          <WithCode text={t("onboardStep2")} code="fanqie_project_create" />
        </li>
        <li>{t("onboardStep3")}</li>
      </ol>
      <p className="wb-muted">{t("onboardLibrary")}</p>
    </div>
  );
}

function Workbench({ state, view, actions }) {
  const { dispatch } = actions;
  const onSelectChapter = useCallback((id) => dispatch({ type: "selectChapter", id }), [dispatch]);
  const onSelectCandidate = useCallback((chapterId, id) => dispatch({ type: "selectCandidate", chapterId, id }), [dispatch]);
  return (
    <div className="wb-workbench">
      <nav className="wb-column wb-column-nav" aria-label={t("chapters")}>
        <h2 className="wb-column-head">{t("chapters")}</h2>
        <div className="wb-column-body">
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
      <section className="wb-column wb-column-reader" aria-label={t("readerViews")}>
        <Reader state={state} view={view} actions={actions} />
      </section>
      <aside className="wb-column wb-column-inspector" aria-label={t("inspector")}>
        <h2 className="wb-column-head">{t("inspector")}</h2>
        <div className="wb-column-body">
          <Inspector state={state} view={view} actions={actions} />
        </div>
      </aside>
    </div>
  );
}

export function FanqieApp({ modeSwitch, version }) {
  const { state, view, actions } = useFanqie();
  const dismiss = useCallback((id) => actions.dispatch({ type: "dismissNotice", id }), [actions]);

  let content;
  if (state.phase === "boot" && !view.snap) {
    content = (
      <div className="wb-boot" role="status">
        <span className="wb-visually-hidden">{t("loading")}</span>
        <Skeleton lines={5} />
      </div>
    );
  } else if (state.phase === "error") {
    content = (
      <div className="wb-onboarding">
        <Empty icon="alert" title={t("errorTitle")} hint={t("errorHint")} />
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
      <div id={"wb-view-" + state.view + "-panel"} role="tabpanel" aria-labelledby={"wb-view-" + state.view} className="wb-view-panel">
        {state.view === "chapters" ? <Workbench state={state} view={view} actions={actions} /> : <Pipeline state={state} view={view} actions={actions} />}
      </div>
    );
  }

  return (
    <div className="wb-root" data-mode="fanqie" data-view={state.view}>
      <Header state={state} view={view} actions={actions} modeSwitch={modeSwitch} />
      {!state.hostOk && view.snap ? (
        <Callout tone="warning" role="alert">
          {t("staleData")}
          {state.error ? " " + state.error : ""}
        </Callout>
      ) : null}
      <Notices notices={state.notices} onDismiss={dismiss} />
      {content}
      <footer className="wb-footer">{t("footer", { version })}</footer>
      <Dialogs state={state} view={view} actions={actions} />
    </div>
  );
}
