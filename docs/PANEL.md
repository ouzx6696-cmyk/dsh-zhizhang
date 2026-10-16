# 轻量面板路径

首期：**无 React 客户端**。用 `zhizhang_panel_snapshot` 导出 JSON + HTML，供 Agent 或未来侧栏只读渲染。写回仍只走 `zhizhang_*` 工具。

## 当前数据源（已实现）

| 字段 | 来源 |
|------|------|
| 章节进度 / 字数 / status | `meta.json` + chapters |
| 处境三字段 | 各章 outline |
| 待采纳候选 | `candidates/*.json`（`pending=!acceptedAt`） |
| 审校留痕最近条 | `ledger.json`（工程轨；≠小说状态） |
| 下一步提示 | 代码规则拼装 |
| `html` | 同内容的无样式片段，可嵌入宿主 |
| `briefCrumbsRecent` | 近 12h 内 `chapter_brief` 留痕 |
| `lastPayoffByChapter` | 每章最近一次 `payoff_audit` 摘要 |
| 章节 `briefRecent` | 该章是否有近期 brief |

调用：

```text
zhizhang_panel_snapshot  format=json|html|both
```

## DSH Web 挂钩点（调研结论，二期接线）

对标 `dsh-novel-writer` v5.2+ / v6（见 `docs/research/` 与 `/tmp/novel-writer/lib/client.js`）：

### 官方席位（推荐，DSH ≥ 0.2.0）

| 席位名 | API | 用途 |
|--------|-----|------|
| `sidebar.panellist` | `ctx.slots.inject("sidebar.panellist", () => ctx.slots.register({ name, id, order, label }, Icon))` | 侧栏主导航一行 |
| `main` | `ctx.slots.inject("main", () => ctx.slots.register({ name: "main", key: sameId, inject }, Page))` | 主栏页面，**与 panellist 同 id** |
| `settings.plugin.item` | `ctx.slots.inject("settings.plugin.item", …)` | 设置页插件卡片（宿主须 serve 对应 namespace） |

**安全铁律（novel-writer 真机事故）：**

- 用 **`ctx.slots.inject`（槽位等待）**，不要用 **`ctx.inject(['sidebarRightTabs', …])`（cordis 服务等待）**——后者会让宿主判定插件 did not activate，桌面端启动失败。
- 注册前用 `ctx.slots.specDynamic?.(name)` / `spec?.(name)` 探测席位是否已声明；未声明则跳过，保留无 UI。
- `package.json` 将来增加：

```json
"exports": { ".": "./dist/index.js", "./client": "./dist/client.js" },
"dsh": {
  "bundle": { "patch": "./cordis.patch.yml" },
  "client": {
    "inject": [
      "@deepseek-ai/dsh-client-runtime",
      "@deepseek-ai/dsh-client-connection",
      "@deepseek-ai/dsh-client-ui-settings"
    ],
    "platform": "web"
  }
}
```

### 可选：宿主 HTTP 读状态（novel-writer 模式）

- Node 半：`ctx.inject(["webServer"], wctx => wctx.webServer.register(route))`
- 路由只读：例如 `GET /api/dsh-zhizhang/snapshot` → 内部调 `buildPanelSnapshot`
- **禁止**在 HTTP 路由里静默写 `chapters/`；写回必须触发与 `candidate_accept` 同等的显式路径

### 已废弃/勿用

| 旧写法 | 原因 |
|--------|------|
| `ctx.sidebarRightTabs` + `sidebar.right.pane.tab` | 服务就绪时序不稳，易静默退回；且曾用 `ctx.inject` 拖垮启动 |
| 自建 DOM 注入宿主侧栏列 | 主题/布局一改就碎；仅作无官方席位时的遗留回退 |

## 二期面板职责（刻意做小）

- 只读：进度、处境摘要、雷达/审校留痕计数、待采纳列表
- 按钮若做「采纳」：必须调用与工具相同的 `acceptCandidate` 路径（含 final 拒绝 / 双采纳拒绝）
- **不做**第二套编辑器，避免工程 UI 与创作缠死


## React 席位

数据座已含 brief / 兑付字段。**未**接线 `ctx.slots.inject("sidebar.panellist")` / `main`。二期按官方席位表接只读页即可；禁止 HTTP 静默写库。
