import React from "react";
import {
  Brand,
  Button,
  Card,
  Stat,
  Steps,
  Toggle,
} from "../../../../../../packages/ui/src/primitives";
import { StatusBadge } from "../../../../../../packages/ui/src/status-badge";

export function DesignPreview() {
  const [checked, setChecked] = React.useState(true);
  return (
    <main className="lamp-component-preview">
      <h1>夜灯 · 组件预览</h1>
      <p>示例数据，仅用于开发时核对控件与文字。</p>
      {["dark", "light"].map((theme) => (
        <section key={theme} className="ui-theme-preview lamp-preview-section" data-theme={theme}>
          <header>
            <Brand />
            <h2>{theme === "dark" ? "夜灯" : "晨光"}</h2>
          </header>
          <Card title="写作的决定">
            <div className="button-row">
              <Button variant="primary">定稿</Button>
              <Button>派编辑审读</Button>
              <Button disabled>保存中</Button>
              <Button variant="danger">删除</Button>
            </div>
          </Card>
          <Card title="进度与状态">
            <Steps steps={["规划", "写作", "审读", "定稿"]} current={1} label="章节进度" />
            <div className="button-row">
              <StatusBadge mode="fanqie" status="final" />
              <StatusBadge mode="toutiao" status="初稿待改" />
            </div>
            <Toggle checked={checked} onChange={setChecked} label="编辑沿用写手连接" />
          </Card>
          <Card>
            <Stat label="全书字数" value="24,800" detail="示例数值" />
          </Card>
          <div className="lamp-preview-paper">
            <h3>第三章 · 雨夜</h3>
            <p>林川把车票放进大衣口袋。窗外的雨细了，站台尽头传来最后一班车的声音。</p>
          </div>
        </section>
      ))}
    </main>
  );
}
