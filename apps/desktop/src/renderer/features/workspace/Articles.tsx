import { COPY as viewCopy, formatDateTime, t as viewText } from "../../../../../../packages/ui/src/copy.js";
import { ARTICLE_STEPS, articleProgress } from "../../../../../../packages/ui/src/status";
import { Steps } from "../../../../../../packages/ui/src/primitives";
import React, { useEffect, useState } from "react";
import { useToutiao } from "../../../../../../packages/workbench/src/client/toutiao/useToutiao.js";
import {
  ArticleList,
  Body,
  ToutiaoSide,
} from "../../../../../../packages/workbench/src/client/toutiao/ToutiaoApp.jsx";
import { Notices } from "../../../../../../packages/workbench/src/client/shared/common.jsx";
import { t } from "../../../../../../packages/ui/src/copy.js";
import { Check } from "lucide-react";
import { StatusBadge } from "../../../../../../packages/ui/src/status-badge";
import type { WorkspaceProps } from "../../../renderer-contracts";
import { askConfirm } from "../../state/confirm";
import { WorkspaceLayout } from "./WorkspaceLayout";

function Ledger({
  articles,
  onOpen,
  onWrite,
}: {
  articles: any[];
  onOpen: (root: string, id: string) => void;
  onWrite: () => void;
}) {
  const [query, setQuery] = useState("");
  const [status, setStatus] = useState("");
  const visible = articles.filter(
    (a) => (!status || a.status === status) && (!query || String(a.title).includes(query)),
  );
  if (!articles.length)
    return (
      <div className="paper-ledger">
        <div className="studio-empty">
          <h1>{t("ttLedgerTitle")}</h1>
          <p>{t("ttLedgerEmpty")}</p>
          <button className="primary" onClick={onWrite}>
            {viewCopy.articlesText1}
          </button>
        </div>
      </div>
    );
  return (
    <div className="paper-ledger">
      <h1>{t("ttLedgerTitle")}</h1>
      <div className="lamp-ledger-tools">
        <input
          type="search"
          aria-label={viewCopy.articlesText2}
          placeholder={viewCopy.articlesText3}
          value={query}
          onChange={(e) => setQuery(e.target.value)}
        />
        <select
          aria-label={viewCopy.articlesText4}
          value={status}
          onChange={(e) => setStatus(e.target.value)}
        >
          <option value="">{viewCopy.articlesText5}</option>
          {[...new Set(articles.map((a) => a.status))].map((status) => (
            <option key={status}>{status}</option>
          ))}
        </select>
      </div>
      <table>
        <thead>
          <tr>
            <th>{viewCopy.ttHeadlines}</th>
            <th>{viewCopy.ttStatus}</th>
            <th>{t("ttLedgerRev")}</th>
            <th>{t("ttLedgerQa")}</th>
            <th>{t("ttLedgerUpdated")}</th>
            <th />
          </tr>
        </thead>
        <tbody>
          {visible.map((row) => (
            <tr key={row.root + "|" + row.id}>
              <td>
                <strong>{row.title}</strong>
                <small>
                  {row.line} · {row.genre}
                </small>
              </td>
              <td>
                <StatusBadge mode="toutiao" status={row.status} />
              </td>
              <td>{row.rev || "—"}</td>
              <td>{row.qa?.score ?? "—"}</td>
              <td>{formatDateTime(row.updatedAt) || "—"}</td>
              <td>
                <button onClick={() => onOpen(row.root, row.id)}>{t("ttLedgerOpen")}</button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

export function Articles(props: WorkspaceProps) {
  const {onContext} = props;
  const tt = useToutiao({ onTarget: props.onTarget, onSourceEditState: props.onSourceEditState }),
    a: any = tt.detail.article;
  useEffect(() => {
    onContext({
      article: a || undefined,
      kind: "article",
      actions: { refresh: tt.actions.refresh },
    });
  }, [a, tt.selected, tt.actions.refresh, tt.sourceGuard.dirty, onContext]);
  const adopt = async () => {
    if (!a) return;
    if (await askConfirm(viewText("articlesText6", { value0: a.title, value1: a.rev })))
      await tt.actions.adopt(a);
  };
  const openAgent = () => {
    props.setTab("agent");
    props.setDrawer(true);
  };
  const revise = async () => {
    if (await tt.actions.deliver("revise")) openAgent();
  };
  const startNew = async () => {
    if (await tt.actions.deliver("new")) openAgent();
  };
  const stage = articleProgress(a);
  return (
    <>
      {tt.list.error && <p role="alert">{tt.list.error}</p>}
      <WorkspaceLayout
        fullWidth={props.view === "overview"}
        tab={props.tab}
        setTab={props.setTab}
        drawer={props.drawer}
        setDrawer={props.setDrawer}
        onMethodEditState={props.onMethodEditState}
        agent={props.agent}
        mode="toutiao"
        navigation={
          <>
            <h2>{viewCopy.ttArticles}</h2>
            <ArticleList articles={tt.list.articles} sel={tt.sel} onSelect={tt.actions.select} />
          </>
        }
        center={
          props.view === "overview" ? (
            <Ledger
              articles={tt.list.articles}
              onOpen={(root, id) => {
                tt.actions.select(root, id);
                props.onView?.("writing");
              }}
              onWrite={() => props.onView?.("writing")}
            />
          ) : (
            <>
              {a ? (
                <div className="paper-decisions">
                  <StatusBadge mode="toutiao" status={a.status} />
                  <Steps steps={ARTICLE_STEPS} current={stage} label={viewCopy.articlesText7} />
                  {a.qa?.length ? (
                    <span
                      className="paper-qa"
                      data-pass={a.qa[a.qa.length - 1].pass ? "true" : "false"}
                    >
                      {viewCopy.articlesText8}
                      {a.qa[a.qa.length - 1].score}
                      {viewCopy.toutiaoAppText2}
                    </span>
                  ) : null}
                  <button
                    disabled={!!tt.busy || !!tt.deliverOff || props.readOnly}
                    title={tt.deliverOff || undefined}
                    onClick={revise}
                  >
                    {viewCopy.articlesText9}
                  </button>
                  <button
                    className="primary"
                    disabled={!a.adoptable || !tt.adoptReady || !!tt.busy || props.readOnly}
                    onClick={adopt}
                  >
                    <Check size={14} />
                    {viewCopy.articlesText10}
                  </button>
                </div>
              ) : (
                <div className="paper-start">
                  <p>{viewCopy.articlesText11}</p>
                  <button
                    className="primary"
                    disabled={!!tt.busy || !!tt.deliverOff || props.readOnly}
                    title={tt.deliverOff || undefined}
                    onClick={startNew}
                  >
                    {viewCopy.articlesText12}
                  </button>
                </div>
              )}
              <Body
                detail={tt.detail}
                onSave={tt.actions.saveDraft}
                onEditState={tt.sourceGuard.report}
                readOnly={props.readOnly}
              />
            </>
          )
        }
        inspector={<ToutiaoSide tt={tt} hideAgent />}
      />
      <Notices notices={tt.notices} onDismiss={tt.actions.dismiss} />
    </>
  );
}
