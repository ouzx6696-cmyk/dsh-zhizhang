import React from "react";
import type { ChapterRowView } from "@zhizhang/fanqie/view";
export interface ChapterListProps {
    chapters: readonly ChapterRowView[];
    selectedId: string;
    onSelect: (id: string) => void;
}
export declare function ChapterList({ chapters, selectedId, onSelect }: ChapterListProps): React.JSX.Element;
//# sourceMappingURL=ChapterList.d.ts.map