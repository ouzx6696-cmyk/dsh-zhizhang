import path from "node:path";
import { journal, object, text, requireValid, type InputWrite, type Target } from "./journal.js";
import { assertResourceId } from "./primitives.js";
import type { StoragePaths } from "../types.js";
const FILE=".writer-inspiration-pending.json";
const recovery=journal({file:FILE,label:"灵感应用",scope:"inspiration",root:(paths:StoragePaths)=>paths.inspiration,decode:(r,paths)=>{
    requireValid(r.workRoot === path.resolve(paths.works));
    const workKey=assertResourceId(text(r.workKey)),candidateId=assertResourceId(text(r.candidateId)),root=path.join(paths.works,workKey),targets:Target[]=[];
    if(r.chapterId) targets.push({target:"work",root,file:`chapters/${assertResourceId(text(r.chapterId))}.md`});
    targets.push({target:"work",root,file:"meta.json"});
    requireValid(Array.isArray(r.writes));
    if(r.writes.some(w=>{const v=object(w);return v.target === "inspiration" && v.file === "bindings.json";})) targets.push({target:"inspiration",file:"bindings.json"});
    targets.push({target:"inspiration",file:`candidates/${candidateId}.json`});
    return {details:{workKey,candidateId},targets,marker:path.join(root,FILE),lock:root};
}});
const inspirationGate=journal({file:FILE,label:"灵感应用",scope:"inspiration",root:(dir:string)=>dir,decode:()=>({details:{},targets:[]})});
export const assertNoPendingInspiration=inspirationGate.assertNone;
const workMarker=journal({file:FILE,label:"作品灵感应用",root:(dir:string)=>dir,decode:()=>({details:{},targets:[]})});
export const assertNoInspirationMarker=workMarker.assertNone;
export function createInspirationJournal(paths:StoragePaths,input:{workKey:string;candidateId:string;chapterId?:string;writes:InputWrite[]}) {return recovery.create(paths,{...input,workRoot:path.resolve(paths.works)});}
export const finishInspirationJournal=recovery.finish,inspectPendingInspiration=recovery.inspect,resumePendingInspiration=recovery.resume;
