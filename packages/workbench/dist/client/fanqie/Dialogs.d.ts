import React from "react";
import type { FanqieAction, FanqieState } from "./state.js";
export interface DialogsProps {
    state: FanqieState;
    dispatch: React.Dispatch<FanqieAction>;
    onFinalize: (chapterId: string) => Promise<void>;
    onAcceptCandidate: (chapterId: string, candidateId: string, base: string) => Promise<void>;
}
export declare function Dialogs({ state, dispatch, onFinalize, onAcceptCandidate }: DialogsProps): React.JSX.Element | null;
//# sourceMappingURL=Dialogs.d.ts.map