/** Full-chapter source editor shared by the novel and Toutiao readers. */
import React, {
  useDeferredValue,
  useEffect,
  useId,
  useLayoutEffect,
  useMemo,
  useRef,
  useState,
} from "react";
import { WORKBENCH_COPY } from "@zhizhang/ui/copy";
import { Button, Field } from "@zhizhang/ui/primitives";
import { TextareaSurface } from "../../editor/TextareaSurface.js";
import { selectionSeed, useSourceFind } from "../../editor/useSourceFind.js";
import { joinLeadHeading, splitLeadHeading } from "../../manuscript/heading.js";
import { Icon } from "./components.js";
import { confirmAction } from "./confirm.js";
import { isShortcut } from "./FindBar.js";
import { applyScrollRatio, readScrollRatio } from "./reading-position.js";
import { useDraftStash } from "./useDraftStash.js";
import { canLeaveEdit, type EditorGuardSnapshot } from "./useSourceGuard.js";

const c = WORKBENCH_COPY.editor;
const WHITESPACE = /\s+/g;
const SURROGATE_PAIR = /[\uD800-\uDBFF][\uDC00-\uDFFF]/g;

function countNonWhitespaceChars(text: string): number {
  const solid = text.replace(WHITESPACE, "");
  return solid.length - (solid.match(SURROGATE_PAIR)?.length ?? 0);
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
  /** 开启后把正文首行 `# 标题` 拆为上方标题框，textarea 只编辑其余正文（章节编辑）。 */
  headingField?: boolean;
  /** 编辑条左侧的定位信息（例如“第 1 章”）；不传时显示 title。 */
  lead?: React.ReactNode;
  /** 编辑条下方的附加栏（例如头条的标题输入）。 */
  extra?: React.ReactNode;
  note?: string;
  hint?: string;
  draftKey: string;
  baseRevision: string;
  saveConfirm?: string;
  position: React.MutableRefObject<number>;
  /** 第三参 title：开启 headingField 时随保存同步到 front matter。 */
  onSave: (text: string, baseRevision: string, title?: string) => Promise<void>;
  onCancel: () => void;
  onStateChange?: (state: EditorGuardSnapshot | null) => void;
}

export function SourceEditor({
  initial,
  title,
  headingField = false,
  lead,
  extra,
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
  // 首行标题拆分：拆分只移除标题行，其余逐字保留，因此原样打开时 joined === initial。
  const pristine = useMemo(
    () =>
      headingField
        ? splitLeadHeading(initial)
        : { title: undefined, rest: initial, hadHeading: false },
    [headingField, initial],
  );
  const [text, setText] = useState(pristine.rest);
  const [heading, setHeading] = useState(pristine.title ?? title ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [discard, setDiscard] = useState(false);

  const joined = useMemo(
    () => (headingField && pristine.hadHeading ? joinLeadHeading(heading, text) : text),
    [headingField, pristine.hadHeading, heading, text],
  );

  const root = useRef<HTMLDivElement | null>(null);
  const field = useRef<HTMLTextAreaElement | null>(null);
  const backdrop = useRef<HTMLDivElement | null>(null);
  const surfaceRef = useRef<TextareaSurface | null>(null);
  const titleId = useId();

  const stash = useDraftStash(draftKey, initial, joined, baseRevision);
  const { find, bar } = useSourceFind({ text, surface: surfaceRef, root });

  const dirty = joined !== initial;
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
      await onSave(joined, stash.base, headingField ? heading.trim() || undefined : undefined);
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
      if (!isShortcut(event, "s")) return;
      event.preventDefault();
      event.stopImmediatePropagation();
      void saveRef.current();
    };
    window.addEventListener("keydown", keyboard, true);
    return () => window.removeEventListener("keydown", keyboard, true);
  }, []);

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
      find.close();
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

  const status = statusOf({ dirty, saving, stash, text: joined });
  const offer = stash.offer;

  return (
    <div className="wb-editor" data-testid="source-editor" ref={root} onKeyDown={escape}>
      <header className="wb-bar">
        <div className="wb-bar-lead">
          {lead ?? <strong className="wb-bar-title">{title || c.title}</strong>}
        </div>
        <div className="wb-bar-actions">
          <Button
            variant="ghost"
            size="sm"
            title={c.shortcuts}
            aria-keyshortcuts="Control+F Control+H"
            onClick={() => find.open("replace", selectionSeed(surfaceRef.current))}
          >
            <Icon name="search" size={14} />
            {c.findOpen}
          </Button>
          <Button
            size="sm"
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
          <Button
            variant="strong"
            size="sm"
            data-testid="source-editor-save"
            onClick={() => void save()}
            disabled={saving}
          >
            {saving ? c.saving : c.save}
          </Button>
        </div>
      </header>
      {extra}
      {note ? <p className="wb-editor-note">{note}</p> : null}
      {offer ? (
        <div
          className="wb-editor-offer"
          role="group"
          aria-label={c.draftOffer}
          data-testid="draft-offer"
        >
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
            size="sm"
            variant="strong"
            onClick={() => {
              const restored = stash.restore();
              if (headingField) {
                const split = splitLeadHeading(restored);
                setHeading(split.title ?? "");
                setText(split.rest);
              } else {
                setText(restored);
              }
              setDiscard(false);
            }}
          >
            {c.restore}
          </Button>
          <Button size="sm" variant="ghost" onClick={stash.drop}>
            {c.discardDraft}
          </Button>
        </div>
      ) : null}
      {bar}
      {error ? (
        <p className="wb-editor-error" role="alert">
          {error}
        </p>
      ) : null}
      {headingField ? (
        <Field id={titleId} label={c.titleField}>
          <input
            id={titleId}
            className="zz-input"
            data-testid="source-editor-title"
            aria-label={c.titleField}
            value={heading}
            onChange={(event) => {
              setHeading(event.target.value);
              setDiscard(false);
            }}
          />
        </Field>
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
      <footer className="wb-statusbar">
        <span
          className="wb-source-status"
          data-state={status.state}
          title={status.title}
          role="status"
        >
          {status.label}
        </span>
        <span className="wb-statusbar-item">{c.words(count)}</span>
        <span className="wb-statusbar-spacer" />
        <span className="wb-statusbar-item">{hint || c.hint}</span>
      </footer>
    </div>
  );
}
