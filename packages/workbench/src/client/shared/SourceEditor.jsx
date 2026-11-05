/** Full-chapter source editor shared by the novel and Toutiao readers. */
import React from "react";
import { Button } from "./ui.jsx";
import { t } from "../../../../ui/src/copy.js";

const { useEffect, useMemo, useRef, useState } = React;

function countNonWhitespaceChars(text) {
  let count = 0;
  for (const char of text) {
    if (!/\s/.test(char)) count += 1;
  }
  return count;
}

export function SourceEditor({ initial, title, note, hint, onSave, onCancel, onStateChange }) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const savingRef = useRef(saving);
  savingRef.current = saving;
  const textRef = useRef(text);
  const discardRef = useRef(discard);
  const initialRef = useRef(initial);
  const saveRef = useRef(null);
  const cancelRef = useRef(onCancel);
  textRef.current = text;
  discardRef.current = discard;
  cancelRef.current = onCancel;
  const dirty = text !== initialRef.current;
  useEffect(() => {
    onStateChange?.({ dirty, saving, discard: () => cancelRef.current() });
  }, [dirty, saving, onStateChange]);
  useEffect(() => () => onStateChange?.(null), [onStateChange]);

  const save = async () => {
    if (saving) return;
    if (!dirty) {
      cancelRef.current();
      return;
    }
    setSaving(true);
    setError("");
    try {
      await onSave(text);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  useEffect(() => {
    const keyboard = (event) => {
      if (document.querySelector('[aria-modal="true"]')) return;
      if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === "s") {
        event.preventDefault();
        event.stopImmediatePropagation();
        void saveRef.current?.();
        return;
      }
      if (event.key !== "Escape") return;
      event.preventDefault();
      event.stopImmediatePropagation();
      if (savingRef.current) return;
      if (textRef.current === initialRef.current || discardRef.current) cancelRef.current();
      else setDiscard(true);
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, []);

  const count = useMemo(() => countNonWhitespaceChars(text), [text]);

  return (
    <div className="wb-source-editor">
      <div className="wb-source-editor-head">
        <strong>{title || t("editorTitle")}</strong>
        <span>{dirty ? t("editorDirty") : t("editorClean")}</span>
        <span className="wb-muted">{t("words", { n: count })}</span>
      </div>
      {note ? <p className="wb-muted wb-source-note">{note}</p> : null}
      <textarea
        className="wb-source-text"
        aria-label={title || t("editorTitle")}
        value={text}
        spellCheck={false}
        onChange={(event) => {
          setText(event.target.value);
          setDiscard(false);
        }}
      />
      {error ? <p role="alert">{error}</p> : null}
      <div className="wb-action-row">
        <Button variant="primary" onClick={save} disabled={saving}>
          {saving ? t("editorSaving") : t("editorSave")}
        </Button>
        <Button
          onClick={() => {
            if (dirty && !discard) {
              setDiscard(true);
              return;
            }
            cancelRef.current();
          }}
          disabled={saving}
        >
          {discard ? t("editorDiscard") : t("editorCancel")}
        </Button>
        <span className="wb-muted">{hint || t("editorHint")}</span>
      </div>
    </div>
  );
}
