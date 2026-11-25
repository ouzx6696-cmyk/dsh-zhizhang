import React from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Empty } from "@zhizhang/ui/primitives";
import { statusLabel } from "@zhizhang/ui/status";
import type { ArticleRowView } from "@zhizhang/toutiao/view";

export function ToutiaoLedger({
  rows,
  onOpen,
}: {
  rows: readonly ArticleRowView[];
  onOpen: (id: string) => void;
}) {
  return (
    <section className="zz-board" data-testid="board" aria-label={C.topbar.viewLedger}>
      {rows.length ? (
        <div className="zz-board__sheet">
          <table className="zz-table">
            <thead>
              <tr>
                <th>{C.toutiao.title}</th>
                <th>{C.toutiao.genre}</th>
                <th className="zz-table__num">{C.toutiao.qa}</th>
                <th>{C.fanqie.status}</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr
                  key={row.id}
                  data-testid="board-row"
                  data-article-id={row.id}
                  data-status={row.status}
                >
                  <td>
                    <button type="button" className="zz-link" onClick={() => onOpen(row.id)}>
                      {row.title || row.id}
                    </button>
                  </td>
                  <td>{row.genre}</td>
                  <td className="zz-table__num">{row.qaScore ?? "—"}</td>
                  <td>{statusLabel("toutiao", row.status)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : (
        <Empty title={C.toutiao.emptyLedger} />
      )}
    </section>
  );
}
