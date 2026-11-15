import type { ArticleStatus } from "../domain/status.js";
export interface ArticleRowView {
    id: string;
    title: string;
    genre: string;
    driver: string;
    status: ArticleStatus;
    qaScore?: number;
    updatedAt: string;
}
//# sourceMappingURL=rows.d.ts.map