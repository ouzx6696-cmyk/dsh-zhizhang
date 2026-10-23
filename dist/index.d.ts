/**
 * dsh-zhizhang — DeepSeek Harness plugin entry (on-demand).
 *
 * The profile mount registers exactly one trigger tool (`zhizhang_enable`) plus the
 * read-only Web panel HTTP routes. The 47 织章 tools and the resident hard-rules
 * prompt section are mounted only after the trigger is called, on the calling
 * Agent scope when the host exposes one — standard sessions stay clean.
 */
import { formatToolError } from "./lib/errors.js";
import type { ExecContext } from "./lib/types.js";
import { applyTools } from "./lib/bootstrap.js";
import { SYSTEM_BRIEF, formatLint } from "./tools/index.js";
export declare const name = "zhizhang";
export declare const inject: string[];
export declare function apply(ctx: any, pluginConfig?: any): void;
export { applyTools, SYSTEM_BRIEF };
export declare const __testing: {
    tools: {
        name: any;
        description: any;
        parameters: {
            type: string;
            additionalProperties: boolean;
            properties: any;
            required: any;
        };
        output: {
            schema: {
                type: string;
            };
            render: (_args: any, value: string) => {
                type: string;
                text: string;
            }[];
        };
        execute(args: any, exec: ExecContext): Promise<any>;
    }[];
    applyTools: typeof applyTools;
    formatLint: typeof formatLint;
    SYSTEM_BRIEF: string;
    formatToolError: typeof formatToolError;
    METHOD_ASSET_IDS: any[];
    listMethodAssets: () => {
        id: string;
        title: string;
        whenToUse: string;
    }[];
    getMethodAssets: (ids: any) => {
        found: any[];
        missing: string[];
    };
    auditPayoff: (outline: any, body: string, opts: any) => {
        ok: boolean;
        warningCount: number;
        findings: ({
            code: string;
            severity: string;
            message: string;
            promise: any;
            evidence: string;
        } | {
            code: string;
            severity: string;
            message: string;
            promise: any;
            evidence?: undefined;
        } | {
            code: string;
            severity: string;
            message: string;
            promise: string;
            evidence: string | undefined;
        } | {
            code: string;
            severity: string;
            message: string;
            evidence: string | undefined;
            promise?: undefined;
        })[];
        checked: {
            endingTokens: unknown[];
            endingHits: unknown[];
            endingMisses: unknown[];
            speechPromise: boolean;
            breathReveal: boolean;
        };
    };
    formatPayoffAudit: (label: string, result: any) => string;
    ports: {
        AcceptPolicy: {
            evaluate(input: any): {
                hitCount: any;
                receiptLines: string[];
                ok: boolean;
                messages: any[];
            };
        };
        LintGate: {
            issueToken(dir: string, candidateId: string, hitCount: any): Promise<any>;
            hitCountOf(cand: any): any;
            evaluateAccept(opts: any): {
                ok: boolean;
                messages: any;
            };
            echoLines(hitCount: any): string[];
        };
        BriefGate: {
            evaluateAccept(opts: any): {
                ok: boolean;
                messages: any;
            };
        };
        MethodRegistry: {
            ids: any[];
            briefDefaultIds: string[];
            briefFullIds: string[];
            list(): {
                id: string;
                title: string;
                whenToUse: string;
            }[];
            get(id: string): any;
            getMany(ids: any): {
                found: any[];
                missing: string[];
            };
            formatForAgent(asset: any): string;
            resolveBriefAssets(extraIds?: any, mode?: any): {
                found: any[];
                missing: string[];
            };
            formatReaderContract(input: any): string;
        };
        SaveBypassGate: {
            evaluate(opts: any): {
                ok: boolean;
                messages: any;
            };
        };
        StyleLinterPort: {
            lint(text: string): {
                category: string;
                start: number;
                end: number;
                match: string;
                hint: string;
            }[];
            summarize(hits: any): {
                cliche_syntax: number;
                lazy_emotion: number;
                process_skip: number;
                slogan_ending: number;
            };
            format(label: string, hits: any, summary: any): string;
        };
        PayoffAuditorPort: {
            audit(outline: any, body: string, opts: any): {
                ok: boolean;
                warningCount: number;
                findings: ({
                    code: string;
                    severity: string;
                    message: string;
                    promise: any;
                    evidence: string;
                } | {
                    code: string;
                    severity: string;
                    message: string;
                    promise: any;
                    evidence?: undefined;
                } | {
                    code: string;
                    severity: string;
                    message: string;
                    promise: string;
                    evidence: string | undefined;
                } | {
                    code: string;
                    severity: string;
                    message: string;
                    evidence: string | undefined;
                    promise?: undefined;
                })[];
                checked: {
                    endingTokens: unknown[];
                    endingHits: unknown[];
                    endingMisses: unknown[];
                    speechPromise: boolean;
                    breathReveal: boolean;
                };
            };
            format(label: string, result: any): string;
        };
        HumanFeelAuditorPort: {
            audit(text: string, opts: any): {
                hitCount: number;
                hits: {
                    code: string;
                    text: string;
                    evidence: string;
                }[];
                summary: string;
            };
            format(label: string, result: any): string;
        };
        HumanFeelGate: {
            audit: typeof import("./lib/ports/human-feel-gate.js").auditHumanFeel;
            evaluateAccept(opts: any): {
                ok: boolean;
                messages: any;
            };
        };
        NovelSenseAuditorPort: {
            audit(text: string, opts: any): {
                hitCount: number;
                hits: {
                    code: string;
                    text: string;
                    evidence: string;
                }[];
                summary: string;
            };
            format(label: string, result: any): string;
        };
        NovelSenseGate: {
            audit: typeof import("./lib/ports/novel-sense-gate.js").auditNovelSense;
            evaluateAccept(opts: any): {
                ok: boolean;
                messages: any;
            };
        };
        LibraryPort: {
            id: string;
            status: string;
            title: string;
            summary: string;
            capabilities(): {
                id: string;
                title: string;
                ready: boolean;
            }[];
            ensureLibrary(paths: import("./lib/types.js").StoragePaths): Promise<import("./lib/types.js").StoragePaths>;
            importSource(paths: import("./lib/types.js").StoragePaths, input: any): Promise<{
                sourceId: string;
                charCount: any;
                encoding: string;
                converted: boolean;
                excerptPath: string;
                warning: string | undefined;
            }>;
            getSource(paths: import("./lib/types.js").StoragePaths, sourceId: any): Promise<{
                meta: any;
                text: string;
            }>;
            listSources(paths: import("./lib/types.js").StoragePaths): Promise<any>;
            dissectBrief(paths: import("./lib/types.js").StoragePaths, sourceId: any, opts?: any): Promise<string>;
            stageCard(paths: import("./lib/types.js").StoragePaths, input: any): Promise<{
                candId: string;
                title: string;
                warnings: string[];
            }>;
            acceptCard(paths: import("./lib/types.js").StoragePaths, candId: any): Promise<{
                cardId: string;
                title: any;
                warnings: string[];
                judgment: string[];
            }>;
            discardCard(paths: import("./lib/types.js").StoragePaths, cardId: any): Promise<{
                cardId: any;
                title: any;
                remaining: number;
            }>;
            listCards(paths: import("./lib/types.js").StoragePaths, opts?: any): Promise<any>;
            searchCards(paths: import("./lib/types.js").StoragePaths, query: any, opts?: any): Promise<any>;
            suggestCombo(paths: import("./lib/types.js").StoragePaths, input?: any): Promise<{
                ok: boolean;
                cardIds: never[];
                mind: null;
                crafts: never[];
                warnings: string[];
                emptyReason: string;
            } | {
                ok: boolean;
                cardIds: any[];
                mind: {
                    id: any;
                    title: any;
                    sourceId: any;
                    axis: string;
                    tags: any;
                };
                crafts: {
                    id: any;
                    title: any;
                    sourceId: any;
                    axis: string;
                    tags: any;
                }[];
                warnings: string[];
                emptyReason?: undefined;
            }>;
            auditCards(paths: import("./lib/types.js").StoragePaths, opts?: any): Promise<({
                id: any;
                title: any;
                axis: any;
                layer: any;
                dimension: any;
                evidenceQuotes: any;
                evidenceVerified: number;
                unverifiable: any;
                skippedShort: never[];
                bodyQuotes: number;
                bodyVerified: number;
                bodyUnverifiable: string[];
                bodySkipped: number;
                warnings: string[];
                chapterOk: boolean;
            } | {
                evidenceQuotes: number;
                evidenceVerified: number;
                skippedShort: string[];
                unverifiable: string[];
                located: any[];
                chapterOk: boolean | null;
                warnings: string[];
                id: any;
                title: any;
                axis: any;
                layer?: undefined;
                dimension?: undefined;
                bodyQuotes?: undefined;
                bodyVerified?: undefined;
                bodyUnverifiable?: undefined;
                bodySkipped?: undefined;
            })[]>;
            getCard(paths: import("./lib/types.js").StoragePaths, cardId: any): Promise<any>;
            getCandidate(paths: import("./lib/types.js").StoragePaths, candId: any): Promise<any>;
        };
        InspirationPort: {
            id: string;
            status: string;
            title: string;
            summary: string;
            capabilities(): {
                id: string;
                title: string;
                ready: boolean;
            }[];
            startSession(paths: import("./lib/types.js").StoragePaths, input: any): Promise<{
                sessionId: string;
                craftOnly: boolean;
                mindCount: number;
                craftCount: number;
            }>;
            getSession(paths: import("./lib/types.js").StoragePaths, sessionId: any): Promise<any>;
            listSessions(paths: import("./lib/types.js").StoragePaths): Promise<{
                id: any;
                goal: any;
                genre: any;
                cardIds: any;
                forgeAt: any;
                updatedAt: any;
            }[]>;
            forgeBrief(paths: import("./lib/types.js").StoragePaths, sessionId: any): Promise<string>;
            stageEmit(paths: import("./lib/types.js").StoragePaths, sessionId: any, input: any): Promise<{
                candId: string;
                kind: any;
                styleReminder: string;
            }>;
            acceptEmit(paths: import("./lib/types.js").StoragePaths, candId: any, opts: any): Promise<{
                candId: any;
                applied: boolean;
                workKey: string;
                detail: string;
            }>;
            resolveCardsForBrief(paths: import("./lib/types.js").StoragePaths, opts?: any): Promise<{
                cards: any[];
                source: string;
                note: string;
                cardIds: any[];
            }>;
            resolveCraftCue(paths: import("./lib/types.js").StoragePaths, opts?: any): Promise<string>;
            formatCardsSection(cards: any, meta: any): string;
        };
        ProductMap: {
            id: string;
            version: string;
            setToolCount(n: number): number;
            toolCount(): number;
            loopLine(): string;
            pillars(): {
                id: string;
                title: string;
                status: string;
                summary: string;
                capabilities: {
                    id: string;
                    title: string;
                    ready: boolean;
                }[];
                loopStage: number;
                handsOffTo: string;
            }[];
            methods(): {
                registry: string;
                count: number;
                briefDefaultIds: string[];
                note: string;
            };
            formatForAgent(): string;
        };
        Scheduler: {
            id: string;
            version: string;
            defaultLine(): string;
            writeLine(): string;
            libraryLine(): string;
            inspireLine(): string;
            bypasses(): {
                id: string;
                title: string;
                when: string;
                via: string;
            }[];
            nextHint(after: string): string;
            panelRouteHints(): string[];
            formatDiagram(): string;
            formatForAgent(): string;
        };
        MultiDraftPort: {
            id: string;
            version: string;
            disabledCode: string;
            isEnabled: typeof import("./lib/ports/multi-draft.js").isMultiDraftEnabled;
            enableHint(): string;
            requireEnabled(): void;
            parentView(cand: any): {
                id: any;
                draftLabel: any;
                wordCount: number;
                note: any;
                preview: string;
            };
            formatUnifyBrief(input: any): string;
            afterUnifyStageLines(opts: any): string[];
        };
    };
};
