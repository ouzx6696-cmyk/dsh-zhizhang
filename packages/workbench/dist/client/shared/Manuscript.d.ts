import React from "react";
export interface ManuscriptProps {
    text?: string | null;
    emptyText?: string;
    query?: string;
    matchCase?: boolean;
    activeMatch?: number;
}
declare function ManuscriptView({ text, emptyText, query, matchCase, activeMatch, }: ManuscriptProps): React.JSX.Element;
export declare const Manuscript: React.MemoExoticComponent<typeof ManuscriptView>;
export {};
//# sourceMappingURL=Manuscript.d.ts.map