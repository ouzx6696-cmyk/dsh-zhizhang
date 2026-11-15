import React from "react";
import type { EditorGuardSnapshot } from "../shared/useSourceGuard.js";
import type { FanqieAction, FanqieDerived, FanqieState } from "./state.js";
export interface ReaderProps {
    state: FanqieState;
    view: FanqieDerived;
    dispatch: React.Dispatch<FanqieAction>;
    onSaveChapter: (body: string, base: string) => Promise<void>;
    onEditState?: (snapshot: EditorGuardSnapshot | null) => void;
}
export declare function Reader({ state, view, dispatch, onSaveChapter, onEditState }: ReaderProps): React.JSX.Element;
//# sourceMappingURL=Reader.d.ts.map