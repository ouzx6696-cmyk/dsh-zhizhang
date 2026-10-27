export declare function readLedger(dir: string): Promise<any>;
/** ledger.json 保留的最大条数：面板/回溯只用最近若干条，超出即裁掉最旧的，防止整文件随章节数无限膨胀。 */
export declare const LEDGER_MAX_ENTRIES = 1000;
export declare function appendLedger(dir: string, entry: any): Promise<{
    id: any;
    at: any;
    chapterId: any;
    kind: any;
    summary: any;
    dims: any;
    issues: any;
    styleHitCount: any;
}>;
