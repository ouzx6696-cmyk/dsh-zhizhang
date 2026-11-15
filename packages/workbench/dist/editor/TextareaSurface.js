const EDITOR_HIGHLIGHT_KEYS = [
    "wb-editor-find",
    "wb-editor-find-active",
    "wb-editor-issue",
];
function isCustomHighlightRegistry(value) {
    if (!value || typeof value !== "object")
        return false;
    return ("get" in value &&
        typeof value.get === "function" &&
        "set" in value &&
        typeof value.set === "function" &&
        "delete" in value &&
        typeof value.delete === "function");
}
function isHighlightConstructor(value) {
    return typeof value === "function";
}
export function getCustomHighlightApi() {
    if (typeof globalThis === "undefined" || typeof document === "undefined")
        return null;
    if (typeof document.createRange !== "function")
        return null;
    const cssObj = Reflect.get(globalThis, "CSS");
    const registry = cssObj && typeof cssObj === "object" ? Reflect.get(cssObj, "highlights") : undefined;
    const HighlightCtor = Reflect.get(globalThis, "Highlight");
    if (!isCustomHighlightRegistry(registry) || !isHighlightConstructor(HighlightCtor))
        return null;
    return { registry, HighlightCtor };
}
export function supportsCustomHighlight() {
    return getCustomHighlightApi() !== null;
}
/**
 * 基于原生 HTMLTextAreaElement 的 TextSurface 实现：
 * 将 `document.execCommand` 封装在单点以保留浏览器撤销栈，并支持 CSS Custom Highlight API 与 `<mark>` 回退高亮。
 */
