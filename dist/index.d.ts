/**
 * dsh-zhizhang — DeepSeek Harness plugin entry (on-demand).
 *
 * The profile mount registers exactly one trigger tool (`zhizhang_enable`) plus the
 * read-only Web panel HTTP routes. The 47 织章 tools and the resident hard-rules
 * prompt section are mounted only after the trigger is called, on the calling
 * Agent scope when the host exposes one — standard sessions stay clean.
 */
import { formatToolError } from "./lib/errors.js";
import { applyTools } from "./lib/bootstrap.js";
import { SYSTEM_BRIEF, formatLint, type PluginConfig, type ToolDef } from "./tools/index.js";
export declare const name = "zhizhang";
export declare const inject: string[];
export declare function apply(ctx: {
    tools: {
        register: (tool: ToolDef) => void;
    };
    get?: (name: string) => unknown;
    inject?: (deps: string[], fn: (wctx: never) => void) => void;
    effect?: (fn: () => unknown, name?: string) => void;
}, pluginConfig?: PluginConfig): void;
export { applyTools, SYSTEM_BRIEF };
export declare const __testing: {
    tools: ToolDef[];
    applyTools: typeof applyTools;
    formatLint: typeof formatLint;
    SYSTEM_BRIEF: string;
    formatToolError: typeof formatToolError;
    METHOD_ASSET_IDS: readonly string[];
    listMethodAssets: () => Pick<import("./lib/method-assets.js").MethodAsset, "id" | "title" | "whenToUse">[];
    getMethodAssets: (ids: string[]) => {
        found: import("./lib/method-assets.js").MethodAsset[];
        missing: string[];
    };
    auditPayoff: (outline: import("./lib/types.js").Outline, body: string, opts?: {
        premise?: string;
        title?: string;
    }) => import("./lib/payoff-audit.js").PayoffAuditResult;
    formatPayoffAudit: (label: string, result: import("./lib/payoff-audit.js").PayoffAuditResult) => string;
    ports: {
        AcceptPolicy: {
            evaluate(input: import("./lib/ports/accept-policy.js").AcceptPolicyInput): import("./lib/ports/accept-policy.js").AcceptGateResult;
        };
        LintGate: {
            issueToken(dir: string, candidateId: string, hitCount: number): Promise<{
                token: string;
                lintedAt: string;
                hitCount: number;
                chapterId: string;
            }>;
            hitCountOf(cand: import("./lib/types.js").CandidateFile): number;
            evaluateAccept(opts: {
                hitCount: number;
                strictLint: boolean;
            }): import("./lib/ports/types.js").GateDecision;
            echoLines(hitCount: number): string[];
        };
        BriefGate: {
            evaluateAccept(opts: {
                brief: import("./lib/types.js").BriefBreadcrumb | null | undefined;
                skipBrief: boolean;
                recentMs?: number;
            }): import("./lib/ports/types.js").GateDecision;
        };
        MethodRegistry: {
            ids: readonly string[];
            briefDefaultIds: readonly string[];
            briefFullIds: readonly string[];
            list(): Pick<import("./lib/method-assets.js").MethodAsset, "id" | "title" | "whenToUse">[];
            get(id: string): import("./lib/method-assets.js").MethodAsset | undefined;
            getMany(ids: string[]): {
                found: import("./lib/method-assets.js").MethodAsset[];
                missing: string[];
            };
            formatForAgent(asset: import("./lib/method-assets.js").MethodAsset): string;
            resolveBriefAssets(extraIds?: string[], mode?: "lean" | "full"): {
                found: import("./lib/method-assets.js").MethodAsset[];
                missing: string[];
            };
            formatReaderContract(input: import("./lib/method-assets.js").ReaderContractInput): string;
        };
        SaveBypassGate: {
            evaluate(opts: {
                contentProvided: boolean;
                wordCount: number;
                confirmBypass: boolean;
                threshold?: number;
            }): import("./lib/ports/types.js").GateDecision;
        };
        StyleLinterPort: {
            lint(text: string): import("./lib/style-linter.js").StyleLintHit[];
            summarize(hits: import("./lib/style-linter.js").StyleLintHit[]): Record<import("./lib/style-linter.js").StyleLintCategory, number>;
            format(label: string, hits: import("./lib/style-linter.js").StyleLintHit[], summary: ReturnType<typeof import("./lib/style-linter.js").summarizeStyleLint>): string;
        };
        PayoffAuditorPort: {
            audit(outline: import("./lib/types.js").Outline, body: string, opts?: {
                premise?: string;
                title?: string;
            }): import("./lib/payoff-audit.js").PayoffAuditResult;
            format(label: string, result: import("./lib/payoff-audit.js").PayoffAuditResult): string;
        };
        HumanFeelAuditorPort: {
            audit(text: string, opts?: {
                craftCue?: string | null;
            }): import("./lib/ports/human-feel-gate.js").HumanFeelAuditResult;
            format(label: string, result: import("./lib/ports/human-feel-gate.js").HumanFeelAuditResult): string;
        };
        HumanFeelGate: {
            audit: typeof import("./lib/ports/human-feel-gate.js").auditHumanFeel;
            evaluateAccept(opts: {
                body: string;
                strictHuman: boolean;
                craftCue?: string | null;
            }): import("./lib/ports/types.js").GateDecision;
        };
        NovelSenseAuditorPort: {
            audit(text: string, opts?: {
                prevBody?: string | null;
            }): import("./lib/ports/novel-sense-gate.js").NovelSenseAuditResult;
            format(label: string, result: import("./lib/ports/novel-sense-gate.js").NovelSenseAuditResult): string;
        };
        NovelSenseGate: {
            audit: typeof import("./lib/ports/novel-sense-gate.js").auditNovelSense;
            evaluateAccept(opts: {
                body: string;
                prevBody?: string | null;
                strictNovel: boolean;
            }): import("./lib/ports/types.js").GateDecision;
        };
        LibraryPort: {
            id: "port.library";
            status: import("./lib/ports/library.js").PillarStatus;
            title: string;
            summary: string;
            capabilities(): import("./lib/ports/library.js").LibraryCapability[];
            ensureLibrary(paths: import("./lib/store.js").StoragePaths): Promise<import("./lib/store.js").StoragePaths>;
            importSource(paths: import("./lib/store.js").StoragePaths, input: {
                title: string;
                author?: string;
                text?: string;
                file?: string;
                readingRange?: string;
                exec?: unknown;
            }): Promise<{
                sourceId: string;
                charCount: number;
                excerptPath: string;
                encoding?: string;
                converted?: boolean;
                warning?: string;
            }>;
            getSource(paths: import("./lib/store.js").StoragePaths, sourceId: string): Promise<{
                meta: import("./lib/ports/library.js").LibrarySourceMeta;
                text: string;
            }>;
            listSources(paths: import("./lib/store.js").StoragePaths): Promise<import("./lib/ports/library.js").LibraryIndex["sources"]>;
            dissectBrief(paths: import("./lib/store.js").StoragePaths, sourceId: string, opts?: {
                maxChars?: number;
                includeRecommend?: boolean;
            }): Promise<string>;
            stageCard(paths: import("./lib/store.js").StoragePaths, input: import("./lib/ports/library.js").StageCardInput): Promise<import("./lib/ports/library.js").StageCardResult>;
            acceptCard(paths: import("./lib/store.js").StoragePaths, candId: string): Promise<{
                cardId: string;
                title: string;
                warnings?: string[];
                judgment?: string[];
            }>;
            listCards(paths: import("./lib/store.js").StoragePaths, opts?: import("./lib/ports/library.js").CardQueryOpts): Promise<import("./lib/ports/library.js").CardRow[]>;
            searchCards(paths: import("./lib/store.js").StoragePaths, query: string, opts?: import("./lib/ports/library.js").CardQueryOpts): Promise<import("./lib/ports/library.js").CardRow[]>;
            suggestCombo(paths: import("./lib/store.js").StoragePaths, input?: import("./lib/ports/library.js").ComboSuggestInput): Promise<import("./lib/ports/library.js").ComboSuggestResult>;
            auditCards(paths: import("./lib/store.js").StoragePaths, opts?: {
                cardId?: string;
                sourceId?: string;
                axis?: import("./lib/ports/library.js").CardAxis;
                status?: "accepted" | "drafted" | "all";
            }): Promise<import("./lib/ports/library.js").CardAuditRow[]>;
            getCard(paths: import("./lib/store.js").StoragePaths, cardId: string): Promise<import("./lib/ports/library.js").TechniqueCard>;
            getCandidate(paths: import("./lib/store.js").StoragePaths, candId: string): Promise<import("./lib/ports/library.js").TechniqueCard>;
        };
        InspirationPort: {
            id: "port.inspiration";
            status: import("./lib/ports/library.js").PillarStatus;
            title: string;
            summary: string;
            capabilities(): import("./lib/ports/inspiration.js").InspirationCapability[];
            startSession(paths: import("./lib/store.js").StoragePaths, input: {
                goal: string;
                genre?: string;
                cardIds: string[];
                craftOnly?: boolean;
            }): Promise<{
                sessionId: string;
                craftOnly: boolean;
                mindCount: number;
                craftCount: number;
            }>;
            getSession(paths: import("./lib/store.js").StoragePaths, sessionId: string): Promise<import("./lib/ports/inspiration.js").InspirationSession>;
            listSessions(paths: import("./lib/store.js").StoragePaths): Promise<Array<Pick<import("./lib/ports/inspiration.js").InspirationSession, "id" | "goal" | "genre" | "cardIds" | "forgeAt" | "updatedAt">>>;
            forgeBrief(paths: import("./lib/store.js").StoragePaths, sessionId: string): Promise<string>;
            stageEmit(paths: import("./lib/store.js").StoragePaths, sessionId: string, input: {
                kind: import("./lib/ports/inspiration.js").InspireEmitKind;
                payload: Record<string, unknown>;
            }): Promise<{
                candId: string;
                kind: import("./lib/ports/inspiration.js").InspireEmitKind;
                styleReminder: string;
            }>;
            acceptEmit(paths: import("./lib/store.js").StoragePaths, candId: string, opts: {
                workKey: string;
                apply?: boolean;
                title?: string;
                genre?: string;
                premise?: string;
            }): Promise<{
                candId: string;
                applied: boolean;
                workKey: string;
                detail: string;
            }>;
            resolveCardsForBrief(paths: import("./lib/store.js").StoragePaths, opts?: {
                cardIds?: string[];
                workKey?: string;
                genre?: string;
                limit?: number;
            }): Promise<{
                cards: import("./lib/ports/library.js").TechniqueCard[];
                source: "explicit" | "inspire_apply" | "genre_tags" | "none";
                note: string;
                cardIds: string[];
            }>;
            resolveCraftCue(paths: import("./lib/store.js").StoragePaths, opts?: {
                workKey?: string;
                cardIds?: string[];
                genre?: string;
                limit?: number;
            }): Promise<string>;
            formatCardsSection(cards: import("./lib/ports/library.js").TechniqueCard[], meta: {
                source: string;
                note: string;
                lean?: boolean;
            }): string;
        };
        ProductMap: {
            id: "port.product";
            version: string;
            loopLine(): string;
            pillars(): import("./lib/ports/product.js").ProductPillarView[];
            methods(): {
                registry: string;
                count: number;
                briefDefaultIds: string[];
                note: string;
            };
            formatForAgent(): string;
        };
        Scheduler: {
            id: "port.scheduler";
            version: string;
            defaultLine(): string;
            writeLine(): string;
            libraryLine(): string;
            inspireLine(): string;
            bypasses(): readonly import("./lib/ports/scheduler.js").BypassRoute[];
            nextHint(after: string | string): string;
            panelRouteHints(): string[];
            formatDiagram(): string;
            formatForAgent(): string;
        };
        MultiDraftPort: {
            id: "port.multi_draft";
            version: string;
            disabledCode: string;
            isEnabled: typeof import("./lib/ports/multi-draft.js").isMultiDraftEnabled;
            enableHint(): string;
            requireEnabled(): void;
            parentView(cand: Pick<import("./lib/types.js").CandidateFile, "id" | "body" | "draftLabel" | "note">): import("./lib/ports/multi-draft.js").UnifyParentView;
            formatUnifyBrief(input: import("./lib/ports/multi-draft.js").UnifyBriefInput): string;
            afterUnifyStageLines(opts: {
                unifyCandId: string;
                parentIds: string[];
                chapterId: string;
                wordCount: number;
            }): string[];
        };
    };
};
