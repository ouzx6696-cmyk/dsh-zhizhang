/** Full-chapter source editor shared by the novel and Toutiao readers. */
import React from "react";
import { Button, Icon } from "./ui.jsx";
import { t, EDITOR_COPY as c } from "../../../../ui/src/copy.js";
import { confirmAction } from "./confirm.js";
import { FindBar, isShortcut, typingElsewhere, useFind } from "./FindBar.jsx";
import { findMatches, matchFrom } from "./find.js";
import { applyScrollRatio, readScrollRatio } from "./reading-position.js";
import { useDraftStash } from "./useDraftStash.js";
import { canLeaveEdit } from "./useSourceGuard.js";

const { useDeferredValue, useEffect, useLayoutEffect, useMemo, useRef, useState } = React;

const WHITESPACE = /\s+/g;
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

/** Characters other than whitespace, counting an astral character (emoji, rare hanzi) once. */
function countNonWhitespaceChars(text) {
  const solid = text.replace(WHITESPACE, "");
  return solid.length - (solid.match(SURROGATE_PAIR)?.length ?? 0);
}

/** A short single-line selection becomes the query, the way editors seed find. */
function selectionSeed(field) {
  const value = field.value.slice(field.selectionStart, field.selectionEnd);
  return value && value.length <= 80 && !value.includes("\n") ? value : "";
}

/**
 * Replaces [start, end) through the browser's editing command so Ctrl+Z undoes it like typing;
 * focus returns to the find bar afterwards.
 */
function editRange(field, start, end, value) {
  const back = document.activeElement;
  field.focus();
  field.setSelectionRange(start, end);
  if (value) document.execCommand("insertText", false, value);
  else document.execCommand("delete");
  if (back instanceof HTMLElement) back.focus();
}

function statusOf({ dirty, saving, stash, text }) {
  if (saving) return { state: "saving", label: t("editorSaving") };
  if (stash.failure) return { state: "failed", label: c.statusStashFailed, title: stash.failure };
  if (!dirty) return { state: "saved", label: c.statusSaved };
  if (stash.stashed === text) return { state: "stashed", label: c.statusStashed };
  return { state: "dirty", label: c.statusDirty };
}

/** Matches highlighted behind the transparent textarea; it scrolls with the textarea. */
function FindBackdrop({ text, matches, current, backdrop }) {
  const parts = [];
  let at = 0;
  matches.forEach(([start, end], index) => {
    parts.push(text.slice(at, start));
    parts.push(
      <mark key={start} data-current={index === current ? "true" : undefined}>
        {text.slice(start, end)}
      </mark>,
    );
    at = end;
  });
  // The trailing space keeps a final newline's empty line, so both boxes scroll the same height.
  parts.push(text.slice(at) + " ");
  return (
    <div ref={backdrop} className="wb-source-backdrop" aria-hidden="true">
      {parts}
    </div>
  );
}

