export interface ContextBlock {
    id: string;
    layer: 0 | 1 | 2 | 3 | 4 | 5 | 6;
    text: string;
    required: boolean;
    tokens: number;
    reason: string;
    source: {
        kind: "outline" | "chapter" | "bible" | "plan" | "retrieval" | "reference";
        ref: string;
    };
}
export interface ContextPacket {
    prefix: ContextBlock[];
    suffix: ContextBlock[];
    omitted: {
        id: string;
        why: string;
    }[];
    estimate: number;
}
export declare function renderContextPacket(packet: ContextPacket): {
    system: string;
    user: string;
};
//# sourceMappingURL=context-packet.d.ts.map