export class TextareaSurface {
    el;
    backdrop;
    onHighlight;
    ranges = [];
    activeDomRange = null;
    constructor(el, options = {}) {
        this.el = el;
        this.backdrop = options.backdrop ?? null;
        this.onHighlight = options.onHighlight;
    }
    setBackdrop(backdrop) {
        this.backdrop = backdrop;
        if (this.backdrop) {
            this.renderBackdrop();
            this.syncScroll();
        }
    }
    syncScroll() {
        if (this.backdrop) {
            this.backdrop.scrollTop = this.el.scrollTop;
            this.backdrop.scrollLeft = this.el.scrollLeft;
        }
    }
    dispose() {
        this.activeDomRange = null;
        const api = getCustomHighlightApi();
        if (api) {
            for (const key of EDITOR_HIGHLIGHT_KEYS)
                api.registry.delete(key);
        }
    }
    value() {
        return this.el.value;
    }
    setValue(v, opts) {
        if (opts?.keepUndo) {
            this.applyExecEdit(0, this.el.value.length, v);
            return;
        }
        this.el.value = v;
        this.el.dispatchEvent(new Event("input", { bubbles: true }));
        this.renderBackdrop();
    }
    selection() {
        return {
            from: this.el.selectionStart ?? 0,
            to: this.el.selectionEnd ?? 0,
        };
    }
    select(from, to) {
        this.el.setSelectionRange(from, to);
    }
    replaceRange(from, to, text) {
        this.applyExecEdit(from, to, text);
    }
    highlight(ranges) {
        this.ranges = [...ranges];
        this.onHighlight?.(this.ranges);
        this.renderBackdrop();
        this.syncScroll();
    }
    scrollTo(pos) {
        if (this.activeDomRange && this.backdrop) {
            const rangeRect = this.activeDomRange.getBoundingClientRect();
            const hostRect = this.backdrop.getBoundingClientRect();
            if (rangeRect.height > 0 && hostRect.height > 0) {
                const top = rangeRect.top - hostRect.top + this.el.scrollTop;
                const height = rangeRect.height;
                if (top < this.el.scrollTop ||
                    top + height > this.el.scrollTop + this.el.clientHeight) {
                    this.el.scrollTop = Math.max(0, top - this.el.clientHeight / 3);
                }
                this.syncScroll();
                return;
            }
        }
        const activeMark = this.backdrop?.querySelector('mark[data-current="true"]');
        if (activeMark) {
            const top = activeMark.offsetTop;
            const height = activeMark.offsetHeight;
            if (top < this.el.scrollTop ||
                top + height > this.el.scrollTop + this.el.clientHeight) {
                this.el.scrollTop = Math.max(0, top - this.el.clientHeight / 3);
            }
            this.syncScroll();
            return;
        }
        const len = this.el.value.length;
        if (len <= 0) {
            this.el.scrollTop = 0;
            this.syncScroll();
            return;
        }
        const clamped = Math.max(0, Math.min(pos, len));
        const ratio = clamped / len;
        const maxScroll = Math.max(0, this.el.scrollHeight - this.el.clientHeight);
        this.el.scrollTop = Math.round(maxScroll * ratio);
        this.syncScroll();
    }
    focus() {
        this.el.focus();
    }
    onChange(cb) {
        const handler = () => cb(this.el.value);
        this.el.addEventListener("input", handler);
        return () => this.el.removeEventListener("input", handler);
    }
    /** 单点封装 execCommand，确保替换与整文改写均可纳入 Ctrl+Z 撤销栈，并恢复原焦点。 */
    applyExecEdit(from, to, text) {
        const prevActive = typeof document !== "undefined" ? document.activeElement : null;
        this.el.focus();
        this.el.setSelectionRange(from, to);
        const execSupported = typeof document !== "undefined" && typeof document.execCommand === "function";
        const applied = execSupported
            ? text
                ? document.execCommand("insertText", false, text)
                : document.execCommand("delete")
            : false;
        if (!applied) {
            this.el.setRangeText(text, from, to, "end");
            this.el.dispatchEvent(new Event("input", { bubbles: true }));
        }
        if (prevActive instanceof HTMLElement && prevActive !== this.el) {
            prevActive.focus();
        }
        this.renderBackdrop();
    }
    renderBackdrop() {
        const host = this.backdrop;
        if (!host || typeof document === "undefined")
            return;
        const text = this.el.value;
        const sorted = [...this.ranges]
            .filter((r) => r.to > r.from && r.from >= 0 && r.to <= text.length)
            .sort((a, b) => a.from - b.from || a.to - b.to);
        const api = getCustomHighlightApi();
        if (api) {
            const mirrored = `${text} `;
            if (host.childNodes.length !== 1 || host.textContent !== mirrored) {
                host.textContent = mirrored;
            }
            for (const key of EDITOR_HIGHLIGHT_KEYS)
                api.registry.delete(key);
            this.activeDomRange = null;
            const textNode = host.firstChild;
            if (textNode && textNode.nodeType === Node.TEXT_NODE && sorted.length > 0) {
                const findRanges = [];
                const activeRanges = [];
                const issueRanges = [];
                for (const item of sorted) {
                    const domRange = document.createRange();
                    domRange.setStart(textNode, item.from);
                    domRange.setEnd(textNode, item.to);
                    if (item.kind === "find-active") {
                        activeRanges.push(domRange);
                        if (!this.activeDomRange)
                            this.activeDomRange = domRange;
                    }
                    else if (item.kind === "issue") {
                        issueRanges.push(domRange);
                    }
                    else {
                        findRanges.push(domRange);
                    }
                }
                if (findRanges.length) {
                    api.registry.set("wb-editor-find", new api.HighlightCtor(...findRanges));
                }
                if (activeRanges.length) {
                    api.registry.set("wb-editor-find-active", new api.HighlightCtor(...activeRanges));
                }
                if (issueRanges.length) {
                    api.registry.set("wb-editor-issue", new api.HighlightCtor(...issueRanges));
                }
            }
            return;
        }
        this.activeDomRange = null;
        const frag = document.createDocumentFragment();
        let cursor = 0;
        for (const range of sorted) {
            if (range.from < cursor)
                continue;
            if (range.from > cursor) {
                frag.appendChild(document.createTextNode(text.slice(cursor, range.from)));
            }
            const mark = document.createElement("mark");
            mark.dataset.kind = range.kind;
            if (range.kind === "find-active") {
                mark.dataset.current = "true";
            }
            mark.textContent = text.slice(range.from, range.to);
            frag.appendChild(mark);
            cursor = range.to;
        }
        frag.appendChild(document.createTextNode(`${text.slice(cursor)} `));
        host.replaceChildren(frag);
    }
}
