import path from "node:path";
import { journal, object, validHash, requireValid, snapshotFile } from "./journal.js";
import { sha256, atomicWrite } from "../../../../core/src/fsx.js";
import { assertSourceId } from "./primitives.js";
import { NovelError } from "../errors.js";
const recovery=journal({file:".writer-source-pending.json",label:"书源导入",scope:"library",root:(dir:string)=>dir,decode:(r,dir)=>{
    const sourceId=assertSourceId(r.sourceId),stagedFile=`sources/.${sourceId}.pending.txt`,sourceFile=`sources/${sourceId}.txt`;
    requireValid(r.stagedFile === stagedFile && Array.isArray(r.writes));
    const w=object(r.writes[0]); requireValid(validHash(w.after));
    return {details:{sourceId},targets:[{file:sourceFile,absent:true,source:path.join(dir,stagedFile)},{file:`sources/${sourceId}.json`,absent:true},{file:"index.json",present:true}],guards:[{file:stagedFile,before:w.after,missingAfter:sourceFile}],cleanup:[path.join(dir,stagedFile)]};
}});
export const hasPendingSource=recovery.has,assertNoPendingSource=recovery.assertNone;
export async function createSourceJournal(dir:string,input:{sourceId:string;text:string;metaContent:string;indexBefore:string;indexContent:string}) {
    const sourceId=assertSourceId(input.sourceId),stagedFile=`sources/.${sourceId}.pending.txt`;
    if(await snapshotFile(path.join(dir,stagedFile)) !== null) throw new NovelError("id_collision","临时书源已存在，未覆盖原文件。");
    await atomicWrite(path.join(dir,stagedFile),input.text);
    return recovery.create(dir,{sourceId,stagedFile,writes:[{file:`sources/${sourceId}.txt`,before:null,after:sha256(input.text)},{file:`sources/${sourceId}.json`,before:null,content:input.metaContent},{file:"index.json",before:input.indexBefore,content:input.indexContent}]});
}
export const finishSourceJournal=recovery.finish,inspectPendingSource=recovery.inspect,resumePendingSource=recovery.resume;
