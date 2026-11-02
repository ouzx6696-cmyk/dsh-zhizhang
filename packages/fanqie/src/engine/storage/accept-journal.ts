import { journal, object, text, validHash, requireValid, type InputWrite } from "./journal.js";
import { assertCandidateFile, assertResourceId } from "./primitives.js";
import { assertNoInspirationMarker } from "./inspiration-journal.js";
import { assertNoPendingChapterSave } from "./chapter-journal.js";
export { snapshotFile } from "./journal.js";
const recovery = journal({file:".writer-accept-pending.json",label:"章节采纳",root:(dir:string)=>dir,decode:r=>{
    const chapterId=assertResourceId(text(r.chapterId)),candidateId=assertResourceId(text(r.candidateId)),bodyFile=assertCandidateFile(r.bodyFile);
    requireValid(r.mode === "append" || r.mode === "replace");
    requireValid(Array.isArray(r.guards) && r.guards.length === 1);
    const g=object(r.guards[0]);
    requireValid(g.file === `candidates/${bodyFile}` && validHash(g.before));
    return {details:{chapterId,candidateId,mode:r.mode},targets:[`chapters/${chapterId}.md`,"meta.json",`candidates/${candidateId}.json`,"ledger.json"].map(file=>({file})),guards:[{file:text(g.file),before:g.before}]};
}});
export async function assertNoPendingAccept(dir:string) {
    await assertNoInspirationMarker(dir); await assertNoPendingChapterSave(dir); await recovery.assertNone(dir);
}
export function createAcceptJournal(dir:string,input:{chapterId:string;candidateId:string;mode:"append"|"replace";writes:InputWrite[];bodyHash:string;bodyFile:string}) {
    const {bodyHash,...fields}=input;
    return recovery.create(dir,{...fields,guards:[{file:`candidates/${input.bodyFile}`,before:bodyHash}]});
}
export const finishAcceptJournal=recovery.finish,inspectPendingAccept=recovery.inspect,resumePendingAccept=recovery.resume;
