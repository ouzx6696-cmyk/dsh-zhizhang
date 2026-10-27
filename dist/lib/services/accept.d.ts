export declare function runAccept(input: any): Promise<{
    ok: boolean;
    code: any;
    error: any;
    candidateId?: undefined;
    chapterId?: undefined;
    title?: undefined;
    wordCount?: undefined;
    status?: undefined;
    receipt?: undefined;
    nextHint?: undefined;
} | {
    ok: boolean;
    candidateId: any;
    chapterId: any;
    title: any;
    wordCount: any;
    status: any;
    receipt: string;
    nextHint: string;
    code?: undefined;
    error?: undefined;
}>;
