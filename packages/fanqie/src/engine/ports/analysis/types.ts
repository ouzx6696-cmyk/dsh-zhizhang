export type SourceChapter=ReturnType<typeof import('./chapters.js').chapterIndex>[number];
export interface AnalysisPlan {
    schemaVersion:number;sourceId:string;title:string;mode:"auto"|"full";ratio:number;totalChapters:number;totalChars:number;planChapters:number;planChars:number;batchChars:number;
    chapters:{n:number;title:string;chars:number;reason?:string}[];batches:{i:number;chapters:number[];chars:number}[];cursor:number;createdAt:string;
    consent?:{at:string;note?:string;token?:string};
}
export interface ConsentParams {batchChars:number;totalChapters:number;planChapters:number}
export interface ChapterFact {
    n:number;title?:string;readingLevel?:string;hook?:{type?:string;text?:string;strength?:string};functions?:string[];
    events?:{desc?:string;quote?:string;loc?:string}[];sourceHash?:string;sourceStart?:number;
}
export interface Plot {title?:string;chapters?:number[];goal?:string;obstacle?:string;action?:string;result?:string;twist?:string;turn?:string}
interface Foreshadowing {name?:string;planted?:string|number;plant?:string|number;paidOff?:string|number;payoff?:string|number;status?:string}
interface Rhythm {
    points?:{chapter:number;emotion:number;event?:string}[];
    loops?:{id?:string;range?:number[];setup?:string;release?:string;reaction?:string;transition?:string}[];
    hooks?:{chapter:number;type:string;text:string;strength?:string}[];foreshadowing?:Foreshadowing[];
}
interface Character {name:string;role?:string;mask?:string;truth?:string;function?:string;arc?:{chapter:number;from?:string;to?:string;pressure?:string}[]}
interface Module {id?:string;title?:string;schemaVersion?:number;layer?:string;dimension?:string;readerWant?:string;emotionArc?:string;dramaticUnit?:string;transfer?:string;failWhen?:string;mustNotCopy?:string[];legacy?:boolean}
interface Survey {
    totalChars?:number;rawChars?:number;lines?:number;chapterCount?:number;avgChapterChars?:number;minChapterChars?:number;maxChapterChars?:number;dialogueRatio?:number;
    volumes?:{title?:string;name:string;from:number;to:number;chapters:number;chars:number;firstTitle?:string;lastTitle?:string}[];
    terms?:{term:string;count:number}[];heatmap?:{buckets:number;rows:{term:string;counts:number[]}[]};anchors?:{n:number;title?:string;score:number;why:unknown}[];
}
export interface ReportInput {
    sourceTitle:string;meta?:{totalChapters?:number;scope?:{mode?:string}}|null;
    facts?:ChapterFact[];plots?:Plot[];rhythms?:Rhythm|Rhythm[];characters?:Character[];modules?:Module[];
    coverage?:Partial<{ratio:number;scope:number;confidence:number;needsReview:boolean;facts:number;quotePass:number;structure:number;dimensions:number;capped:boolean}>;
    stats?:{n:number;chars:number;sentences:number;avgSentence:number;dialogueRatio?:number}[];
    benchmark?:string;notes?:string;plan?:AnalysisPlan|null;survey?:Survey|null;
}
