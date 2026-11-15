import { jsx as _jsx } from "react/jsx-runtime";
import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import { getCustomHighlightApi } from "../../editor/TextareaSurface.js";
import { findMatches } from "../../editor/find.js";
import { FindBar, isShortcut, typingElsewhere, useFind } from "./FindBar.js";
import { revealRect, scrollParentOf } from "./reading-position.js";
function activeHighlightRect() {
    const api = getCustomHighlightApi();
    const highlight = api?.registry.get("wb-find-current");
    if (!highlight || typeof highlight !== "object")
        return null;
    if (!(Symbol.iterator in highlight))
        return null;
    const iteratorFn = Reflect.get(highlight, Symbol.iterator);
    if (typeof iteratorFn !== "function")
        return null;
    const iter = Reflect.apply(iteratorFn, highlight, []);
    if (!iter || typeof iter !== "object" || !("next" in iter) || typeof iter.next !== "function") {
        return null;
    }
    const first = iter.next();
    if (!first || typeof first !== "object" || !("value" in first))
        return null;
    return first.value instanceof Range ? first.value.getBoundingClientRect() : null;
}
export function useReaderFind(body, enabled) {
    const find = useFind();
    const [text, setText] = useState("");
    const [current, setCurrent] = useState(0);
    const reveal = useRef(false);
    useEffect(() => {
        if (!enabled) {
            find.close();
            return undefined;
        }
        const onKeyDown = (event) => {
            if (document.querySelector("dialog[open]"))
                return;
            if (!isShortcut(event, "f") || typingElsewhere(event, body.current))
                return;
            event.preventDefault();
            const selected = window.getSelection()?.toString().trim() ?? "";
            const seed = selected && selected.length <= 80 && !selected.includes("\n") ? selected : "";
            find.open("find", seed);
        };
        window.addEventListener("keydown", onKeyDown, true);
        return () => window.removeEventListener("keydown", onKeyDown, true);
    }, [enabled, find, body]);
    const matches = useMemo(() => (enabled && find.mode ? findMatches(text, find.query, find.matchCase) : []), [enabled, find.mode, find.query, find.matchCase, text]);
    const active = matches.length ? Math.min(current, matches.length - 1) : -1;
    useEffect(() => {
        if (find.mode) {
            reveal.current = true;
            setCurrent(0);
        }
    }, [find.mode, find.query, find.matchCase]);
    useLayoutEffect(() => {
        if (!reveal.current || active < 0 || !body.current)
            return;
        const mark = body.current.querySelector('mark[data-current="true"]');
        const rect = mark ? mark.getBoundingClientRect() : activeHighlightRect();
        if (!rect)
            return;
        reveal.current = false;
        revealRect(scrollParentOf(body.current), rect);
    }, [active, body, matches]);
    const step = (direction) => {
        if (!matches.length)
            return;
        reveal.current = true;
        setCurrent((active + direction + matches.length) % matches.length);
    };
    const bar = enabled && find.mode ? (_jsx(FindBar, { find: find, index: active, total: matches.length, onStep: step, onClose: () => find.close() })) : null;
    return {
        find,
        active,
        matches,
        setText,
        bar,
    };
}
