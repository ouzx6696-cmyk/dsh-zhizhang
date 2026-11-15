export interface TextHighlightRange {
  from: number;
  to: number;
  kind: "find" | "find-active" | "issue";
}

export interface TextSurface {
  value(): string;
  setValue(v: string, opts?: { keepUndo?: boolean }): void;
  selection(): { from: number; to: number };
  select(from: number, to: number): void;
  replaceRange(from: number, to: number, text: string): void;
  highlight(ranges: TextHighlightRange[]): void;
  scrollTo(pos: number): void;
  focus(): void;
  onChange(cb: (v: string) => void): () => void;
}
