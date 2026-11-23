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
  "fanqie.chapter" | "fanqie.review" | "fanqie.revise" | "fanqie.health" | "toutiao.article";

const FANQIE_KINDS: StartKind[] = [
  "fanqie.chapter",
  "fanqie.review",
  "fanqie.revise",
  "fanqie.health",
];

export function WorkflowStartForm({
  target,
  onStarted,
}: {
  target: Target;
  onStarted: (run: RunSummary) => void;
}) {
  const chapters = useDesktop((s) => s.chapters);
  const preset = useDesktop((s) => s.pipelineChapter);
  const focusChapter = useDesktop((s) => s.focus.chapter);
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const root = useDesktop((s) => s.workspace?.roots.toutiao ?? "");
  const [kind, setKind] = useState<StartKind>(
    target.mode === "toutiao" ? "toutiao.article" : "fanqie.chapter",
  );
  const [chapter, setChapter] = useState(preset || focusChapter || chapters[0]?.id || "");
  const [note, setNote] = useState("");
  const [article, setArticle] = useState<{ genre: string; driver: string } | null>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (preset) {
      setChapter(preset);
      desktopStore.set({ pipelineChapter: "" });
    }
  }, [preset]);

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
      case "fanqie.health":
        return { upToChapter: Math.max(1, chapters.length) };
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
      {target.mode === "fanqie" && kind !== "fanqie.health" ? (
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
      {kind !== "fanqie.health" ? (
        <TextField
          label={C.workflow.note}
          value={note}
          onChange={setNote}
          testId="workflow-note"
          multiline
          placeholder={C.workflow.notePlaceholder}
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
