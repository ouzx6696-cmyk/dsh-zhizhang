import React, { useEffect, useState } from "react";
import { X } from "lucide-react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, IconButton, Notice, Skeleton } from "@zhizhang/ui/primitives";
import { Manuscript } from "@zhizhang/workbench/client";
import { desktop } from "../../state/desktop";
import { desktopStore, type CompareRequest } from "../../state/store";
import { errorCode, errorText, notifyError } from "../../format";
import { decideRun } from "./decide";

export interface CompareSides {
  official: { title: string; body: string; revision: string; wordCount: number };
  candidate: { title: string; body: string; wordCount: number };
}

const SOLID = /\s+/g;
const countChars = (text: string) => text.replace(SOLID, "").length;

/** 读正式稿与候选稿；只有“正式稿不存在”（新章）时左侧为空，读写故障照常报错。 */
export async function loadCompare(
  work: string,
  chapter: string,
  candidateId: string,
): Promise<CompareSides> {
  const [official, candidate] = await Promise.all([
    desktop.workbench("fanqie.chapter.get", { work, chapter }).catch((error: unknown) => {
      if (errorCode(error) === "input.not_found") return null;
      throw error;
    }),
    desktop.workbench("fanqie.candidate.get", { work, chapter, candidateId }),
  ]);
  return {
    official: official
      ? {
          title: official.title,
          body: official.body,
          revision: official.revision,
          wordCount: countChars(official.body),
        }
      : { title: "", body: "", revision: "", wordCount: 0 },
    candidate: { title: candidate.title, body: candidate.body, wordCount: candidate.wordCount },
  };
}

/**
 * 中栏对照视图：左正式稿、右候选稿，各自独立滚动；顶部只有一个琥珀按钮“采纳候选稿”。
 * 采纳 / 放弃与流水线面板走同一条 decideRun。
 */
export function CompareView({ request, kind }: { request: CompareRequest; kind: string }) {
  const [sides, setSides] = useState<CompareSides | null>(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const close = () => desktopStore.set({ compare: null });

  useEffect(() => {
    let alive = true;
    setSides(null);
    setError("");
    loadCompare(request.target.path, request.chapter, request.runId)
      .then((value) => alive && setSides(value))
      .catch((err: unknown) => alive && setError(errorText(err)));
    return () => {
      alive = false;
    };
  }, [request]);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape" && !document.querySelector("dialog[open]")) close();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  const decide = async (decision: "apply" | "discard") => {
    setBusy(true);
    try {
      await decideRun(
        request.target,
        { id: request.runId, kind },
        request.chapter,
        decision,
        sides,
      );
      close();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy(false);
    }
  };

  const delta = sides ? sides.candidate.wordCount - sides.official.wordCount : 0;
  return (
    <section
      className="zz-compare"
      data-testid="workflow-compare-view"
      aria-label={C.workflow.compareTitle}
    >
      <header className="wb-bar zz-compare__bar">
        <div className="wb-bar-lead">
          <span className="wb-bar-ordinal">{C.workflow.compareTitle}</span>
          <span className="zz-compare__hint">{C.workflow.compareHint(request.chapter)}</span>
          {sides ? <span className="zz-compare__delta">{C.workflow.wordsDelta(delta)}</span> : null}
        </div>
        <div className="wb-bar-actions">
          <Button
            size="sm"
            variant="ghost"
            data-testid="workflow-discard"
            disabled={busy || !sides}
            onClick={() => void decide("discard")}
          >
            {C.workflow.discard}
          </Button>
          <Button
            size="sm"
            variant="primary"
            data-testid="workflow-adopt"
            loading={busy}
            disabled={!sides}
            onClick={() => void decide("apply")}
          >
            {C.workflow.adoptCandidate}
          </Button>
          <IconButton
            size="sm"
            label={C.workflow.closeCompare}
            data-testid="compare-close"
            icon={<X size={15} />}
            onClick={close}
          />
        </div>
      </header>
      {error ? (
        <div className="zz-compare__error">
          <Notice tone="bad" message={error} />
        </div>
      ) : !sides ? (
        <div className="zz-compare__cols">
          <div className="zz-compare__col">
            <Skeleton lines={10} />
          </div>
          <div className="zz-compare__col">
            <Skeleton lines={10} />
          </div>
        </div>
      ) : (
        <div className="zz-compare__cols">
          <section
            className="zz-compare__col"
            data-testid="compare-official"
            aria-label={C.workflow.official}
          >
            <h3 className="zz-compare__head">
              {C.workflow.official}
              <span>{C.workflow.words(sides.official.wordCount)}</span>
            </h3>
            <div className="zz-compare__body">
              <Manuscript
                text={sides.official.body}
                title={sides.official.title}
                emptyText={C.workflow.noOfficial}
              />
            </div>
          </section>
          <section
            className="zz-compare__col"
            data-testid="compare-candidate"
            aria-label={C.workflow.candidate}
          >
            <h3 className="zz-compare__head">
              {C.workflow.candidate}
              <span>{C.workflow.words(sides.candidate.wordCount)}</span>
            </h3>
            <div className="zz-compare__body">
              <Manuscript text={sides.candidate.body} title={sides.candidate.title} />
            </div>
          </section>
        </div>
      )}
    </section>
  );
}
