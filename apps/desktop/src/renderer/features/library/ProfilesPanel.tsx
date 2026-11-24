import React, { useCallback, useEffect, useState } from "react";
import { Check, Copy, RotateCcw, Save, Trash2 } from "lucide-react";
import { DESKTOP_COPY } from "@zhizhang/ui/copy";
import { notify } from "@zhizhang/ui/notify";
import { Button, Skeleton } from "@zhizhang/ui/primitives";
import type { ProfileFileView, ProfileSummaryView } from "@zhizhang/workbench/contract";
import { askConfirm } from "../../state/confirm";
import { desktop } from "../../state/desktop";
import { useDesktop } from "../../state/store";
import { notifyError } from "../../format";

const C = DESKTOP_COPY;

export function ProfilesPanel() {
  const readonly = useDesktop((s) => Boolean(s.workspace?.readonly));
  const revision = useDesktop((s) => s.revisions.profiles);

  const [mode, setMode] = useState<"fanqie" | "toutiao">("fanqie");
  const [profiles, setProfiles] = useState<ProfileSummaryView[] | null>(null);
  const [activeProfile, setActiveProfile] = useState("");
  const [selectedId, setSelectedId] = useState("");
  const [files, setFiles] = useState<ProfileFileView[]>([]);
  const [selectedFile, setSelectedFile] = useState("");
  const [text, setText] = useState("");
  const [baseText, setBaseText] = useState<string | undefined>(undefined);
  const [forkName, setForkName] = useState("");
  const [busy, setBusy] = useState("");

  const loadList = useCallback(async () => {
    try {
      const res = await desktop.workbench("profiles.list", { mode });
      setProfiles(res.profiles);
      setActiveProfile(res.active);
      setSelectedId((prev) =>
        res.profiles.some((p) => p.id === prev) ? prev : res.active || res.profiles[0]?.id || "",
      );
    } catch (err) {
      notifyError(err);
    }
  }, [mode]);

  useEffect(() => {
    setProfiles(null);
    setSelectedId("");
    setFiles([]);
    setSelectedFile("");
    void loadList();
  }, [loadList, revision]);

  const loadDetail = useCallback(async () => {
    if (!selectedId) return;
    try {
      const detail = await desktop.workbench("profiles.detail", { mode, profile: selectedId });
      setFiles(detail.files);
      setSelectedFile((prev) =>
        detail.files.some((f) => f.id === prev) ? prev : (detail.files[0]?.id ?? ""),
      );
    } catch (err) {
      notifyError(err);
    }
  }, [mode, selectedId]);

  useEffect(() => {
    void loadDetail();
  }, [loadDetail, revision]);

  const loadMethod = useCallback(async () => {
    if (!selectedId || !selectedFile) return;
    try {
      const res = await desktop.workbench("profiles.method", {
        mode,
        profile: selectedId,
        id: selectedFile,
      });
      setText(res.method.text);
      setBaseText(res.base_text);
    } catch (err) {
      notifyError(err);
    }
  }, [mode, selectedId, selectedFile]);

  useEffect(() => {
    void loadMethod();
  }, [loadMethod]);

  const currentProfile = profiles?.find((p) => p.id === selectedId) ?? null;
  const isBuiltin = Boolean(currentProfile?.builtin);
  const isDiffFromBase = baseText !== undefined && baseText !== text;

  const activate = async (id: string) => {
    setBusy("use");
    try {
      await desktop.workbench("profiles.use", { mode, profile: id });
      setActiveProfile(id);
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const fork = async () => {
    if (!forkName.trim() || !selectedId) return;
    setBusy("fork");
    try {
      const res = await desktop.workbench("profiles.create", {
        mode,
        name: forkName.trim(),
        base: selectedId,
      });
      setForkName("");
      setSelectedId(res.profile);
      notify({ tone: "success", text: C.warehouse.forkDone });
      await loadList();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const remove = async () => {
    if (!selectedId || isBuiltin) return;
    if (!(await askConfirm(C.warehouse.deleteConfirm))) return;
    setBusy("delete");
    try {
      await desktop.workbench("profiles.delete", { mode, profile: selectedId, confirm: true });
      setSelectedId("");
      await loadList();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const saveMethod = async () => {
    if (!selectedId || !selectedFile || isBuiltin) return;
    setBusy("save");
    try {
      await desktop.workbench("profiles.save", {
        mode,
        profile: selectedId,
        id: selectedFile,
        text,
      });
      notify({ tone: "success", text: C.warehouse.savedMethod });
      await loadDetail();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  const resetMethod = async () => {
    if (!selectedId || !selectedFile || isBuiltin) return;
    setBusy("reset");
    try {
      await desktop.workbench("profiles.reset", { mode, profile: selectedId, id: selectedFile });
      notify({ tone: "info", text: C.warehouse.resetDone });
      await loadMethod();
      await loadDetail();
    } catch (err) {
      notifyError(err);
    } finally {
      setBusy("");
    }
  };

  return (
    <div className="zz-warehouse-grid" data-testid="warehouse-profiles">
      <aside className="zz-warehouse-side">
        <div className="zz-segmented zz-segmented--sm" role="tablist">
          <button
            type="button"
            role="tab"
            className="zz-segmented__item"
            aria-selected={mode === "fanqie"}
            onClick={() => setMode("fanqie")}
          >
            {C.warehouse.modeFanqie}
          </button>
          <button
            type="button"
            role="tab"
            className="zz-segmented__item"
            aria-selected={mode === "toutiao"}
            onClick={() => setMode("toutiao")}
          >
            {C.warehouse.modeToutiao}
          </button>
        </div>

        <section className="zz-panel-box">
          {!profiles ? (
            <Skeleton lines={4} />
          ) : (
            <ul className="zz-source-list">
              {profiles.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="zz-source-row"
                    data-active={p.id === selectedId}
                    onClick={() => setSelectedId(p.id)}
                  >
                    <strong>{p.name || p.id}</strong>
                    <span className="zz-meta-tag">
                      {p.id === activeProfile
                        ? C.warehouse.activeBadge
                        : p.builtin
                          ? C.warehouse.builtinBadge
                          : C.warehouse.userBadge}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </section>

        <section className="zz-panel-box">
          <h3>{C.warehouse.forkProfile}</h3>
          <input
            type="text"
            className="zz-input"
            value={forkName}
            disabled={readonly || busy !== ""}
            placeholder={C.warehouse.forkNamePlaceholder}
            onChange={(e) => setForkName(e.target.value)}
          />
          <Button
            size="sm"
            loading={busy === "fork"}
            disabled={readonly || !forkName.trim() || !selectedId}
            onClick={() => void fork()}
          >
            <Copy size={13} aria-hidden="true" />
            {C.warehouse.forkSubmit}
          </Button>
        </section>
      </aside>

      <div className="zz-warehouse-main">
        {currentProfile ? (
          <>
            <header className="zz-warehouse-bar">
              <div>
                <h2>{currentProfile.name || currentProfile.id}</h2>
                <span className="zz-muted">
                  {currentProfile.builtin ? C.warehouse.builtinBadge : C.warehouse.userBadge}
                </span>
              </div>
              <div className="zz-row">
                {currentProfile.id !== activeProfile ? (
                  <Button
                    size="sm"
                    variant="primary"
                    loading={busy === "use"}
                    disabled={readonly}
                    onClick={() => void activate(currentProfile.id)}
                  >
                    <Check size={13} aria-hidden="true" />
                    {C.warehouse.useProfile}
                  </Button>
                ) : null}
                {!isBuiltin ? (
                  <Button
                    size="sm"
                    variant="ghost"
                    loading={busy === "delete"}
                    disabled={readonly}
                    onClick={() => void remove()}
                  >
                    <Trash2 size={13} aria-hidden="true" />
                    {C.warehouse.deleteProfile}
                  </Button>
                ) : null}
              </div>
            </header>

            <div className="zz-profile-workspace">
              <ul className="zz-method-list" aria-label={C.warehouse.filesTitle}>
                {files.map((file) => (
                  <li key={file.id}>
                    <button
                      type="button"
                      className="zz-source-row"
                      data-active={file.id === selectedFile}
                      onClick={() => setSelectedFile(file.id)}
                    >
                      <span>{file.id}</span>
                      {file.modified ? (
                        <span className="zz-meta-tag">{C.warehouse.modifiedBadge}</span>
                      ) : null}
                    </button>
                  </li>
                ))}
              </ul>

              <div className="zz-method-editor">
                <header className="zz-method-editor__bar">
                  <strong>{selectedFile}</strong>
                  {isDiffFromBase ? (
                    <span className="zz-muted">{C.warehouse.baseDiffHint}</span>
                  ) : null}
                  {!isBuiltin ? (
                    <div className="zz-row">
                      <Button
                        size="sm"
                        variant="ghost"
                        loading={busy === "reset"}
                        disabled={readonly}
                        onClick={() => void resetMethod()}
                      >
                        <RotateCcw size={13} aria-hidden="true" />
                        {C.warehouse.resetMethod}
                      </Button>
                      <Button
                        size="sm"
                        variant="primary"
                        loading={busy === "save"}
                        disabled={readonly}
                        onClick={() => void saveMethod()}
                      >
                        <Save size={13} aria-hidden="true" />
                        {C.warehouse.saveMethod}
                      </Button>
                    </div>
                  ) : null}
                </header>
                <textarea
                  className="zz-method-textarea"
                  value={text}
                  readOnly={isBuiltin || readonly}
                  onChange={(e) => setText(e.target.value)}
                />
              </div>
            </div>
          </>
        ) : (
          <Skeleton lines={8} />
        )}
      </div>
    </div>
  );
}
