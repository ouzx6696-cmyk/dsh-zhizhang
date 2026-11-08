/** The find (and, in the editor, replace) bar opened with Ctrl+F / Ctrl+H. */
import React from "react";
import { Button, Checkbox, Icon } from "./ui.jsx";
import { EDITOR_COPY as c } from "../../../../ui/src/copy.js";

const { useCallback, useEffect, useRef, useState } = React;

/** Find state owned by the reader or editor; `mode` is null while the bar is closed. */
export function useFind() {
  const [mode, setMode] = useState(null);
  const [query, setQuery] = useState("");
  const [replacement, setReplacement] = useState("");
  const [matchCase, setMatchCase] = useState(false);
  // Bumped on every open so a second Ctrl+F puts focus back into the query.
  const [focusTick, setFocusTick] = useState(0);
  const open = useCallback((next, seed) => {
    setMode(next);
    if (seed) setQuery(seed);
    setFocusTick((tick) => tick + 1);
  }, []);
  const close = useCallback(() => setMode(null), []);
  return {
    mode,
    query,
    setQuery,
    replacement,
    setReplacement,
    matchCase,
    setMatchCase,
    focusTick,
    open,
    close,
    setMode,
  };
}

/** True for Ctrl/⌘ + `key` without other modifiers. */
export function isShortcut(event, key) {
  return (
    (event.ctrlKey || event.metaKey) &&
    !event.altKey &&
    !event.shiftKey &&
    event.key.toLowerCase() === key
  );
}

/**
 * True when the key went to a text field outside `root` (the chat box, a form): find stays out of
 * the author's way there.
 */
export function typingElsewhere(event, root) {
  const target = event.target;
  if (!(target instanceof HTMLElement) || root?.contains(target)) return false;
  return target.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName);
}

export function FindBar({
  find,
  label,
  index,
  total,
  status: override,
  onStep,
  onReplace,
  onReplaceAll,
  onClose,
  canReplace = false,
}) {
  const input = useRef(null);
  useEffect(() => {
    input.current.focus();
    input.current.select();
  }, [find.focusTick]);
  const replacing = canReplace && find.mode === "replace";
  const status = override ?? (!find.query ? "" : total ? c.position(index + 1, total) : c.noMatch);
  return (
    <div className="wb-find" role="search" aria-label={label}>
      <div className="wb-find-row">
        <input
          ref={input}
          className="wb-input wb-find-input"
          type="text"
          value={find.query}
          placeholder={c.find}
          aria-label={c.findLabel}
          aria-keyshortcuts="Enter Shift+Enter Escape"
          spellCheck={false}
          onChange={(event) => find.setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
            event.preventDefault();
            onStep(event.shiftKey ? -1 : 1);
          }}
        />
        <span className="wb-find-count" role="status" aria-live="polite">
          {status}
        </span>
        <Button
          variant="ghost"
          size="sm"
          aria-label={c.previous}
          title={c.previous + " (Shift+Enter)"}
          disabled={!total}
          onClick={() => onStep(-1)}
          icon={<Icon name="up" size={14} />}
        />
        <Button
          variant="ghost"
          size="sm"
          aria-label={c.next}
          title={c.next + " (Enter)"}
          disabled={!total}
          onClick={() => onStep(1)}
          icon={<Icon name="down" size={14} />}
        />
        <Checkbox
          className="wb-find-case"
          checked={find.matchCase}
          onChange={find.setMatchCase}
          label={c.matchCase}
        />
        {canReplace ? (
          <Button
            variant="ghost"
            size="sm"
            aria-expanded={replacing}
            title={c.showReplace + " (Ctrl+H)"}
            onClick={() => find.setMode(replacing ? "find" : "replace")}
          >
            {c.showReplace}
          </Button>
        ) : null}
        <Button
          variant="ghost"
          size="sm"
          aria-label={c.closeFind}
          title={c.closeFind + " (Esc)"}
          onClick={onClose}
          icon={<Icon name="close" size={14} />}
        />
      </div>
      {replacing ? (
        <div className="wb-find-row">
          <input
            className="wb-input wb-find-input"
            type="text"
            value={find.replacement}
            placeholder={c.replaceLabel}
            aria-label={c.replaceLabel}
            spellCheck={false}
            onChange={(event) => find.setReplacement(event.target.value)}
            onKeyDown={(event) => {
              if (event.key !== "Enter" || event.nativeEvent.isComposing) return;
              event.preventDefault();
              onReplace();
            }}
          />
          <Button variant="outline" size="sm" disabled={!total} onClick={onReplace}>
            {c.replace}
          </Button>
          <Button variant="outline" size="sm" disabled={!total} onClick={onReplaceAll}>
            {c.replaceAll}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
