import React, { useEffect, useState } from "react";
import { DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Select } from "@zhizhang/ui/primitives";
import type { RunSummary, Target } from "../../../shared/views";
import { desktop } from "../../state/desktop";
import { baseName, desktopStore, useDesktop } from "../../state/store";
import { notifyError } from "../../format";
import { TextField } from "../workspace/TextField";
import { kindLabel } from "./workflow-model";

type StartKind =
  | "fanqie.book"
  | "fanqie.chapter"
  | "fanqie.review"
  | "fanqie.revise"
  | "fanqie.ledger"
  | "fanqie.health"
  | "toutiao.article";
type ReviseMode = "revise" | "deai" | "polish";
const REVISE_MODES: ReviseMode[] = ["revise", "deai", "polish"];

const FANQIE_KINDS: StartKind[] = [
  "fanqie.book",
  "fanqie.chapter",
  "fanqie.review",
  "fanqie.revise",
  "fanqie.ledger",
  "fanqie.health",
];

function isFanqieStartKind(value: string): value is StartKind {
  return FANQIE_KINDS.some((k) => k === value);
}

export function WorkflowStartForm({
  target,
  onStarted,
}: {
  target: Target;
  onStarted: (run: RunSummary) => void;
}) {
  const chapters = useDesktop((s) => s.chapters);
  const preset = useDesktop((s) => s.pipelineChapter);
  const presetKind = useDesktop((s) => s.pipelineKind);
  const focusChapter = useDesktop((s) => s.focus.chapter ?? "");
  const workTitle = useDesktop((s) => s.selected?.label ?? "");
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const root = useDesktop((s) => s.workspace?.roots.toutiao ?? "");
  const [kind, setKind] = useState<StartKind>(
    target.mode === "toutiao" ? "toutiao.article" : "fanqie.chapter",
  );
  const [chapter, setChapter] = useState(preset || focusChapter || chapters[0]?.id || "");
  const [note, setNote] = useState("");
  const [reviseMode, setReviseMode] = useState<ReviseMode>("revise");
  const [continueFromExisting, setContinueFromExisting] = useState(false);
  const [golden, setGolden] = useState(false);
  const [previousCandidateId, setPreviousCandidateId] = useState("");
  const [prevCandidates, setPrevCandidates] = useState<
    Array<{ id: string; title: string; wordCount: number }>
  >([]);
  const [article, setArticle] = useState<{ genre: string; driver: string } | null>(null);
  const [busy, setBusy] = useState(false);

  const chapterIndex = chapters.findIndex((c) => c.id === chapter);
  const prevChapterId = chapterIndex > 0 ? (chapters[chapterIndex - 1]?.id ?? "") : "";
  const needsChapter =
    target.mode === "fanqie" && kind !== "fanqie.health" && kind !== "fanqie.book";

  useEffect(() => {
    if (preset) {
      setChapter(preset);
      desktopStore.set({ pipelineChapter: "" });
    }
  }, [preset]);

  useEffect(() => {
    if (!presetKind) return;
    if (target.mode === "fanqie" && isFanqieStartKind(presetKind)) {
      setKind(presetKind);
    } else if (target.mode === "toutiao" && presetKind === "toutiao.article") {
      setKind("toutiao.article");
    }
    desktopStore.set({ pipelineKind: "" });
  }, [presetKind, target.mode]);

  useEffect(() => {
    if (target.mode !== "fanqie") return;
    if (focusChapter && chapters.some((c) => c.id === focusChapter)) {
      setChapter(focusChapter);
      return;
    }
    setChapter((prev) => {
      if (prev && chapters.some((c) => c.id === prev)) return prev;
      return focusChapter || chapters[0]?.id || "";
    });
  }, [target.mode, focusChapter, chapters]);

  useEffect(() => {
    setPreviousCandidateId("");
    if (target.mode !== "fanqie" || kind !== "fanqie.chapter" || !prevChapterId) {
      setPrevCandidates([]);
      return;
    }
    let alive = true;
    desktop
      .workbench("fanqie.candidate.list", { work: target.path, chapter: prevChapterId })
      .then(({ candidates }) => {
        if (!alive) return;
        const active = candidates
          .filter((c) => !c.accepted && !c.rejected)
          .map((c) => ({ id: c.id, title: c.title || c.id, wordCount: c.wordCount }));
        setPrevCandidates(active);
      })
      .catch(() => {
        if (alive) setPrevCandidates([]);
      });
    return () => {
      alive = false;
    };
  }, [target, kind, prevChapterId]);

  useEffect(() => {
    if (target.mode !== "toutiao" || !root) return;
    let alive = true;
    desktop
      .workbench("toutiao.articles", { root })
      .then(({ rows }) => {
        const row = rows.find((r) => r.id === baseName(target.path));
        if (alive && row) setArticle({ genre: row.genre, driver: row.driver });
      })
      .catch(notifyError);
    return () => {
      alive = false;
    };
  }, [target, root]);

  const request = (): unknown => {
    const extra = note.trim() ? { note: note.trim() } : {};
    switch (kind) {
      case "toutiao.article":
        return {
          articleId: baseName(target.path),
          genre: article?.genre ?? "",
          driver: article?.driver ?? "",
          ...extra,
        };
      case "fanqie.book":
        return {
          title: (workTitle || baseName(target.path)).trim(),
          premise: note.trim(),
        };
      case "fanqie.health":
        return { upToChapter: Math.max(1, chapters.length) };
      case "fanqie.ledger":
        return { chapterId: chapter };
      case "fanqie.revise":
        return { chapterId: chapter, mode: reviseMode, ...extra };
      case "fanqie.chapter":
        return {
          chapterId: chapter,
          ...(continueFromExisting ? { continueFromExisting: true } : {}),
          ...(golden ? { golden: "true" } : {}),
          ...(previousCandidateId ? { previousCandidateId } : {}),
          ...extra,
        };
      default:
        return { chapterId: chapter, ...extra };
    }
  };

  const ready =
    !readonly &&
    (kind === "toutiao.article"
      ? article !== null
      : kind === "fanqie.health"
        ? chapters.length > 0
        : kind === "fanqie.book"
          ? note.trim().length > 0
          : chapter.trim() !== "");

  const start = async () => {
    setBusy(true);
    try {
      const ref = await desktop.startRun(target, { kind, request: request() });
      const detail = await desktop.getRun(ref);
      if (detail) {
        onStarted({
          id: detail.id,
          kind: detail.kind,
          target,
          state: detail.state,
          stages: detail.steps.map((s) => s.id),
          usage: detail.usage,
          created: detail.created,
          updated: detail.updated,
        });
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };

  const chapterOptions = chapters.map((c, index) => ({
    value: c.id,
    label: C.workflow.chapterRef(index + 1, c.title && c.title !== c.id ? c.title : ""),
  }));

  const showNoteField = kind !== "fanqie.health" && kind !== "fanqie.ledger";

  return (
    <form
      className="zz-stack"
      data-testid="workflow-start-form"
      onSubmit={(event) => {
        event.preventDefault();
        void start();
      }}
    >
      {target.mode === "fanqie" ? (
        <Select<StartKind>
          label={C.workflow.kindLabel}
          testId="workflow-kind"
          value={kind}
          options={FANQIE_KINDS.map((k) => ({ value: k, label: kindLabel(k) }))}
          onChange={setKind}
        />
      ) : null}
      {needsChapter ? (
        chapterOptions.length ? (
          <Select
            label={C.workflow.chapter}
            testId="workflow-chapter"
            value={chapter}
            placeholder={C.workflow.pickChapter}
            options={chapterOptions}
            onChange={setChapter}
          />
        ) : (
          <TextField
            label={C.workflow.chapter}
            value={chapter}
            onChange={setChapter}
            testId="workflow-chapter"
            hint={C.fanqie.chapterIdHint}
          />
        )
      ) : null}
      {target.mode === "fanqie" && kind === "fanqie.revise" ? (
        <Select<ReviseMode>
          label={C.workflow.reviseModeLabel}
          testId="workflow-revise-mode"
          value={reviseMode}
          options={REVISE_MODES.map((m) => ({ value: m, label: C.workflow.reviseModes[m] }))}
          onChange={setReviseMode}
        />
      ) : null}
      {target.mode === "fanqie" && kind === "fanqie.chapter" ? (
        <>
          <div className="zz-workflow__opts">
            <label className="zz-workflow__opt">
              <input
                type="checkbox"
                data-testid="workflow-continue-existing"
                checked={continueFromExisting}
                onChange={(event) => setContinueFromExisting(event.target.checked)}
              />
              <span>{C.workflow.continueFromExisting}</span>
            </label>
            <label className="zz-workflow__opt">
              <input
                type="checkbox"
                data-testid="workflow-golden"
                checked={golden}
                onChange={(event) => setGolden(event.target.checked)}
              />
              <span>{C.workflow.goldenChapter}</span>
            </label>
          </div>
          {prevCandidates.length > 0 ? (
            <Select
              label={C.workflow.previousCandidateLabel}
              testId="workflow-previous-candidate"
              value={previousCandidateId}
              options={[
                { value: "", label: C.workflow.previousCandidateFormal },
                ...prevCandidates.map((c) => ({
                  value: c.id,
                  label: C.workflow.previousCandidateOption(prevChapterId, c.title, c.wordCount),
                })),
              ]}
              onChange={setPreviousCandidateId}
            />
          ) : null}
        </>
      ) : null}
      {showNoteField ? (
        <TextField
          label={kind === "fanqie.book" ? C.create.premise : C.workflow.note}
          value={note}
          onChange={setNote}
          testId="workflow-note"
          multiline
          placeholder={
            kind === "fanqie.book" ? C.workflow.bookPremisePlaceholder : C.workflow.notePlaceholder
          }
        />
      ) : null}
      <Button
        type="submit"
        variant="strong"
        data-testid="workflow-start"
        loading={busy}
        disabled={!ready}
      >
        {C.workflow.start}
      </Button>
    </form>
  );
}
