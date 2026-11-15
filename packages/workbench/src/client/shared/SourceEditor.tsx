/** Full-chapter source editor shared by the novel and Toutiao readers. */
import React, {
  useDeferredValue,
  useEffect,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { Button } from "@zhizhang/ui/primitives";
import { TextareaSurface } from "../../editor/TextareaSurface.js";
import { findMatches, matchFrom, matchesToHighlights } from "../../editor/find.js";
import { Icon } from "./components.js";
import { confirmAction } from "./confirm.js";
import { EDITOR_COPY as c } from "./copy.js";
import { FindBar, isShortcut, typingElsewhere, useFind } from "./FindBar.js";
import { applyScrollRatio, readScrollRatio } from "./reading-position.js";
import { useDraftStash } from "./useDraftStash.js";
import { canLeaveEdit, type EditorGuardSnapshot } from "./useSourceGuard.js";

const WHITESPACE = /\s+/g;
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

function countNonWhitespaceChars(text: string): number {
  const solid = text.replace(WHITESPACE, "");
  return solid.length - (solid.match(SURROGATE_PAIR)?.length ?? 0);
}

function selectionSeed(surface: TextareaSurface | null): string {
  if (!surface) return "";
  const { from, to } = surface.selection();
  const value = surface.value().slice(from, to);
  return value && value.length <= 80 && !value.includes("\n") ? value : "";
}

function statusOf({
  dirty,
  saving,
  stash,
  text,
}: {
  dirty: boolean;
  saving: boolean;
  stash: { failure: string; stashed: string };
  text: string;
}) {
  if (saving) return { state: "saving", label: c.saving };
  if (stash.failure) return { state: "failed", label: c.statusStashFailed, title: stash.failure };
  if (!dirty) return { state: "saved", label: c.statusSaved };
  if (stash.stashed === text) return { state: "stashed", label: c.statusStashed };
  return { state: "dirty", label: c.statusDirty };
}

export interface SourceEditorProps {
  initial: string;
  title?: string;
  note?: string;
  hint?: string;
  draftKey: string;
  baseRevision: string;
  saveConfirm?: string;
  position: React.MutableRefObject<number>;
  onSave: (text: string, baseRevision: string) => Promise<void>;
  onCancel: () => void;
  onStateChange?: (state: EditorGuardSnapshot | null) => void;
}

export function SourceEditor({
  initial,
  title,
  note,
  hint = "",
  draftKey,
  baseRevision,
  saveConfirm = "",
  position,
  onSave,
  onCancel,
  onStateChange,
}: SourceEditorProps) {
  const [text, setText] = useState(initial);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);
  const [current, setCurrent] = useState(0);
  const [replaced, setReplaced] = useState<number | null>(null);

  const stash = useDraftStash(draftKey, initial, text, baseRevision);
  const find = useFind();
  const { open: openFind, close: closeFind } = find;

  const reveal = useRef(false);
  const [revealTick, setRevealTick] = useState(0);
  const requestReveal = () => {
    reveal.current = true;
    setRevealTick((tick) => tick + 1);
  };

  const root = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const backdrop = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<TextareaSurface | null>(null);

  const dirty = text !== initial;
  const confirming = useRef(false);
  const latest = useRef({ saving, dirty, discard, hasOffer: !!stash.offer, findOpen: !!find.mode });
  latest.current = { saving, dirty, discard, hasOffer: !!stash.offer, findOpen: !!find.mode };

  const leaveRef = useRef<() => void>(() => {});
  const saveRef = useRef<() => Promise<void>>(async () => {});

  leaveRef.current = () => {
    if (!latest.current.hasOffer) stash.settle();
    onCancel();
  };

  useLayoutEffect(() => {
    if (!field.current) return undefined;
    const surface = new TextareaSurface(field.current, { backdrop: backdrop.current });
    surfaceRef.current = surface;
    return () => {
      surface.dispose();
      surfaceRef.current = null;
    };
  }, []);

  useEffect(() => {
    surfaceRef.current?.setBackdrop(backdrop.current);
  });

  useEffect(() => {
    onStateChange?.({ dirty, saving, discard: () => leaveRef.current() });
  }, [dirty, saving, onStateChange]);

  useEffect(() => () => onStateChange?.(null), [onStateChange]);

  useLayoutEffect(() => {
    if (field.current) applyScrollRatio(field.current, position.current);
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
      await onSave(text, stash.base);
      stash.settle();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  saveRef.current = save;

  useEffect(() => {
    const keyboard = (event: KeyboardEvent) => {
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
      openFind(findMode, selectionSeed(surfaceRef.current));
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, [openFind]);

  const confirmDiscard = async () => {
    confirming.current = true;
    try {
      if (await canLeaveEdit(latest.current, confirmAction)) leaveRef.current();
    } finally {
      confirming.current = false;
    }
  };

  const escape = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key !== "Escape") return;
    event.preventDefault();
    if (event.repeat || event.nativeEvent.isComposing || event.keyCode === 229) return;
    const state = latest.current;
    if (state.findOpen) {
      closeFind();
      surfaceRef.current?.focus();
      return;
    }
    if (state.saving || confirming.current) return;
    if (!state.dirty) leaveRef.current();
    else if (!state.discard) setDiscard(true);
    else void confirmDiscard();
  };

  const deferred = useDeferredValue(text);
  const count = useMemo(() => countNonWhitespaceChars(deferred), [deferred]);
  const matches = useMemo(
    () => (find.mode ? findMatches(text, find.query, find.matchCase) : []),
    [text, find.mode, find.query, find.matchCase],
  );
  const active = matches.length ? Math.min(current, matches.length - 1) : -1;

  useEffect(() => {
    if (!find.mode) return;
    setReplaced(null);
    const surface = surfaceRef.current;
    const liveText = surface ? surface.value() : text;
    const fresh = findMatches(liveText, find.query, find.matchCase);
    const caret = surface ? surface.selection().from : 0;
    reveal.current = true;
    setRevealTick((tick) => tick + 1);
    setCurrent(fresh.length ? matchFrom(fresh, caret) : 0);
  }, [find.mode, find.query, find.matchCase]);

  useLayoutEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;
    surface.highlight(matchesToHighlights(matches, active));
    if (!reveal.current || active < 0 || !matches[active]) return;
    reveal.current = false;
    const [start, end] = matches[active];
    surface.select(start, end);
    surface.scrollTo(start);
  }, [active, matches, revealTick]);

  const step = (direction: 1 | -1) => {
    if (!matches.length) return;
    setReplaced(null);
    requestReveal();
    setCurrent((active + direction + matches.length) % matches.length);
  };

  const replaceCurrent = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const fresh = findMatches(surface.value(), find.query, find.matchCase);
    if (!fresh.length) return;
    const at = matchFrom(fresh, surface.selection().from);
    const [start, end] = fresh[at];
    surface.replaceRange(start, end, find.replacement);
    const after = findMatches(surface.value(), find.query, find.matchCase);
    requestReveal();
    setCurrent(after.length ? matchFrom(after, start + find.replacement.length) : 0);
  };

  const replaceAll = () => {
    const surface = surfaceRef.current;
    if (!surface) return;
    const currentText = surface.value();
    const fresh = findMatches(currentText, find.query, find.matchCase);
    if (!fresh.length) return;
    let next = "";
    let at = 0;
    for (const [start, end] of fresh) {
      next += currentText.slice(at, start) + find.replacement;
      at = end;
    }
    surface.replaceRange(0, currentText.length, next + currentText.slice(at));
    setReplaced(fresh.length);
  };

  const status = statusOf({ dirty, saving, stash, text });
  const offer = stash.offer;

  return (
    <div className="wb-source-editor" data-testid="source-editor" ref={root} onKeyDown={escape}>
      <div className="wb-source-editor-head">
        <strong>{title || c.title}</strong>
        <span
          className="wb-source-status"
          data-state={status.state}
          title={status.title}
          role="status"
        >
          {status.label}
        </span>
        <span className="wb-muted">{c.words(count)}</span>
        <Button
          variant="ghost"
          className="wb-source-find"
          title={c.shortcuts}
          aria-keyshortcuts="Control+F Control+H"
          onClick={() => find.open("replace", selectionSeed(surfaceRef.current))}
        >
          <Icon name="search" size={14} />
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
            onClick={() => {
              setText(stash.restore());
              setDiscard(false);
            }}
          >
            {c.restore}
          </Button>
          <Button variant="ghost" onClick={stash.drop}>
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
            surfaceRef.current?.focus();
          }}
          canReplace
        />
      ) : null}
      <div className="wb-source-field">
        <div ref={backdrop} className="wb-source-backdrop" aria-hidden="true" />
        <textarea
          ref={field}
          className="wb-source-text"
          data-testid="source-editor-input"
          aria-label={title || c.title}
          aria-keyshortcuts="Control+S Control+F Control+H Escape"
          value={text}
          spellCheck={false}
          onScroll={(event) => {
            const box = event.currentTarget;
            position.current = readScrollRatio(box);
            surfaceRef.current?.syncScroll();
          }}
          onChange={(event) => {
            setText(event.target.value);
            setDiscard(false);
          }}
        />
      </div>
      {error ? <p role="alert">{error}</p> : null}
      <div className="wb-action-row">
        <Button
          variant="primary"
          data-testid="source-editor-save"
          onClick={() => void save()}
          disabled={saving}
        >
          {saving ? c.saving : c.save}
        </Button>
        <Button
          data-testid="source-editor-cancel"
          onClick={() => {
            if (dirty && !discard) {
              setDiscard(true);
              return;
            }
            leaveRef.current();
          }}
          disabled={saving}
        >
          {discard ? c.discard : c.cancel}
        </Button>
        <span className="wb-muted">{hint || c.hint}</span>
      </div>
    </div>
  );
}
