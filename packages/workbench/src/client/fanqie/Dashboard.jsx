import React from "react";
import { Stat, Card, Button } from "../../../../ui/src/primitives.jsx";
import { chapterName } from "../../../../ui/src/copy.js";

export function Dashboard({ snap, onOpen }) {
  const chapters = snap.chapters || [], totals = snap.totals;
  const activity = snap.activity, days = activity?.days || [];
  const maximum = Math.max(1,...days.map(day => day.words));
  const next = [];
  const revisions = snap.revisionImpacts || [];
  if(revisions.length) next.push({chapter:revisions[0].chapterId, text:"核对最近修订对后文的影响"});
  const pending = (snap.candidates || []).find(candidate => candidate.pending);
  if(pending) next.push({chapter:pending.chapterId, text:"查看待采纳的候选稿"});
  const current = chapters.find(chapter => chapter.status !== "final");
  if(current) next.push({chapter:current.id,text:current.wordCount ? "审读或继续修改工作稿" : "从下一章开始写作"});
  const events = [...(snap.ledgerRecent || [])].reverse().slice(0,5);
  return <div className="lamp-dashboard">
    <header><p className="wb-muted">你的故事，正在长大</p><h1>{snap.title}</h1></header>
    <div className="lamp-stats">
      <Card><Stat label="全书字数" value={(totals.words || 0).toLocaleString()} detail={days.length ? `最近七天增加 ${days.reduce((sum,day)=>sum+day.words,0).toLocaleString()} 字` : undefined}/></Card>
      <Card><Stat label="章节进度" value={totals.chapters || 0} detail={`${totals.drafted || 0} 章工作稿 · ${totals.planned || 0} 章待写`}/></Card>
      <Card><Stat label="已定稿" value={totals.final || 0} detail="由作者确认的章节"/></Card>
      <Card><Stat label="待看候选" value={(snap.candidates || []).filter(c => c.pending).length} detail="对照后决定是否采纳"/></Card>
    </div>
    <div className="lamp-dashboard-grid">
      <Card title="最近七天写作量">{activity?.unavailable ? <p role="alert">保存版本暂不可读，未统计写作量。</p> : <><div className="lamp-bars" aria-label="最近七天新增字数">{days.map(day => <div key={day.date} className="lamp-bar" title={`${day.date}：增加 ${day.words} 字`}><small>{day.words || ""}</small><i style={{height:`${Math.max(1,day.words/maximum*100)}%`}}/><small>{day.date.slice(5)}</small></div>)}</div><p className="wb-muted">{activity?.basis || "尚无可统计的保存版本"}</p></>}</Card>
      <Card title="接下来做什么"><div className="lamp-next">{next.slice(0,3).map((item,i) => <div key={i}><span>{chapterName(chapters,item.chapter)}<br/><small>{item.text}</small></span><Button onClick={()=>onOpen(item.chapter)}>去看看</Button></div>)}{!next.length && <p>这一阶段已整理好，可以开始下一章。</p>}</div><div className="lamp-progress" aria-label="章节完成比例"><span style={{width:`${totals.chapters ? totals.final/totals.chapters*100 : 0}%`}}/><span style={{width:`${totals.chapters ? totals.drafted/totals.chapters*100 : 0}%`}}/></div><small>已定稿 {totals.final || 0} 章 · 工作稿 {totals.drafted || 0} 章 · 待写 {totals.planned || 0} 章</small></Card>
    </div>
    {snap.foundation?.threads && <Card title="伏笔备忘"><p className="wb-prewrap">{snap.foundation.threads}</p></Card>}
    <Card title="最近动态">{events.length ? events.map((event,i)=><p key={i}>{chapterName(chapters,event.chapterId)} · {event.kind === "chapter_save_direct" ? "保存工作稿" : event.kind?.includes("review") ? "更新审读记录" : "更新创作记录"}<small> · {event.at?.slice(0,16).replace("T"," ")}</small></p>) : <p className="wb-muted">保存、审读与采纳后，进展会出现在这里。</p>}</Card>
  </div>;
}
