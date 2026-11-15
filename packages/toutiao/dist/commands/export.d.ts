import { type Infer } from "@zhizhang/core/schema";
export declare const ExportArticleReq: import("@zhizhang/core/schema").Parser<{
    articleDir: string;
    outPath: string;
    format: "md" | "txt" | undefined;
    includeDelivery: boolean | undefined;
}>;
export type ExportArticleInput = Infer<typeof ExportArticleReq>;
export declare function exportArticleCommand(rawInput: unknown): Promise<{
    outPath: string;
    articleId: string;
    chars: number;
}>;
//# sourceMappingURL=export.d.ts.map