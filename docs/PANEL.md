# 织章 Web · 小说工作台（0.17.0）

侧栏 **织章** 默认进入**三栏小说阅读工作台**（左章节 / 中正文 / 右状态与闸）；可切「管线」看原五 Tab。真采纳仍二次确认 + AcceptPolicy。`zhizhang_panel_snapshot` HTML 对齐管线信息架构，并与客户端同源字段（含 draftLabel / multiDraftEnabled）。

**工具按需**：面板本身常驻（HTTP 只读 + 采纳）；51 个 `zhizhang_*` 工具要在会话里先调 `zhizhang_enable`。

**接口**：`GET …/projects`（项目列表 + 当前 id）、`GET …/snapshot?base=<id>&work=<key>`；
`base` 白名单只含已登记工作区。

写回仍只走：**面板二次确认采纳** 或 `zhizhang_*` 工具。禁止静默写 `chapters/`。正文**不**塞进默认 snapshot（按需 GET，轮询保持轻量）；HTML 也改为显式 `?html=1` 才返回。

## 小说模式（默认）

| 栏 | 内容 |
|----|------|
| **左** | 章节列表（色点、字数、brief✓）；章下挂待采纳摘要（可含 draftLabel） |
| **中** | 正式章全文（轻量 Markdown 只读）；有待采纳可切「候选对照」 |
| **右** | 当前小说状态；本章闸；Scheduler nextHints；采纳；**编辑抉择说明**（A/B/C）；多草稿开启时「统一整理」 |

顶栏：**项目下拉 ▸ 作品下拉** · **小说|管线** · 自动刷新 · 手动刷新。`localStorage` 记上次作品与章节。

项目维度来自跨工作区索引（`$DSH_HOME/zhizhang-projects.json`，工具调用时自动登记）：默认选中「当前项目」（最近被工具写过的工作区）；切换项目后所有请求带 `?base=<项目 id>` / POST `base`，采纳也落在该项目。未登记或已删除的根会被拒绝（`bad_base`），下拉里显示为「（不可达）」。

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
- **轮询降载**：snapshot 默认不渲染 HTML；候选正文按 id 缓存，同一候选不会每轮重拉；章节透镜按 mtime 缓存
- **空态 / 加载 / 错误 / 重试** 齐全  
- **settings.plugin.item**：说明 + 根目录提示  

## 视觉与可访问性

- **配色派生**：所有线/面/次要色由 `currentColor` 经 `color-mix()` 派生（`--zz-line`、`--zz-surface`、
  `--zz-muted`、`--zz-accent` …），跟随 DSH 明暗主题，无第二套色表。
- **阅读优先**：中栏正文衬线字体、段首缩进 2em、列宽 `40rem` 居中、工具栏粘顶；`text-wrap:pretty`。
- **章节列表**：标题单行省略（悬停看全），字数右对齐，选中项左侧竖条；≤1100px 隐藏字数。
- **候选对照**：工具栏只读身份 chip（稿名 / id / 字数 / lint 状态），采纳仍只在右栏，避免第二套入口。
- **状态色**：`zz-gate-ok / zz-gate-bad / zz-gate-idle`；无待采纳时 lint 行走中性色，不误标红。
- **加载与动效**：骨架屏 `.zz-skel`；`prefers-reduced-motion` 关闭过渡与动画。
- **可访问性**：tab `aria-selected`、章节/候选 `aria-current` + `role=button` + Enter/Space、
  错误/成功条 `role=alert|status` + `aria-live`、`:focus-visible` 焦点环、确认框 `role=dialog aria-modal`。
- **断点**：≤1100px 两栏（右栏整行）· ≤720px 单栏（左 40vh / 中 56vh）· ≤520px 收边距。

## HTTP API

| 路由 | 说明 |
|------|------|
| `GET /api/dsh-zhizhang/health` | 存活 + base + routes + version |
| `GET /api/dsh-zhizhang/works` | 作品列表 |
| `GET /api/dsh-zhizhang/snapshot?work=` | 完整 snapshot meta（**无**章/候选全文）；默认**不含** HTML |
| `GET /api/dsh-zhizhang/snapshot?work=&html=1` | 同上 + 面板 HTML（嵌入用，轮询不必取） |
| `GET /api/dsh-zhizhang/library` | 拆书库摘要 |
| `GET /api/dsh-zhizhang/inspiration?work=` | 灵感摘要 |
| `GET /api/dsh-zhizhang/chapter?work=&id=` | 章 meta + body（禁穿越；约 400KB 可截断标 `truncated`） |
| `GET /api/dsh-zhizhang/candidate?work=&id=` | 候选 meta + body（已采纳仍可读，便于对照） |
| `POST /api/dsh-zhizhang/candidate/accept` | 真采纳（须 confirm） |
| `GET|POST /api/dsh-zhizhang/unify/prepare` | 多草稿 brief 包（须开启；不写盘） |

安全面：
- 默认 **仅回环**；Origin 若出现必须匹配 Host（DNS rebinding 防护）
- POST 一律 `application/json`（否则 415）
- LAN 模式（`allowLanPanel: true`）：Host 须在白名单（`panelHosts`，缺省本机网卡）+ 可选共享令牌（`panelToken`，Bearer / X-zhizhang-token）
- 限流：120 GET / 20 POST 每分钟每客户端（429）
- 写路径：accept POST（唯一正式章写入口 via Accept）；confirm/force/严格开关均严格布尔三态

### 存储根解析（HTTP）

优先级：`config.storageRoot` → `DSH_ZHIZHANG_ROOT` → **最近一次 Agent 工具使用的存储根** → `cwd/.zhizhang` → 向上 walk → `ensureStorage(cwd)`。  
工具与 HTTP 在同一宿主进程：`ensureStorage(exec)` 会记住会话根（`last-agent-tool`），面板轮询随之切换；
根同时写到 `$DSH_HOME/zhizhang-last-root.json`（默认 `~/.dsh/`），宿主重启后仍能直接指向上次工作区；
标记缺失/目录不存在时才回退宿主 cwd。多会话并发时以最近一次工具调用为准。

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

1. 已 link 且 **bundle 已启用** 后重启 profile（发行包无构建步骤）  
2. DSH Web 侧栏点 **织章** → 默认三栏  
3. 点有字数的章 → 中栏读全文；有待采纳可对照并采纳  
4. 顶栏切「管线」仍可看 Library / Inspiration  
