export interface ManuscriptAnnotation {
    from: number;
    to: number;
    kind: "continuity" | "reader" | "fact";
    message: string;
}
export declare function sortAnnotations(items: ManuscriptAnnotation[]): ManuscriptAnnotation[];
//# sourceMappingURL=index.d.ts.map