/**
 * 取当前章的前一章（按章序）。
 * - idx>0 → 前一章；
 * - idx===0 或 章未登记（idx<0）→ null。
 *   此前「未登记」会回退到最后一章：给未创建的章注入错误的 prev，
 *   续写合同与同构对照都会被带偏。未登记的章应先 outline_set/chapter_save 进 meta。
 * 返回 { meta, body, outline } 或 null。
 */
export declare function resolvePrevChapter(dir: string, chapterId: string): Promise<{
    meta: any;
    body: any;
    outline: any;
    revision: any;
    missing: boolean;
} | null>;
export declare function resolvePrevBody(dir: string, chapterId: string): Promise<any>;
