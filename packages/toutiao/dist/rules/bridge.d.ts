export interface RulesLimits {
    rules_version: string;
    ok: boolean;
    title_max: number;
    pass_score: number;
    bands: Record<string, [number, number]>;
    genres: string[];
    lines: string[];
    drivers: string[];
    statuses: string[];
}
export interface StyleCatalog {
    byLine: Record<string, {
        openings: string[];
        endings: string[];
    }>;
    allOpenings: string[];
    allEndings: string[];
}
export interface QaCheckResult {
    ok: boolean;
    overall: number;
    passed: boolean;
    score?: number;
    pass?: boolean;
    warnings?: string[];
    fails: Array<{
        code: string;
        message: string;
        score?: number;
    }>;
    hard_gates: string[];
    verdict?: string;
    title?: string;
    title_len?: number;
    chars?: number;
}
export interface LedgerShowResult {
    ok: boolean;
    rules_version: string;
    rows: Array<Record<string, string>>;
    total: number;
    code?: string;
    message?: string;
}
export interface LedgerMutateResult {
    ok: boolean;
    rules_version: string;
    row?: Record<string, string>;
    existing?: boolean;
    kept?: number;
    snapshot_date?: string;
    code?: string;
    message?: string;
}
export declare function createRulesBridge(scriptsDir: string): {
    limits(): Promise<RulesLimits>;
    styles(): Promise<StyleCatalog>;
    checkCard(cardPath: string): Promise<{
        ok: boolean;
        errors: string[];
    }>;
    qa(args: {
        file: string;
        card?: string;
        ledger?: string;
        mode?: string;
        articleId?: string;
    }): Promise<QaCheckResult>;
    ledgerShow(args: {
        ledger: string;
        last?: number;
    }): Promise<LedgerShowResult>;
    ledgerAdd(args: {
        card: string;
        ledger: string;
        articleId?: string;
        status?: string;
        date?: string;
    }): Promise<LedgerMutateResult>;
    ledgerStatus(args: {
        title: string;
        to: string;
        ledger: string;
        articleId?: string;
    }): Promise<LedgerMutateResult>;
    metricsImport(args: {
        articleId: string;
        metricsJson: string;
        ledger: string;
        url?: string;
    }): Promise<LedgerMutateResult>;
};
//# sourceMappingURL=bridge.d.ts.map