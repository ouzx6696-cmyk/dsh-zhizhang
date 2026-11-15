import React, { useState } from "react";
import { COPY, DESKTOP_COPY as C } from "@zhizhang/ui/copy";
import { Button, Dialog, Segmented } from "@zhizhang/ui/primitives";
import type { EngineSettings } from "../../../shared/settings";
import { createArticle, createWork } from "../../state/controller";
import { desktopStore, useDesktop, type CreateKind } from "../../state/store";
import { notifyError } from "../../format";
import { TextField } from "../workspace/TextField";

type Grade = EngineSettings["grade"];

/** 新作品 / 新文章：本地建目录（fanqie.work.create / toutiao.article.create），不经模型。 */
export function NewTargetDialog({ kind }: { kind: CreateKind }) {
  const defaultGrade = useDesktop((s) => s.settings?.engine.grade ?? "standard");
  const [title, setTitle] = useState("");
  const [premise, setPremise] = useState("");
  const [grade, setGrade] = useState<Grade>(defaultGrade);
  const [genre, setGenre] = useState<string>(C.create.genreDefault);
  const [driver, setDriver] = useState<string>(C.create.driverDefault);
  const [busy, setBusy] = useState(false);
  const close = () => desktopStore.set({ creating: null });
  const fanqie = kind === "fanqie";
  const valid = fanqie ? title.trim() !== "" : genre.trim() !== "" && driver.trim() !== "";
  const submit = async () => {
    setBusy(true);
    try {
      if (fanqie) await createWork({ title: title.trim(), premise, grade });
      else await createArticle({ genre: genre.trim(), driver: driver.trim() });
    } catch (error) {
      notifyError(error);
    } finally {
      setBusy(false);
    }
  };
  return (
    <Dialog
      title={fanqie ? C.create.newWork : C.create.newArticle}
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
            {C.create.submit}
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
          <TextField label={C.create.title} value={title} onChange={setTitle} testId="new-work-title" required autoFocus />
          <TextField label={C.create.premise} value={premise} onChange={setPremise} testId="new-work-premise" multiline placeholder={C.create.premiseHint} />
          <Segmented<Grade>
            label={C.create.grade}
            testId="new-work-grade"
            value={grade}
            options={(["economy", "standard", "premium"] as const).map((g) => ({ value: g, label: C.settings.grade[g] }))}
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
          <TextField label={C.create.genre} value={genre} onChange={setGenre} testId="new-article-genre" hint={C.create.genreHint} />
          <TextField label={C.create.driver} value={driver} onChange={setDriver} testId="new-article-driver" hint={C.create.driverHint} />
        </form>
      )}
    </Dialog>
  );
}
