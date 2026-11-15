import React from "react";
import type { ArticleRowView } from "@zhizhang/toutiao/view";
import type { ToutiaoState } from "./state.js";
export interface ToutiaoSideProps {
    state: ToutiaoState;
    selected: ArticleRowView | null;
    onRefresh: () => Promise<void>;
    onDeliver: (articleDir: string, title: string, body: string) => Promise<unknown>;
}
export declare function ToutiaoSide({ state, selected, onRefresh, onDeliver }: ToutiaoSideProps): React.JSX.Element;
//# sourceMappingURL=ToutiaoSide.d.ts.map