import type { TextHighlightRange, TextSurface } from "./TextSurface.js";
export interface CustomHighlightRegistry {
    get(name: string): unknown;
    set(name: string, highlight: unknown): void;
    delete(name: string): boolean;
}
type HighlightConstructor = new (...ranges: AbstractRange[]) => unknown;
export interface CustomHighlightApi {
    registry: CustomHighlightRegistry;
    HighlightCtor: HighlightConstructor;
}
export declare function getCustomHighlightApi(): CustomHighlightApi | null;
export declare function supportsCustomHighlight(): boolean;
export interface TextareaSurfaceOptions {
    backdrop?: HTMLElement | null;
    onHighlight?: (ranges: TextHighlightRange[]) => void;
}
/**
 * 基于原生 HTMLTextAreaElement 的 TextSurface 实现：
 * 将 `document.execCommand` 封装在单点以保留浏览器撤销栈，并支持 CSS Custom Highlight API 与 `<mark>` 回退高亮。
 */
export declare class TextareaSurface implements TextSurface {
    private readonly el;
    private backdrop;
    private readonly onHighlight?;
    private ranges;
    private activeDomRange;
    constructor(el: HTMLTextAreaElement, options?: TextareaSurfaceOptions);
    setBackdrop(backdrop: HTMLElement | null): void;
    syncScroll(): void;
    dispose(): void;
    value(): string;
    setValue(v: string, opts?: {
        keepUndo?: boolean;
    }): void;
    selection(): {
        from: number;
        to: number;
    };
    select(from: number, to: number): void;
    replaceRange(from: number, to: number, text: string): void;
    highlight(ranges: TextHighlightRange[]): void;
    scrollTo(pos: number): void;
    focus(): void;
    onChange(cb: (v: string) => void): () => void;
    /** 单点封装 execCommand，确保替换与整文改写均可纳入 Ctrl+Z 撤销栈，并恢复原焦点。 */
    private applyExecEdit;
    private renderBackdrop;
}
export {};
//# sourceMappingURL=TextareaSurface.d.ts.map