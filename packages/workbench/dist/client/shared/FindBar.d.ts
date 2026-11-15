import React from "react";
export type FindMode = "" | "find" | "replace";
export interface FindController {
    mode: FindMode;
    query: string;
    replacement: string;
    matchCase: boolean;
    open: (mode?: Exclude<FindMode, "">, seed?: string) => void;
    close: () => void;
    setQuery: (value: string) => void;
    setReplacement: (value: string) => void;
    toggleMatchCase: () => void;
    focusTick: number;
}
export declare function useFind(): FindController;
export declare function isShortcut(event: KeyboardEvent, key: string): boolean;
export declare function typingElsewhere(event: KeyboardEvent, root: HTMLElement | null): boolean;
export interface FindBarProps {
    find: FindController;
    label?: string;
    index: number;
    total: number;
    status?: string;
    onStep: (direction: 1 | -1) => void;
    onReplace?: () => void;
    onReplaceAll?: () => void;
    onClose: () => void;
    canReplace?: boolean;
}
export declare function FindBar({ find, label, index, total, status, onStep, onReplace, onReplaceAll, onClose, canReplace, }: FindBarProps): React.JSX.Element;
//# sourceMappingURL=FindBar.d.ts.map