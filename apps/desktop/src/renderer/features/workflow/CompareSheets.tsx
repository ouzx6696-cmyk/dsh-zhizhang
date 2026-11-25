import React from "react";
import { Check } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { buildInlineDiff, type ParagraphDiffSummary, type ParagraphDiffRow } from "./compare-diff";
import type { CompareSides } from "./DraftCompare";

function InlineOfficialParagraph({ row }: { row: ParagraphDiffRow }) {
  if (row.kind === "same") return <p className="zz-sheet-p">{row.official}</p>;
  if (row.kind === "added") return <p className="zz-sheet-p zz-sheet-p--ghost">—</p>;
  if (row.kind === "removed") {
    return (
      <p className="zz-sheet-p">
        <del className="zz-diff-del">{row.official}</del>
      </p>
    );
  }
  const segs = buildInlineDiff(row.official, row.candidate);
  return (
    <p className="zz-sheet-p">
      {segs.map((seg, i) =>
        seg.kind === "add" ? null : seg.kind === "del" ? (
          <del key={i} className="zz-diff-del">
            {seg.text}
          </del>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </p>
  );
}

function InlineCandidateParagraph({ row }: { row: ParagraphDiffRow }) {
  if (row.kind === "same") return <p className="zz-sheet-p">{row.candidate}</p>;
  if (row.kind === "removed") return <p className="zz-sheet-p zz-sheet-p--ghost">—</p>;
  if (row.kind === "added") {
    return (
      <p className="zz-sheet-p">
        <ins className="zz-diff-add">{row.candidate}</ins>
      </p>
    );
  }
  const segs = buildInlineDiff(row.official, row.candidate);
  return (
    <p className="zz-sheet-p">
      {segs.map((seg, i) =>
        seg.kind === "del" ? null : seg.kind === "add" ? (
          <ins key={i} className="zz-diff-add">
            {seg.text}
          </ins>
        ) : (
          <React.Fragment key={i}>{seg.text}</React.Fragment>
        ),
      )}
    </p>
  );
}

interface CompareSheetsProps {
  sides: CompareSides;
  diff: ParagraphDiffSummary;
  hunkNumberByRow: ReadonlyMap<number, number>;
  activeRow: number;
  choices: Readonly<Record<number, "official" | "candidate">>;
  hunkRefs: React.MutableRefObject<Record<number, HTMLElement | null>>;
  onSelectCursor: (index: number) => void;
  onChoose: (rowIndex: number, side: "official" | "candidate") => void;
}

/** 柔和纸面 C2 并排双稿纸：左纸当前稿（行内红删）+ 右纸候选稿（行内绿增与逐处采纳）。 */
export function CompareSheets({
  sides,
  diff,
  hunkNumberByRow,
  activeRow,
  choices,
  hunkRefs,
  onSelectCursor,
  onChoose,
}: CompareSheetsProps) {
  return (
    <div className="zz-compare-scroll">
      <div className="zz-compare-sheets" data-testid="compare-diff-list">
        <article
          className="zz-compare-sheet"
          data-testid="compare-official"
          aria-label={C.rail.officialSheet}
        >
          <header className="zz-compare-sheet__head">
            <span className="zz-compare-sheet__label">{C.rail.officialSheet}</span>
            <span className="zz-compare-sheet__meta">
              {C.workflow.words(sides.official.wordCount)}
            </span>
          </header>
          {sides.official.title ? (
            <h3 className="zz-compare-sheet__title">{sides.official.title}</h3>
          ) : null}
          <div className="zz-compare-sheet__prose">
            {diff.rows.length ? (
              diff.rows.map((row) => {
                const hunkNum = hunkNumberByRow.get(row.index);
                const focused = activeRow === row.index;
                return (
                  <div
                    key={row.index}
                    className="zz-hunk-block"
                    data-kind={row.kind}
                    data-active={focused ? "true" : undefined}
                    onClick={() => {
                      if (hunkNum) onSelectCursor(hunkNum - 1);
                    }}
                  >
                    {hunkNum ? (
                      <span className="zz-hunk-badge" data-active={focused ? "true" : undefined}>
                        {hunkNum}
                      </span>
                    ) : null}
                    <InlineOfficialParagraph row={row} />
                  </div>
                );
              })
            ) : (
              <p className="zz-sheet-p zz-sheet-p--ghost">{C.workflow.noOfficial}</p>
            )}
          </div>
        </article>

        <article
          className="zz-compare-sheet zz-compare-sheet--candidate"
          data-testid="compare-candidate"
          aria-label={C.rail.candidateSheet}
        >
          <header className="zz-compare-sheet__head">
            <span className="zz-compare-sheet__label">{C.rail.candidateSheet}</span>
            <span className="zz-compare-sheet__meta">
              {C.workflow.words(sides.candidate.wordCount)}
            </span>
          </header>
          {sides.candidate.title ? (
            <h3 className="zz-compare-sheet__title">{sides.candidate.title}</h3>
          ) : null}
          <div className="zz-compare-sheet__prose">
            {diff.rows.map((row) => {
              const hunkNum = hunkNumberByRow.get(row.index);
              const focused = activeRow === row.index;
              const pick = choices[row.index] ?? "candidate";
              return (
                <div
                  key={row.index}
                  ref={(node) => {
                    hunkRefs.current[row.index] = node;
                  }}
                  className="zz-hunk-block"
                  data-kind={row.kind}
                  data-active={focused ? "true" : undefined}
                  data-pick={hunkNum ? pick : undefined}
                  onClick={() => {
                    if (hunkNum) onSelectCursor(hunkNum - 1);
                  }}
                >
                  {hunkNum ? (
                    <button
                      type="button"
                      className="zz-hunk-badge"
                      data-active={focused ? "true" : undefined}
                      onClick={(e) => {
                        e.stopPropagation();
                        onSelectCursor(hunkNum - 1);
                      }}
                    >
                      {hunkNum}
                    </button>
                  ) : null}
                  <InlineCandidateParagraph row={row} />
                  {hunkNum ? (
                    <div className="zz-hunk-actions" role="group">
                      <button
                        type="button"
                        className="zz-hunk-btn"
                        aria-pressed={pick === "candidate"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChoose(row.index, "candidate");
                        }}
                      >
                        <Check size={11} aria-hidden="true" />
                        {C.rail.acceptHunk}
                      </button>
                      <button
                        type="button"
                        className="zz-hunk-btn"
                        aria-pressed={pick === "official"}
                        onClick={(e) => {
                          e.stopPropagation();
                          onChoose(row.index, "official");
                        }}
                      >
                        {C.rail.keepHunk}
                      </button>
                    </div>
                  ) : null}
                </div>
              );
            })}
          </div>
        </article>
      </div>
    </div>
  );
}
