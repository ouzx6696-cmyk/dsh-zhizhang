export declare function useToutiao(rootPath?: string): {
    dispatch: import("react").ActionDispatch<[action: import("./state.js").ToutiaoAction]>;
    refresh: () => Promise<void>;
    createArticle: (genre: string, driver: string) => Promise<{
        articleDir: string;
    } | null>;
    transitionArticle: (articleDir: string, to: string) => Promise<{
        status: string;
    }>;
    deliverArticle: (articleDir: string, title: string, body: string) => Promise<{
        deliveryPath: string;
    }>;
    rows: import("@zhizhang/toutiao/view").ArticleRowView[];
    selected: import("@zhizhang/toutiao/view").ArticleRowView | null;
    state: import("./state.js").ToutiaoState;
};
//# sourceMappingURL=useToutiao.d.ts.map