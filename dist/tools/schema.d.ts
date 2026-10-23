/** JSON-schema helpers for zhizhang tool parameters (Chinese descriptions). */
export declare function S(description: any): {
    type: string;
    description: any;
};
export declare function B(description: any): {
    type: string;
    description: any;
};
export declare function I(description: any): {
    type: string;
    description: any;
};
export declare function E(values: any, description: any): {
    type: string;
    enum: any;
    description: any;
};
export declare function O(properties: any, required?: any): {
    type: string;
    additionalProperties: boolean;
    properties: any;
    required: any;
};
export declare const WORKING_DIR: {
    type: string;
    description: any;
};
export declare const WORK_OPT: {
    type: string;
    description: any;
};
export declare const OUTLINE_PROPS: {
    pov: {
        type: string;
        description: any;
    };
    targetWords: {
        type: string;
        description: any;
    };
    locks: {
        type: string;
        description: any;
    };
    knowledge: {
        type: string;
        description: any;
    };
    synopsis: {
        type: string;
        description: any;
    };
    conflict: {
        type: string;
        description: any;
    };
    beats: {
        type: string;
        description: any;
    };
    ending: {
        type: string;
        description: any;
    };
    situationLens: {
        type: string;
        description: any;
    };
    livedScene: {
        type: string;
        description: any;
    };
    stateLens: {
        type: string;
        description: any;
    };
};
