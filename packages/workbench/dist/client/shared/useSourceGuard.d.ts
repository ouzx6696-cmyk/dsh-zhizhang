export interface EditorGuardSnapshot {
    dirty: boolean;
    saving: boolean;
    discard: () => void;
}
export type LeaveState = "clean" | "dirty" | "saving";
/** What leaving an editor takes: "saving" blocks it, "dirty" needs the author's word. */
export declare function leaveState(current: Pick<EditorGuardSnapshot, "dirty" | "saving"> | null | undefined): LeaveState;
/**
 * Saving blocks leaving; unsaved changes need the author's word through `ask`.
 */
export declare function canLeaveEdit(current: Pick<EditorGuardSnapshot, "dirty" | "saving"> | null | undefined, ask: (message: string) => Promise<boolean> | boolean, blocked?: () => void): Promise<boolean> | boolean;
export declare function useSourceGuard(onEditState?: (value: EditorGuardSnapshot | null) => void): {
    report: (value: EditorGuardSnapshot | null) => void;
    editorState: () => LeaveState;
    close: () => void;
    canLeave: () => Promise<boolean>;
    dirty: boolean;
    saving: boolean;
};
//# sourceMappingURL=useSourceGuard.d.ts.map