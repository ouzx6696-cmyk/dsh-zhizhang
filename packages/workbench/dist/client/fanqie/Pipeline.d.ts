import React from "react";
import type { FanqieAction, FanqieDerived, FanqieState } from "./state.js";
export interface PipelineProps {
    state: FanqieState;
    view: FanqieDerived;
    dispatch: React.Dispatch<FanqieAction>;
}
export declare function Pipeline({ state, view, dispatch }: PipelineProps): React.JSX.Element;
//# sourceMappingURL=Pipeline.d.ts.map