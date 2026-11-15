/** The scrolling box that actually moves for `element`: the reader body, or the host's column. */
export declare function scrollParentOf(element: HTMLElement | null): Element;
/** Scroll position as a share of the scrollable range, so it survives a change of layout. */
export declare function readScrollRatio(box: Element): number;
export declare function applyScrollRatio(box: Element, ratio: number): void;
/** Brings a rectangle inside `box` to about a third of the way down, where the eye expects it. */
export declare function revealRect(box: Element, rect: DOMRect): void;
export declare function useReadingPosition<T extends HTMLElement = HTMLElement>(content: string | null): {
    body: import("react").RefObject<T | null>;
    position: import("react").RefObject<number>;
    enter: () => void;
    leave: () => void;
};
//# sourceMappingURL=reading-position.d.ts.map