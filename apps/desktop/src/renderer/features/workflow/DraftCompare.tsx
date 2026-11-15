import React, { useEffect, useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Skeleton } from "@zhizhang/ui/primitives";
import { Manuscript } from "@zhizhang/workbench/client";
import { desktop } from "../../state/desktop";
import { errorCode, errorText } from "../../format";

export interface CompareSides {
  official: { title: string; body: string; revision: string };
  candidate: { title: string; body: string; wordCount: number };
}

/** 读正式稿与候选稿；正式稿尚不存在（新章）时左侧为空。 */
export async function loadCompare(work: string, chapter: string, candidateId: string): Promise<CompareSides> {
  const [official, candidate] = await Promise.all([
    desktop.workbench("fanqie.chapter.get", { work, chapter }).catch((error: unknown) => {
      if (errorCode(error) === "input.not_found" || errorCode(error) === "storage.io") return null;
      throw error;
    }),
    desktop.workbench("fanqie.candidate.get", { work, chapter, candidateId }),
  ]);
  return {
    official: official ? { title: official.title, body: official.body, revision: official.revision } : { title: "", body: "", revision: "" },
    candidate: { title: candidate.title, body: candidate.body, wordCount: candidate.wordCount },
  };
}

/** 正式稿与候选稿左右对照（只读）；采纳/放弃由流水线面板执行。 */
export function DraftCompare({
  work,
  chapter,
  candidateId,
  onLoaded,
}: {
  work: string;
  chapter: string;
  candidateId: string;
  onLoaded: (sides: CompareSides | null) => void;
}) {
  const [sides, setSides] = useState<CompareSides | null>(null);
  const [error, setError] = useState("");
  useEffect(() => {
    let alive = true;
    setSides(null);
    setError("");
    loadCompare(work, chapter, candidateId)
      .then((value) => {
        if (!alive) return;
        setSides(value);
        onLoaded(value);
      })
      .catch((err: unknown) => {
        if (!alive) return;
        setError(errorText(err));
        onLoaded(null);
      });
    return () => {
      alive = false;
    };
  }, [work, chapter, candidateId, onLoaded]);

  if (error) return <p role="alert" className="zz-muted" data-testid="workflow-compare-error">{error}</p>;
  if (!sides) return <Skeleton lines={5} />;
  return (
    <div className="zz-compare" data-testid="workflow-compare">
      <section data-testid="compare-official" aria-label={C.workflow.official}>
        <h4>{C.workflow.official}</h4>
        <div className="zz-paper">
          <Manuscript text={sides.official.body} emptyText={C.workflow.noOfficial} />
        </div>
      </section>
      <section data-testid="compare-candidate" aria-label={C.workflow.candidate}>
        <h4>
          {C.workflow.candidate}
          {sides.candidate.title ? ` · ${sides.candidate.title}` : ""}
          <small className="zz-muted"> {C.workflow.words(sides.candidate.wordCount)}</small>
        </h4>
        <div className="zz-paper">
          <Manuscript text={sides.candidate.body} />
        </div>
      </section>
    </div>
  );
}
