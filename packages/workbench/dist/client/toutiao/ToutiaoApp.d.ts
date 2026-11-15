import React from "react";
import type { ArticleRowView } from "@zhizhang/toutiao/view";
import type { ToutiaoAction, ToutiaoState } from "./state.js";
export interface ToutiaoAppProps {
    state: ToutiaoState;
    rows: readonly ArticleRowView[];
    selected: ArticleRowView | null;
    dispatch: React.Dispatch<ToutiaoAction>;
}
export declare function ToutiaoApp({ state, rows, selected, dispatch }: ToutiaoAppProps): React.JSX.Element;
//# sourceMappingURL=ToutiaoApp.d.ts.map