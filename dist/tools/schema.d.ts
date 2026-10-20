/** JSON-schema helpers for zhizhang tool parameters (Chinese descriptions). */
export declare function S(description: string): {
    type: "string";
    description: string;
};
export declare function B(description: string): {
    type: "boolean";
    description: string;
};
export declare function I(description: string): {
    type: "integer";
    description: string;
};
export declare function E(values: string[], description: string): {
    type: "string";
    enum: string[];
    description: string;
};
export declare function O(properties: Record<string, unknown>, required?: string[]): {
    type: "object";
    additionalProperties: boolean;
    properties: Record<string, unknown>;
    required: string[];
};
export declare const WORKING_DIR: {
    type: "string";
    description: string;
};
export declare const WORK_OPT: {
    type: "string";
    description: string;
};
export declare const OUTLINE_PROPS: {
    pov: {
        type: "string";
        description: string;
    };
    targetWords: {
        type: "integer";
        description: string;
    };
    locks: {
        type: "string";
        description: string;
    };
    knowledge: {
        type: "string";
        description: string;
    };
    synopsis: {
        type: "string";
        description: string;
    };
    conflict: {
        type: "string";
        description: string;
    };
    beats: {
        type: "string";
        description: string;
    };
    ending: {
        type: "string";
        description: string;
    };
    situationLens: {
        type: "string";
        description: string;
    };
    livedScene: {
        type: "string";
        description: string;
    };
    stateLens: {
        type: "string";
        description: string;
    };
};
