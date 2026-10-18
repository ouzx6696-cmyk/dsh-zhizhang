# 织章 Web · 小说工作台（0.15.0）

侧栏 **织章** 默认进入**三栏小说阅读工作台**（左章节 / 中正文 / 右状态与闸）；可切「管线」看原五 Tab。真采纳仍二次确认 + AcceptPolicy。`zhizhang_panel_snapshot` HTML 对齐管线信息架构，并与客户端同源字段（含 draftLabel / multiDraftEnabled）。

写回仍只走：**面板二次确认采纳** 或 `zhizhang_*` 工具。禁止静默写 `chapters/`。正文**不**塞进默认 snapshot（按需 GET，轮询保持轻量）。

## 小说模式（默认）

| 栏 | 内容 |
|----|------|
| **左** | 章节列表（色点、字数、brief✓）；章下挂待采纳摘要（可含 draftLabel） |
| **中** | 正式章全文（轻量 Markdown 只读）；有待采纳可切「候选对照」 |
| **右** | 当前小说状态；本章闸；Scheduler nextHints；采纳；**编辑抉择说明**（A/B/C）；多草稿开启时「统一整理」 |

顶栏：作品下拉 · **小说|管线** · 自动刷新 · 手动刷新。`localStorage` 记上次作品与章节。

空章：中栏引导走对话 Agent（brief→stage→lint→accept）；面板不产文。

## 管线模式（次级）

| 区 | 内容 |
|----|------|
| **总览** | 徽章、product 闭环、三柱卡、nextHints |
| **Library** | sources / craft\|mind、草稿卡、combo |
| **Inspiration** | 会话、根基 apply、三纲进度 |
| **Writing** | 章节 meta、当前小说状态、待采纳 |
| **工程留痕** | 审校 / brief / 兑付（折叠） |

## 真采纳

1. 小说右栏或 Writing 区点「采纳」→ 二次确认对话框。  
2. `POST /api/dsh-zhizhang/candidate/accept`，须 `confirm: true`。  
3. 与 `zhizhang_candidate_accept` **同一套** AcceptPolicy。  
4. 缺 confirm / 缺 lint / brief 闸失败 → **明确错误**，禁止静默成功。  
5. 编辑 A/B/C：**说明在面板**；`edit_decide` 仍走工具（避免第二套写语义）。

## 可选·多草稿（默认关）

- Snapshot 字段 `multiDraftEnabled`；待采纳可带 `draftLabel` / `unifyOf`。
- 开启后右侧「统一整理」→ `POST|GET /api/dsh-zhizhang/unify/prepare`（只返回 brief，不写盘）。
- 关闭时不显示该按钮（或多稿提示「默认关」）。

## 交互

- **自动刷新**：~6s 刷 snapshot meta；不可见 ~30s；正文仅在选章 / 采纳成功后重拉  
- **空态 / 加载 / 错误 / 重试** 齐全  
- **settings.plugin.item**：说明 + 根目录提示  

## HTTP API

| 路由 | 说明 |
|------|------|
| `GET /api/dsh-zhizhang/health` | 存活 + base + routes + version |
| `GET /api/dsh-zhizhang/works` | 作品列表 |
| `GET /api/dsh-zhizhang/snapshot?work=` | 完整 snapshot meta（**无**章/候选全文）+ html |
| `GET /api/dsh-zhizhang/library` | 拆书库摘要 |
| `GET /api/dsh-zhizhang/inspiration?work=` | 灵感摘要 |
| `GET /api/dsh-zhizhang/chapter?work=&id=` | 章 meta + body（禁穿越；约 400KB 可截断标 `truncated`） |
| `GET /api/dsh-zhizhang/candidate?work=&id=` | 候选 meta + body（已采纳仍可读，便于对照） |
| `POST /api/dsh-zhizhang/candidate/accept` | 真采纳（须 confirm） |
| `GET|POST /api/dsh-zhizhang/unify/prepare` | 多草稿 brief 包（须开启；不写盘） |

- 默认 **loopback only**；`config.allowLanPanel: true` 可放宽。  
- 写路径：accept POST（唯一正式章写入口 via Accept）。

### 存储根解析（HTTP）

优先级：`config.storageRoot` → `DSH_ZHIZHANG_ROOT` → `cwd/.zhizhang` → 向上 walk → `ensureStorage(cwd)`。  
HTTP 根**不**自动跟每个 Agent 会话 workspace（另议）。

## 官方席位

| 席位 | 用途 |
|------|------|
| `sidebar.panellist` + `main` | 侧栏「织章」+ 主栏工作台 |
| `settings.plugin.item` | 设置卡（可选） |

## 刻意不做

- 第二套 Tiptap / Word 编辑器  
- 静默写 chapters、静默 accept  
- 面板自带模型产文 / 页内静默起草  
- 面板完整 `edit_decide` 写回（说明卡即可）  
- payoff_audit 进默认链  

## 真机怎么看

1. `npm run build` 后重启 web profile（已 link 则重启即可）  
2. DSH Web 侧栏点 **织章** → 默认三栏  
3. 点有字数的章 → 中栏读全文；有待采纳可对照并采纳  
4. 顶栏切「管线」仍可看 Library / Inspiration  
