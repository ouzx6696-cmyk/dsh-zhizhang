import React, { useState } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Dialog, Segmented } from "@zhizhang/ui/primitives";
import type { EngineSettings } from "../../../shared/settings";
import {
  createArticle,
  createWork,
  importLegacyWork,
  previewLegacyWork,
} from "../../state/controller";
import { desktopStore, useDesktop, type CreateKind } from "../../state/store";
import { notifyError } from "../../format";
import { TextField } from "../workspace/TextField";

type Grade = EngineSettings["grade"];
type FanqieCreateMode = "new" | "import";
type LegacySourceKind = "single_txt" | "folder";
type LegacyChapterStatus = "drafted" | "final";
type LegacyPreview = NonNullable<Awaited<ReturnType<typeof previewLegacyWork>>>;

const GRADES: readonly Grade[] = ["economy", "standard", "premium"];

/** 新作品 / 导入旧书接管 / 新文章：本地建目录，不经模型。 */
export function NewTargetDialog({ kind }: { kind: CreateKind }) {
  const defaultGrade = useDesktop((s) => s.settings?.engine.grade ?? "standard");
  const [mode, setMode] = useState<FanqieCreateMode>("new");
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [sourceKind, setSourceKind] = useState<LegacySourceKind>("single_txt");
  const [sourcePath, setSourcePath] = useState("");
  const [chapterStatus, setChapterStatus] = useState<LegacyChapterStatus>("drafted");
  const [preview, setPreview] = useState<LegacyPreview | null>(null);
  const [previewing, setPreviewing] = useState(false);
  const [grade, setGrade] = useState<Grade>(defaultGrade);
  const [genre, setGenre] = useState<string>(C.create.genreDefault);
  const [driver, setDriver] = useState<string>(C.create.driverDefault);
  const [busy, setBusy] = useState(false);
  const close = () => desktopStore.set({ creating: null });
  const fanqie = kind === "fanqie";
  const valid = fanqie
    ? mode === "import"
      ? title.trim() !== "" && sourcePath.trim() !== ""
      : title.trim() !== ""
    : genre.trim() !== "" && driver.trim() !== "";
  const runPreview = async () => {
    const trimmed = sourcePath.trim();
    if (!trimmed) return;
    setPreviewing(true);
    try {
      setPreview(await previewLegacyWork({ sourcePath: trimmed, sourceKind }));
    } catch (error) {
      setPreview(null);
      notifyError(error);
    } finally {
      setPreviewing(false);
    }
  };
  const submit = async () => {
    setBusy(true);
    try {
      if (fanqie && mode === "import") {
        await importLegacyWork({
          title: title.trim(),
          sourcePath: sourcePath.trim(),
          sourceKind,
          grade,
          chapterStatus,
        });
      } else if (fanqie) {
        await createWork({ title: title.trim(), premise, grade });
      } else {
        await createArticle({ genre: genre.trim(), driver: driver.trim() });
      }
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={
        fanqie ? (mode === "import" ? C.create.modeImport : C.create.newWork) : C.create.newArticle
      }
      closeLabel={COPY.close}
      testId={fanqie ? "new-work-dialog" : "new-article-dialog"}
      onClose={close}
      footer={
        <>
          <Button onClick={close}>{COPY.cancel}</Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={!valid}
            data-testid={fanqie ? "new-work-submit" : "new-article-submit"}
            onClick={() => void submit()}
          >
            {fanqie && mode === "import" ? C.create.importSubmit : C.create.submit}
          </Button>
        </>
      }
    >
      {fanqie ? (
        <form
          className="zz-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void submit();
          }}
        >
          <Segmented<FanqieCreateMode>
            label={C.create.newWork}
            testId="new-work-mode"
            value={mode}
            options={[
              { value: "new", label: C.create.modeNew },
              { value: "import", label: C.create.modeImport },
            ]}
            onChange={setMode}
          />
          <TextField
            label={C.create.title}
            value={title}
            onChange={setTitle}
            testId="new-work-title"
            required
            autoFocus
          />
          {mode === "import" ? (
            <>
              <Segmented<LegacySourceKind>
                label={C.create.importSourceKind}
                testId="import-source-kind"
                value={sourceKind}
                options={[
                  { value: "single_txt", label: C.create.importSingleTxt },
                  { value: "folder", label: C.create.importFolder },
                ]}
                onChange={(next) => {
                  setSourceKind(next);
                  setPreview(null);
                }}
              />
              <TextField
                label={C.create.importSourcePath}
                value={sourcePath}
                onChange={(next) => {
                  setSourcePath(next);
                  setPreview(null);
                }}
                testId="import-source-path"
                required
                placeholder={C.create.importSourcePlaceholder}
                hint={C.create.importSourceHint}
              />
              <Segmented<LegacyChapterStatus>
                label={C.create.importStatusLabel}
                testId="import-chapter-status"
                value={chapterStatus}
                options={[
                  { value: "drafted", label: C.create.importStatusDrafted },
                  { value: "final", label: C.create.importStatusFinal },
                ]}
                onChange={setChapterStatus}
              />
              <div className="zz-row">
                <Button
                  size="sm"
                  data-testid="import-preview-btn"
                  loading={previewing}
                  disabled={!sourcePath.trim() || previewing}
                  onClick={() => void runPreview()}
                >
                  {C.create.importPreviewAction}
                </Button>
              </div>
              {preview ? (
                <div className="zz-stack" data-testid="import-preview-result">
                  <p className="zz-muted">
                    {C.create.importPreviewSummary(
                      preview.chapterCount,
                      preview.totalWords,
                      preview.encoding,
                    )}
                  </p>
                  {preview.hasPrelude ? (
                    <p className="zz-muted">
                      {C.create.importPreviewPrelude(preview.preludeChars)}
                    </p>
                  ) : null}
                  {preview.emptyHeadings.length > 0 ? (
                    <p className="zz-muted">
                      {C.create.importPreviewEmpty(preview.emptyHeadings.length)}
                    </p>
                  ) : null}
                  <ul className="zz-muted">
                    {preview.chapters.slice(0, 5).map((ch) => (
                      <li key={ch.chapterId}>
                        {ch.chapterId} · {ch.title}
                      </li>
                    ))}
                  </ul>
                </div>
              ) : null}
            </>
          ) : (
            <TextField
              label={C.create.premise}
              value={premise}
              onChange={setPremise}
              testId="new-work-premise"
              multiline
              placeholder={C.create.premiseHint}
            />
          )}
          <Segmented<Grade>
            label={C.create.grade}
            testId="new-work-grade"
            value={grade}
            options={GRADES.map((g) => ({
              value: g,
              label: C.settings.grade[g],
            }))}
            onChange={setGrade}
          />
        </form>
      ) : (
        <form
          className="zz-stack"
          onSubmit={(event) => {
            event.preventDefault();
            if (valid) void submit();
          }}
        >
          <TextField
            label={C.create.genre}
            value={genre}
            onChange={setGenre}
            testId="new-article-genre"
            hint={C.create.genreHint}
          />
          <TextField
            label={C.create.driver}
            value={driver}
            onChange={setDriver}
            testId="new-article-driver"
            hint={C.create.driverHint}
          />
        </form>
      )}
    </Dialog>
  );
}
