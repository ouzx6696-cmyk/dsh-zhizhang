/** Canonical one-liner — identical to Scheduler.defaultLine(). */
export declare const CREATIVE_LOOP_LINE = "\u6309\u6700\u7EC8\u4EA7\u7269\u8FDB\u5165\uFF1A\u7247\u6BB5\u5206\u6790\uFF08\u53EF\u4E0D\u5165\u5E93\uFF09\uFF5C\u89C4\u5212\uFF08\u53C2\u8003\u53EF\u9009\uFF09\uFF5C\u6B63\u6587\u5199\u4F5C\u6216\u4FEE\u8BA2\uFF1B\u5DF2\u6709\u4F9D\u636E\u76F4\u63A5\u590D\u7528\uFF0C\u4E0D\u81EA\u52A8\u8DE8\u9636\u6BB5";
export declare const ProductMap: {
    id: string;
    version: string;
    /** 运行时由 index.js 注入真实工具数；文档/面板不再硬编码 47/51/52。 */
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
