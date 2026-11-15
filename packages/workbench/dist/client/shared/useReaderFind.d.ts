import React from "react";
export declare function useReaderFind(body: React.RefObject<HTMLElement | null>, enabled: boolean): {
    find: import("./FindBar.js").FindController;
    active: number;
    matches: import("../../editor/find.js").TextMatchRange[];
    setText: React.Dispatch<React.SetStateAction<string>>;
    bar: React.JSX.Element | null;
};
//# sourceMappingURL=useReaderFind.d.ts.map