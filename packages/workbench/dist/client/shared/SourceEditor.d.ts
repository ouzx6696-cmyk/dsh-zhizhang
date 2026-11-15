/** Full-chapter source editor shared by the novel and Toutiao readers. */
import React from "react";
import { type EditorGuardSnapshot } from "./useSourceGuard.js";
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
export declare function SourceEditor({ initial, title, note, hint, draftKey, baseRevision, saveConfirm, position, onSave, onCancel, onStateChange, }: SourceEditorProps): React.JSX.Element;
//# sourceMappingURL=SourceEditor.d.ts.map