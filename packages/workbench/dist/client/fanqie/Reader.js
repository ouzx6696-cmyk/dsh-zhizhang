import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useEffect } from "react";
import { Button } from "@zhizhang/ui/primitives";
import { chapterDraftKey } from "../../editor/drafts.js";
import { Callout, Empty, Icon, Skeleton, StatusTag } from "../shared/components.js";
import { Manuscript } from "../shared/Manuscript.js";
import { useReadingPosition } from "../shared/reading-position.js";
import { SourceEditor } from "../shared/SourceEditor.js";
import { useReaderFind } from "../shared/useReaderFind.js";
export function Reader({ state, view, dispatch, onSaveChapter, onEditState }) {
    const readyText = state.chapter.status === "ready" && !state.edit ? state.chapter.body : null;
    const reading = useReadingPosition(readyText);
    const find = useReaderFind(reading.body, !state.edit && state.chapter.status === "ready");
    useEffect(() => {
        find.setText(state.chapter.body);
    }, [state.chapter.body, find]);
    if (!view.current) {
        return _jsx(Empty, { title: "\u8BF7\u9009\u62E9\u7AE0\u8282", hint: "\u4ECE\u5DE6\u4FA7\u7AE0\u8282\u5217\u8868\u4E2D\u9009\u62E9\u4E00\u7AE0\u8FDB\u884C\u9605\u8BFB\u6216\u7F16\u8F91", icon: "book" });
    }
    if (state.edit && state.chapter.status === "ready") {
        return (_jsx(SourceEditor, { initial: state.chapter.body, title: state.chapter.title || view.current.title, draftKey: chapterDraftKey({
                work: state.work,
                chapter: view.current.id,
                slot: "official",
            }), baseRevision: state.chapter.revision || view.current.revision, position: reading.position, onSave: onSaveChapter, onCancel: () => {
                reading.leave();
                dispatch({ type: "edit", value: false });
            }, onStateChange: onEditState }));
    }
    const readerStyle = { "--zz-font-step": String(state.fontStep) };
    return (_jsxs("div", { className: "wb-reader", style: readerStyle, children: [_jsxs("header", { className: "wb-reader-head", children: [_jsxs("div", { className: "wb-reader-title-group", children: [_jsx("h2", { children: state.chapter.title || view.current.title }), _jsx(StatusTag, { status: view.current.status, mode: "fanqie" })] }), _jsx("div", { className: "wb-reader-actions", children: _jsxs(Button, { variant: "secondary", disabled: state.chapter.status !== "ready", onClick: () => {
                                reading.enter();
                                dispatch({ type: "edit", value: true });
                            }, children: [_jsx(Icon, { name: "pen", size: 14 }), "\u7F16\u8F91\u6B63\u6587"] }) })] }), find.bar, state.chapter.status === "error" ? (_jsx(Callout, { tone: "danger", role: "alert", children: state.chapter.error || "章节加载失败" })) : null, _jsx("div", { className: "wb-reader-body", ref: reading.body, children: state.chapter.status === "loading" ? (_jsx(Skeleton, { lines: 8 })) : (_jsx(Manuscript, { text: state.chapter.body, query: find.find.mode ? find.find.query : "", matchCase: find.find.matchCase, activeMatch: find.active })) })] }));
}
