import {test} from 'node:test';
import assert from 'node:assert/strict';
import {mkdtemp,mkdir,readFile,writeFile,rm} from 'node:fs/promises';
import {tmpdir,hostname} from 'node:os';
import path from 'node:path';
import {createToolHarness} from '../helpers.mjs';
import {ensureStorage} from '../../build/fanqie/src/engine/work-store.js';
import {sha256} from '../../build/core/src/fsx.js';
import {snapshotFile} from '../../build/fanqie/src/engine/storage/journal.js';

for(const file of ['chapter-v1.json','chapter-v2-brief.json','chapter-v2-payoff.json','chapter-v3-lint.json','chapter-v4-stage.json','chapter-v5.json']) {
  test(`T4 旧事务样本 ${file} 经生产工具检查、断点续写且字节不变`,async()=>{
    const root=await mkdtemp(path.join(tmpdir(),'writer-legacy-journal-'));
    try {
      const paths=await ensureStorage({cwd:root},{storageRoot:root});
      const dir=path.join(paths.works,'legacy');
      await mkdir(dir,{recursive:true});await writeFile(path.join(dir,'meta.json'),'{}');
      const j=JSON.parse(await readFile(new URL(`../fixtures/journals/${file}`,import.meta.url),'utf8'));
      j.owner={pid:process.pid,host:hostname()};
      // Reproduce a crash after the first write, with the rest at their recorded baseline.
      const first=path.join(dir,j.writes[0].file);await mkdir(path.dirname(first),{recursive:true});await writeFile(first,j.writes[0].content);
      const pending=path.join(dir,'.writer-chapter-pending.json');await writeFile(pending,JSON.stringify(j));
      const harness=await createToolHarness({mode:'fanqie',cwd:root,config:{storageRoot:root}});
      assert.match(await harness.call('fanqie_status',{work:'legacy',recovery:'inspect'}),/已写入/);
      assert.match(await harness.call('fanqie_status',{work:'legacy',recovery:'resume'}),/已恢复/);
      for(const w of j.writes) assert.equal(await readFile(path.join(dir,w.file),'utf8'),w.content);
      assert.equal(await snapshotFile(pending),null);
    } finally {await rm(root,{recursive:true,force:true});}
  });
}

const write=(file,content='after')=>({file,before:null,content});
const cases=[
  {name:'accept',create:'createAcceptJournal',inspect:'inspectPendingAccept',resume:'resumePendingAccept',input:{chapterId:'c001',candidateId:'cand-a',mode:'append',bodyFile:'cand-a.md',bodyHash:sha256('candidate'),writes:[write('chapters/c001.md'),write('meta.json'),write('candidates/cand-a.json'),write('ledger.json')]},init:[['candidates/cand-a.md','candidate']]},
  {name:'chapter',create:'createChapterJournal',inspect:'inspectPendingChapterSave',resume:'resumePendingChapterSave',input:{chapterId:'c001',writes:[write('chapters/c001.md'),write('meta.json')]}},
  {name:'card',create:'createCardJournal',inspect:'inspectPendingCard',resume:'resumePendingCard',input:{candidateId:'cand-a',cardId:'card-a',writes:[write('cards/card-a.json'),write('index.json'),write('candidates/cand-a.json')]}},
  {name:'analysis',create:'createAnalysisJournal',inspect:'inspectPendingAnalysis',resume:'resumePendingAnalysis',input:{sourceId:'src-a',dataFile:'rhythms.json',writes:[write('analyses/src-a/rhythms.json'),write('analyses/src-a/meta.json')]}},
  {name:'discard',create:'createDiscardJournal',inspect:'inspectPendingDiscard',resume:'resumePendingDiscard',input:{cardId:'card-a',indexBefore:sha256('{}'),indexContent:'{"cards":[]}',cardBefore:sha256('card')},init:[['index.json','{}'],['cards/card-a.json','card']]},
  {name:'plan',create:'createPlanJournal',inspect:'inspectPendingPlan',resume:'resumePendingPlan',input:{sourceId:'src-a',clearConfirm:true,writes:[write('analyses/src-a/plan.json'),write('analyses/src-a/plan.md'),write('analyses/src-a/meta.json'),{file:'analyses/src-a/plan-confirm.json',before:sha256('confirmation')}]},init:[['analyses/src-a/plan-confirm.json','confirmation']]},
  {name:'source',create:'createSourceJournal',inspect:'inspectPendingSource',resume:'resumePendingSource',input:{sourceId:'src-a',text:'book',metaContent:'{}',indexBefore:sha256('{}'),indexContent:'{"sources":["src-a"]}'},init:[['index.json','{}']]},
  {name:'inspiration',create:'createInspirationJournal',inspect:'inspectPendingInspiration',resume:'resumePendingInspiration',input:{workKey:'legacy',candidateId:'cand-a',writes:[{...write('meta.json'),target:'work'},{...write('candidates/cand-a.json'),target:'inspiration'}]}},
];
for(const c of cases) test(`T4 ${c.name} 恢复确认绑定 id 与完整日志指纹，拒绝越权写入`,async()=>{
  const root=await mkdtemp(path.join(tmpdir(),'writer-journal-confirm-'));
  try {
    const api=await import(`../../build/fanqie/src/engine/storage/${c.name}-journal.js`);
    const context=c.name==='inspiration'?{inspiration:root,works:path.join(root,'works')}:root;
    if(c.name==='inspiration')await mkdir(path.join(root,'works','legacy'),{recursive:true});
    for(const [file,content] of c.init??[]){await mkdir(path.dirname(path.join(root,file)),{recursive:true});await writeFile(path.join(root,file),content);}
    const id=await api[c.create](context,c.input);
    const pending=path.join(root,`.writer-${c.name}-pending.json`),raw=await readFile(pending,'utf8');
    const inspected=await api[c.inspect](context);
    if(c.name==='chapter'){const j=JSON.parse(raw);assert.equal(j.version,1);assert.equal(j.kind,'save');}
    await assert.rejects(api[c.resume](context,{id:'different',fingerprint:inspected.fingerprint}),e=>e.code.endsWith('recovery_conflict'));
    await writeFile(pending,raw+'\n');
    await assert.rejects(api[c.resume](context,{id,fingerprint:inspected.fingerprint}),e=>e.code.endsWith('recovery_conflict'));
    const j=JSON.parse(raw);
    if(c.name==='discard')j.cardId='../escape';else j.writes[0].file='../escape';
    await writeFile(pending,JSON.stringify(j));
    await assert.rejects(api[c.resume](context),e=>e.code.endsWith('recovery_invalid'));
    assert.equal(await snapshotFile(path.join(root,'escape')),null);
    await writeFile(pending,raw);
    const fresh=await api[c.inspect](context);assert.equal(fresh.conflict,false);
    await api[c.resume](context,{id,fingerprint:fresh.fingerprint});
    assert.equal(await snapshotFile(pending),null);
    for(const w of JSON.parse(raw).writes??[]){const file=path.join(w.target==='work'?path.join(root,'works','legacy'):root,w.file);assert.equal(await snapshotFile(file),w.after);}
  } finally {await rm(root,{recursive:true,force:true});}
});