export function SourceEditor({
  initial,
  title,
  note,
  hint,
  draftKey,
  baseRevision,
  saveConfirm,
  position,
  onSave,
  onCancel,
  onStateChange,
}) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [current, setCurrent] = useState(0);
  const [replaced, setReplaced] = useState(null);
  const stash = useDraftStash(draftKey, initial, text, baseRevision);
  const find = useFind();
  const { open: openFind, close: closeFind } = find;
  // Stepping, a new query or a replace asks the next render to select and reveal the current
  // match; typing in the text while the bar is open must not move the caret.
  const reveal = useRef(false);
  const [revealTick, setRevealTick] = useState(0);
  const requestReveal = () => {
    reveal.current = true;
    setRevealTick((tick) => tick + 1);
  };
  const root = useRef(null);
  const field = useRef(null);
  const backdrop = useRef(null);
  const dirty = text !== initial;
  const confirming = useRef(false);
  const latest = useRef(null);
  latest.current = { saving, dirty, discard, offer: stash.offer, findOpen: !!find.mode };
  const leaveRef = useRef(null);
  const saveRef = useRef(null);
  // Leaving without saving drops the draft too, unless an offered draft is still undecided.
  leaveRef.current = () => {
    if (!latest.current.offer) stash.settle();
    onCancel();
  };

  useEffect(() => {
    onStateChange?.({ dirty, saving, discard: () => leaveRef.current() });
  }, [dirty, saving, onStateChange]);
  useEffect(() => () => onStateChange?.(null), [onStateChange]);

  useLayoutEffect(() => {
    applyScrollRatio(field.current, position.current);
  }, [position]);

  const save = async () => {
    if (saving) return;
    if (!dirty) {
      leaveRef.current();
      return;
    }
    if (saveConfirm && !(await confirmAction(saveConfirm))) return;
    setSaving(true);
    setError("");
    try {
      // A restored draft saves against the revision it was typed on; if the text on disk moved on
      // since, the save is refused as a conflict and the draft stays.
      await onSave(text, stash.base);
      stash.settle();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  // Save and find stay on window so they work from anywhere in the reader.
  useEffect(() => {
    const keyboard = (event) => {
      // 原生 showModal() 不加 aria-modal；与全局快捷键用同一判定，对话框打开时把按键留给对话框。
      if (document.querySelector("dialog[open]")) return;
      if (isShortcut(event, "s")) {
        event.preventDefault();
        event.stopImmediatePropagation();
        void saveRef.current();
        return;
      }
      const findMode = isShortcut(event, "f") ? "find" : isShortcut(event, "h") ? "replace" : "";
      if (!findMode || typingElsewhere(event, root.current)) return;
      event.preventDefault();
      openFind(findMode, selectionSeed(field.current));
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [openFind]);

  // Esc belongs to the editor only when it is pressed inside it; anywhere else it reaches the
  // shell (stop task, close drawer) untouched.
  const escape = (event) => {
    if (event.key !== "Escape") return;
    // A held key or an IME cancelling its composition must never step towards discarding; the
    // press is still claimed so the shell does not act on it either.
    event.preventDefault();
    if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const state = latest.current;
    // Esc first closes the find bar and goes back to the text; it never starts discarding.
    if (state.findOpen) {
      closeFind();
      field.current.focus();
      return;
    }
    if (state.saving || confirming.current) return;
    if (!state.dirty) leaveRef.current();
    else if (!state.discard) setDiscard(true);
    else void confirmDiscard();
  };
  // A second Esc on unsaved text asks inside the app; only the author's yes drops text and draft.
  const confirmDiscard = async () => {
    confirming.current = true;
    try {
      if (await canLeaveEdit(latest.current, confirmAction)) leaveRef.current();
    } finally {
      confirming.current = false;
    }
  };

  const deferred = useDeferredValue(text);
  const count = useMemo(() => countNonWhitespaceChars(deferred), [deferred]);
  // Find works on the live text so replacing and stepping never act on stale offsets.
  const matches = useMemo(
    () => (find.mode ? findMatches(text, find.query, find.matchCase) : []),
    [text, find.mode, find.query, find.matchCase],
  );
  const active = matches.length ? Math.min(current, matches.length - 1) : -1;

  // A new query starts from the caret, the way a find bar does in any editor.
  useEffect(() => {
    if (!find.mode) return;
    setReplaced(null);
    const fresh = findMatches(field.current.value, find.query, find.matchCase);
    reveal.current = true;
    setRevealTick((tick) => tick + 1);
    setCurrent(fresh.length ? matchFrom(fresh, field.current.selectionStart) : 0);
  }, [find.mode, find.query, find.matchCase]);

  // Select the current match in the textarea and bring it into view without taking focus.
  useLayoutEffect(() => {
    const mark = backdrop.current?.querySelector("mark[data-current]");
    if (!reveal.current || !mark) return;
    reveal.current = false;
    const box = field.current;
    box.setSelectionRange(matches[active][0], matches[active][1]);
    const top = mark.offsetTop;
    if (top < box.scrollTop || top + mark.offsetHeight > box.scrollTop + box.clientHeight)
      box.scrollTop = top - box.clientHeight / 3;
    backdrop.current.scrollTop = box.scrollTop;
  }, [active, matches, revealTick]);

  const step = (direction) => {
    if (!matches.length) return;
    setReplaced(null);
    requestReveal();
    setCurrent((active + direction + matches.length) % matches.length);
  };
  const replaceCurrent = () => {
    const box = field.current;
    const fresh = findMatches(box.value, find.query, find.matchCase);
    if (!fresh.length) return;
    // The selected match if the author left it selected, else the next one from the caret.
    const at = matchFrom(fresh, box.selectionStart);
    const [start, end] = fresh[at];
    editRange(box, start, end, find.replacement);
    const after = findMatches(box.value, find.query, find.matchCase);
    requestReveal();
    setCurrent(after.length ? matchFrom(after, start + find.replacement.length) : 0);
  };
  const replaceAll = () => {
    const box = field.current;
    const fresh = findMatches(box.value, find.query, find.matchCase);
    if (!fresh.length) return;
    let next = "";
    let at = 0;
    for (const [start, end] of fresh) {
      next += box.value.slice(at, start) + find.replacement;
      at = end;
    }
    editRange(box, 0, box.value.length, next + box.value.slice(at));
    setReplaced(fresh.length);
  };

  const status = statusOf({ dirty, saving, stash, text });
  const offer = stash.offer;
  return (
    <div className="wb-source-editor" ref={root} onKeyDown={escape}>
      <div className="wb-source-editor-head">
        <strong>{title || t("editorTitle")}</strong>
        <span
          className="wb-source-status"
          data-state={status.state}
          title={status.title}
          role="status"
        >
          {status.label}
        </span>
        <span className="wb-muted">{t("words", { n: count })}</span>
        <Button
          variant="ghost"
          size="sm"
          className="wb-source-find"
          title={c.shortcuts}
          aria-keyshortcuts="Control+F Control+H"
          onClick={() => find.open("replace", selectionSeed(field.current))}
          icon={<Icon name="search" size={14} />}
        >
          {c.findOpen}
        </Button>
      </div>
      {note ? <p className="wb-muted wb-source-note">{note}</p> : null}
      {offer ? (
        <div className="wb-source-offer" role="group" aria-label={c.draftOffer}>
          <span>
            {c.restoreLead(
              new Date(offer.savedAt).toLocaleString(undefined, {
                month: "numeric",
                day: "numeric",
                hour: "2-digit",
                minute: "2-digit",
                hourCycle: "h23",
              }),
              countNonWhitespaceChars(offer.text),
            )}
          </span>
          <Button
            variant="primary"
            size="sm"
            onClick={() => {
              setText(stash.restore());
              setDiscard(false);
            }}
          >
            {c.restore}
          </Button>
          <Button variant="ghost" size="sm" onClick={stash.drop}>
            {c.discardDraft}
          </Button>
        </div>
      ) : null}
      {find.mode ? (
        <FindBar
          find={find}
          label={c.findPanel}
          index={active}
          total={matches.length}
          status={replaced == null ? undefined : c.replacedAll(replaced)}
          onStep={step}
          onReplace={replaceCurrent}
          onReplaceAll={replaceAll}
          onClose={() => {
            find.close();
            field.current.focus();
          }}
          canReplace
        />
      ) : null}
      <div className="wb-source-field">
        {matches.length ? (
          <FindBackdrop text={text} matches={matches} current={active} backdrop={backdrop} />
        ) : null}
        <textarea
          ref={field}
          className="wb-source-text"
          aria-label={title || t("editorTitle")}
          aria-keyshortcuts="Control+S Control+F Control+H Escape"
          value={text}
          spellCheck={false}
          onScroll={(event) => {
            const box = event.currentTarget;
            position.current = readScrollRatio(box);
            if (backdrop.current) backdrop.current.scrollTop = box.scrollTop;
          }}
          onChange={(event) => {
            setText(event.target.value);
            setDiscard(false);
          }}
        />
      </div>
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
            leaveRef.current();
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
