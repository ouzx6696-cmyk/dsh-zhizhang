/** Page component registered into the `main` slot. */
import React, { useState } from "react";
import { PanelApp } from "./components/App.jsx";
import { ErrorBoundary } from "./components/ErrorBoundary.jsx";

export function App() {
  const [view, setView] = useState("tasks");
  const [openedNovel, setOpenedNovel] = useState(false);
  return (
    <ErrorBoundary>
      <div style={{display:"flex",flexDirection:"column",height:"100%",minHeight:0}}>
        <nav aria-label="写作工作区" style={{display:"flex",gap:12,padding:12}}>
          <button type="button" aria-pressed={view==="tasks"} onClick={()=>setView("tasks")}>写作任务</button>
          <button type="button" aria-pressed={view==="novel"} onClick={()=>{setOpenedNovel(true);setView("novel");}}>小说工作台</button>
        </nav>
        <iframe title="写作 Agent 任务" src="/writer" style={{display:view==="tasks"?"block":"none",border:0,width:"100%",flex:1,minHeight:500}} />
        {openedNovel ? <div hidden={view!=="novel"} style={{flex:1,minHeight:0}}><PanelApp /></div> : null}
      </div>
    </ErrorBoundary>
  );
}
