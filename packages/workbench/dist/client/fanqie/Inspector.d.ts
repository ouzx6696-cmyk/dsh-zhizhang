import React from "react";
import type { FanqieAction, FanqieDerived, FanqieState } from "./state.js";
export interface InspectorProps {
    state: FanqieState;
    view: FanqieDerived;
    dispatch: React.Dispatch<FanqieAction>;
    onRefresh: () => Promise<void>;
}
export declare function Inspector({ state, view, dispatch, onRefresh }: InspectorProps): React.JSX.Element;
//# sourceMappingURL=Inspector.d.ts.map