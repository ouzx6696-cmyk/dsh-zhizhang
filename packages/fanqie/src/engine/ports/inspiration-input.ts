import type { Foundation, Outline } from "../types.js";
import { asObject, asString, asStringArray, asEnum } from "../parse.js";
import { NovelError } from "../errors.js";
export interface StartInspirationInput {goal:string;genre?:string;cardIds?:string[];referenceIds?:string[];workKey?:string;craftOnly?:boolean;pace?:string}
export interface AcceptEmissionInput {workKey:string;apply?:boolean;title?:string;genre?:string;premise?:string}
export interface CardSelection {workKey?:string;cardIds?:string[];limit?:number}
type PlanPayload={content:string;[key:string]:unknown};
type ScopedPlanPayload=PlanPayload&{id:string;volumeId?:string;chapters?:string[]};
export type StageEmissionInput=
 | {kind:"foundation";payload:Partial<Foundation>}
 | {kind:"outline";payload:Partial<Outline>&{chapter:string;title?:string}}
 | {kind:"book_plan";payload:PlanPayload}
 | {kind:"volume_plan"|"act_plan";payload:ScopedPlanPayload};
const KINDS=["foundation","outline","book_plan","volume_plan","act_plan"] as const;
export function parseEmissionArgs(args:Record<string,unknown>):StageEmissionInput {
    const kind=asEnum(args,"kind",KINDS),p=asObject(args.payload,"payload");
    if(!kind)throw new NovelError("bad_args","kind 必填");
    if(kind === "foundation") {
        const payload:Partial<Foundation>={};
        for(const key of ["locks","happened","characters","readerKnowledge","planned","threads","style"] as const) {const value=asString(p,key);if(value !== undefined)payload[key]=value;}
        return {kind,payload:{...p,...payload}};
    }
    if(kind === "outline") {
        const payload:Partial<Outline>={};
        for(const key of ["pov","locks","knowledge","synopsis","conflict","beats","ending","situationLens","livedScene","stateLens"] as const){const value=asString(p,key);if(value !== undefined)payload[key]=value;}
        if(p.targetWords !== undefined){if(typeof p.targetWords !== "number" || !Number.isFinite(p.targetWords))throw new NovelError("bad_args","targetWords 必须是数字");payload.targetWords=p.targetWords;}
        return {kind,payload:{...p,...payload,chapter:asString(p,"chapter",{required:true}),title:asString(p,"title")}};
    }
    const content=asString(p,"content",{required:true});
    if(kind === "book_plan")return {kind,payload:{...p,content}};
    return {kind,payload:{...p,content,id:asString(p,"id",{required:true}),volumeId:asString(p,"volumeId"),chapters:asStringArray(p,"chapters")}};
}
