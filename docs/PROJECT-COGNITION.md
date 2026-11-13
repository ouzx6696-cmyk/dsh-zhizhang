# 织章（dsh-zhizhang）项目认知文档

> 基线：1.2.0（基于 1.1.2 重构分支）。版本、验证与发布状态以 [STATUS](STATUS.md) 为准，本文只讲结构与风险。
> 1.2 已更新 IPC、目标只读、子会话、连续性事务、材料投影与 UI 包边界；实施记录以 [1.2 开发清单](plans/v1.2/README.md) 为准。
>
> 生成方式：文档全量阅读 + 源码按包分工通读 + 核心链路（`core/execute`、写作流水线、IPC、会话层）逐行复核。**本文以代码实际行为为准**；与 `docs/` 旧文冲突处已在正文标注。

---

## 1. 一句话认知

织章是一个**本地优先的中文写作桌面客户端**：把「规划 → 起稿 → 审读 → 修订 → 质检 → 作者采纳/定稿」做成一条**可暂停、可恢复、可审计**的流水线；模型负责生成，代码负责编排、校验、落盘和门禁，**作者始终是最终裁判**。

两种模式共用一套骨架：

| 模式 | 写什么 | 核心闭环 |
| --- | --- | --- |
| 番茄长篇（`fanqie`） | 网文长篇 | 立项/根基 → 章纲 → 多稿候选 → 采纳 → 审读 → 定稿 → 连续性记账；另有拆书库九步与灵感规划 |
| 今日头条（`toutiao`） | 资讯/故事/微头条 | S1 找题 → S2 立项 → S3 标题 → S4 成文 → S5 红笔 → S6 质检 → S7 交稿；状态五值 + 84 分硬闸 |

产品边界：不登录、不自动发布、不训练模型；作品只存在本机；只有作者发起任务时才调用模型。

---

## 2. 一眼架构

```text
┌────────────────────────────── Electron 渲染进程（React 19）──────────────────────────────┐
│ App / Workspace / AgentPanel / WorkflowPanel / Settings / CommandPalette                 │
│ 单一 desktopStore + chatStore（useSyncExternalStore 字段订阅）                            │
│ 写作区组件来自 packages/workbench/src/client（fanqie / toutiao / shared）                │
└───────────────▲───────────────────────────────────────────────┬─────────────────────────┘
                │ window.writerBridge（contextBridge）           │ 事件 writer:event
┌───────────────┴───────────────────────────────────────────────▼─────────────────────────┐
│ preload.ts：统一回执桥；渲染端 desktop-api.ts：39 个 invoke 封装 + subscribe            │
│ 主进程 main/ipc：contract.ts（通道唯一清单）→ validate.ts（边界解析）→ register*.ts      │
│ main/operations.ts：把 writer:request 分发给 toutiao / fanqie / profiles 路由处理器      │
└───────────────▲───────────────────────────────────────────────┬─────────────────────────┘
                │                                               │
┌───────────────┴──────────────┐                 ┌──────────────▼──────────────────────────┐
│ Sessions（PI 会话宿主）       │                 │ WorkflowService（作品级流水线）          │
│ 写手/编辑/规划会话、工具包装、 │                 │ 阶段编排、journal、预算、暂停/恢复、交付  │
│ 队列、取消、用量、自动记账     │                 │ chapter / article / book / ledger       │
└───────────────▲──────────────┘                 └──────────────┬──────────────────────────┘
                │                                               │
┌───────────────┴───────────────────────────────────────────────▼─────────────────────────┐
│ packages/fanqie（长篇引擎 + 写作层 + 写作台 API）  packages/toutiao（头条 + Python 质检）  │
│ packages/core（executeTool、门禁、fsx、锁、方案、Python runner、通用 journal）            │
│ packages/workbench（路由契约、适配器、写作区组件）  packages/ui（令牌、文案、原语）        │
└─────────────────────────────────────────────────────────────────────────────────────────┘
                                     │
                            本地文件系统（原子写 + 目录锁 + 恢复日志）
```

**关键事实**

- **没有 HTTP 服务**。写作台命令由主进程 `writer:request` IPC 调起，契约在 `packages/workbench/src/commands.ts`。
- **没有数据库**。作品、候选、审读、质检、台账、流水线记录全部是文件；原子写、fsync、锁与 journal 构成持久化协议。
- **PI SDK 是唯一模型接入层**，且只在 `apps/desktop/src/session/pi-adapter.ts` 导入（架构守卫强制）。

---

## 3. 技术栈与仓库形态

| 项 | 值 |
| --- | --- |
| 运行时 | Electron `45.2.3`；Node.js `>=24.11`（推荐 24） |
| 语言/构建 | TypeScript `~5.8.3`、React `19.3.1`、Vite 8 + electron-vite 6、esbuild 压缩渲染包 |
| 模型 | `@earendil-works/pi-coding-agent` / `pi-ai` `1.5.0` |
| Python | `>=3.10`；发行包内置 python-build-standalone `3.13.18`；`WRITER_PYTHON` 可指定解释器 |
| 包管理 | npm；根 `package.json` 的 `workspaces` 只声明了 `apps/desktop` |
| 依赖策略 | 不新增运行时依赖；`undici` 被根 `overrides` 固定为 `8.12.3` |
| 分发 | Windows x64 NSIS 安装包 + 免安装 ZIP；`appId=local.writer.agent`，可执行文件 `WriterAgent` |

**仓库形态的一个特殊点**：`packages/core|fanqie|toutiao|workbench|ui` **不是 npm workspace**，而是通过相对路径源码互相引用（例如 `apps/desktop/src/workflow/service.ts` 里 `../../../../packages/core/src/fsx`）。这带来两个后果：

1. 构建/测试必须由根 `tsconfig` 与 `scripts/build-*.mjs` 统一编译，不能单独 `npm run build -w packages/xxx`。
2. 架构守卫承担了「包边界」的职责——依赖方向靠脚本检查，不靠包管理器。

---

## 4. 目录与依赖分层

```text
apps/desktop/                 Electron 主进程、preload、PI 会话、流水线、React 界面
  src/main/                   生命周期、IPC、窗口、CSP、operations、存储与目标选择
  src/session/                PI 适配、会话管理、提示拼装、工具包装、任务追踪、子代理
  src/workflow/               阶段式写作：service / run / context / stage-model / 各流水线
  src/renderer/               React 外壳与功能模块
  src/styles/                 桌面外壳样式（.studio-*、.paper-*、.agent-* 等）
packages/core/                工具执行、门禁、原子文件、锁、路径、方案、Python runner、
                              方法包决策表、通用 workflow journal / 预算 / 用量
packages/fanqie/              长篇引擎（domain/storage/services/ports/tools）+
                              写作层（章纲检查、审读回报、forge 桥接）+ 写作台 API
packages/toutiao/             头条业务、21 个工具、Python 质检桥、台账、原典库
packages/workbench/           路由契约、桌面适配器、方法方案 API、写作区 React 组件
packages/ui/                  设计令牌、共享文案、状态映射、Dialog/Steps/Tabs/Notify、Markdown
assets/                       来源登记与文件清单（sources.json / manifest.json）
scripts/                      守卫、测试调度、资产、备份、打包、发行校验
test/                         单元/流程/引擎/桌面/PI/渲染/GUI 测试
```

### 依赖方向（架构守卫 `scripts/architecture-guard.mjs` 检查）

| 层 | 允许依赖 |
| --- | --- |
| `apps/desktop` | core、fanqie、toutiao、workbench、ui |
| `packages/workbench` | core、ui；业务处理器由桌面注入 |
| `packages/fanqie` | core、workbench 路由契约 |
| `packages/toutiao` | core、workbench 路由契约 |
| `packages/core` | 仅 Node 标准库与相对导入 |
| `packages/ui` | React（无 Node/fs） |

其他强制约束：PI SDK 只准在 `pi-adapter.ts` 导入；渲染层只能通过 `renderer/state/desktop.ts` 接触 preload；`BROWSER_SAFE` 模块不得引用 `fsx`/Node；番茄 `storage` 不得依赖业务层。

---

## 5. 十条设计信条（读懂代码的钥匙）

1. **作者是最终裁判**
   模型可以提出规划、候选、审读意见；采纳、定稿、交稿、force 覆盖必须由作者确认。写作台按钮与模型工具共用同一套门禁与服务。

2. **编排归代码，模型只填内容**
   流水线每个阶段是**无工具、无历史的新请求**；提示包由代码拼装，输出先过结构校验再落盘。模型不能「顺手」调用工具或保留跨阶段上下文。

3. **文件是事实来源**
   对话里的「完成」不算数；只有落盘成功才算。作品目录里保存正文、章纲、候选、审读、质检、台账与恢复日志。

4. **版本绑定**
   章节 `revision = sha256(body + outline + position)`；候选记录目标基线；审读/简报/交付绑定 revision 与依据指纹。正文一改，旧审读与旧候选不能继续套用。

5. **只在信任边界校验**
   IPC 参数、HTTP body、配置文件、模型工具参数、读文件后的解析、环境变量——在这些位置解析成明确类型；内部函数直接信任类型。

6. **不吞错**
   禁止空 `catch`、`.catch(() => 默认值)`、`except: pass`；只允许对明确认识的错误降级（如 `ENOENT`）。守卫扫描并要求 `// allow-catch:` 注明原因。

7. **一件事只有一处实现**
   原子写、读 JSON、sha256、ID、时间戳、路径沙箱、锁、恢复日志、状态映射、文案、错误到 HTTP 的映射，都有唯一归属。

8. **方法资产不可改**
   `packages/*/skill/` 下的上游方法原文一字不改；默认方案是从原件提炼的只读版本；用户方案可覆盖。质检规则唯一来源是 Python `rules.py`。

9. **失败要可恢复，不静默降级**
   阶段暂停保留已完成阶段；多文件写入中断保留 journal；恢复必须核对原意图、版本与哈希；关键材料超预算时暂停而不是静默截断。

10. **测试走生产路径**
    工具经 `executeTool` + 门禁执行；路由经真实处理函数；界面经 Playwright 旅程。不用正则扫源码当断言，不为测试改生产代码。

---

## 6. 启动与运行时生命周期

入口 `apps/desktop/src/main/index.ts` → `main/lifecycle.ts:start()`：

1. `userData` 目录初始化；`setStateRoot(home)`、`setProfilesRoot(home/profiles)`。
2. `Settings.load()`：模型连接、外观、上下文设置、写作引擎设置；API Key 用 `safeStorage` 加密，不可用时只留内存。
3. 读取 `writer.json` 业务配置；任一模式有无效字段则**整模式回退默认**并提示。
4. 构造 `Sessions`（注入 emit/confirm/created/extras），读取 `target.json`：
   - `cleanStaleWorkspaceClaim` 自愈崩溃遗留的作品占用登记；
   - `selectTarget` 打开最近作品/文章（见下）。
5. `registerIpc(state)` → 创建主窗口（`show:false` + 主题底色 + `ready-to-show`，3 秒兜底）→ 初始化自动更新。
6. 退出：`will-quit` 时 `sessions.dispose()` + `releaseWorkspaces()`，单步失败记日志后继续。

### 打开作品时的锁与初始化（`main/targets.ts:selectTarget`）

- 归一化 root（`physicalRoot`），创建必要的空目录后先认领作品锁；再执行 `ensureStorage` 和项目登记。
- `lockRoot`：番茄有作品时锁**作品目录**，否则锁写作根；头条锁文章根。
- `claimWorkspace` 取得跨进程作品锁；只读时返回 owner，界面提示「接管」。
- 写 `target.json`；切换目标时，旧根在无运行任务时释放锁并 `sessions.release`。

---

## 7. 会话层：PI 如何被使用

### 7.1 唯一适配边界

`session/pi-adapter.ts` 重导出 PI SDK，并承担：

- 系统代理注入：`HTTP(S)_PROXY` 生效，但 `localhost/127.0.0.1/::1` 永远直连（本地模型、中继不被代理）。
- `runtimeModel`：按角色注册 `writer-writer/editor/planner` 自定义 provider。
- `stageRuntimeModel`：流水线阶段按 `sha256(authPath + role + settings)` 复用 `ModelRuntime`（最多 8 份，失败即删）。
- `promptWithSignal` / `promptAccepted`：取消贯穿准备期与首请求；`followUp` 排队。
- `providerErrorTraits`：把错误文本交给 pi-ai 的 `isContextOverflow` / `isRetryableAssistantError`。

### 7.2 会话种类

| 会话 | 创建位置 | 特点 |
| --- | --- | --- |
| 写手主会话 | `SessionManager.create/open`（持久化，`current` 指针） | 有完整工具面；消息排队；可压缩；按作品+角色恢复 |
| 编辑子代理 | `createSession(..., "editor")` | 独立短会话；受限工具白名单；不能采纳/定稿/改根基/入库 |
| 规划子代理 | `createSession(..., "planner")` | 独立短会话；规划工具白名单 |
| 起草子会话 | `createDraftSession`（内存档） | 抽卡用；不注册主会话、不向作者界面转发事件 |
| 流水线阶段 | `stageModel` 直接 `streamSimple` | **无工具、无历史**；每个阶段一个新请求 |

### 7.3 调度员模式（guided）

`Settings.engine.guided` 默认 `true`。此时主会话不再是「全工具写手」，而是**对话入口 + 流水线调度员**：

- 只保留 8 个基础读取/创建工具（`create.ts:118-131`），再加 `workflowTools`；工具面超过 12 项拒绝启动。
- 系统提示明确：任务用 `writer_pipeline_start`；代码负责方法、上下文、起稿、择优与审读；不替作者采纳或定稿。
- 关闭 guided 后回到自由写作：全工具面 + 委派审读 + 抽卡 + 学习 + 来源读取。

### 7.4 压缩与用量

- 自动压缩交由 PI；`context-settings` 把作者设置映射为 `reserveTokens` / `keepRecentTokens` / 触发比例。
- `proactiveCompact` 在任务结算空闲后、上下文达窗口 75% 时主动压缩（默认关）。
- 每条助手消息记录 `model_usage`：角色、模型、服务商、输入/输出/缓存读写 token、SDK 估算费用；不记录提示正文与密钥。
- 任务级用量在 `task-tracker` 聚合；子会话结束把用量回加父任务。

---

## 8. 写作流水线（1.0 核心）

### 8.1 组件关系

| 文件 | 职责 |
| --- | --- |
| `workflow/service.ts` | 每作品一个活动 run；启动/恢复/替换/暂停；指针；交付/采用；记账队列（历史读取在 `history.ts`） |
| `workflow/run.ts` | `WorkflowRun.model()`：拼阶段包、预算预检、in-flight 预留、调用 `stageModel`、写日志 |
| `workflow/context.ts` | 组装作品材料（stable/material）、basis 指纹、`assertCurrent` 新鲜度检查 |
| `workflow/stage-model.ts` | 单阶段模型请求：stall watchdog、供应商错误分类、退避、截断/余额/鉴权处理 |
| `workflow/chapter.ts` / `article.ts` / `book.ts` / `continuity.ts` | 四条业务流水线（文章的来源准备在 `article-source.ts`，质检硬闸与两轮精修在 `article-qa.ts`） |
| `workflow/editor.ts` | 读者擂台选稿、硬伤审读、两轮定向修订 |
| `workflow/methods.ts` | 阶段卡生成与缓存；方法依据指纹 |
| `workflow/schema.ts` | 模型 JSON 容错解析、引文定位、各类输出结构校验 |
| `workflow/apply.ts` | 规划/文章采用的备份、冲突检查、生产质检 |
| `workflow/recovery.ts` | 中断后识别「本任务自己的交付」并恢复 |
| `packages/core/src/workflow.ts` | 通用 `WorkflowJournal`：记录 schema、阶段重试、串行合并写盘 |

### 8.2 Run 记录与 journal

`WorkflowRecord`（`packages/core/src/workflow-config.ts:145-157`）：

```ts
{
  schema: 1,
  id: "run-xxxx",
  request: { kind, chapter, instruction, grade, source, line },
  sourceHash,          // 作品来源 + 作者要求指纹
  basis,               // 任务开始时读到的作品依据（用于恢复核对）
  state: running | paused | failed | awaiting-author,
  reason?: run-budget | stage-budget | balance | context | interrupted | stopped | auth,
  steps: [{ id, title, status, started, durationMs, attempts, usage, output, error?, model? }],
  created, updated
}
```

- 记录存放在 `<userData>/workflows/<targetKey>/run-*.json`，指针 `current`。
- `WorkflowJournal.open` 会同时解析「传入的请求」与「磁盘记录」，`sourceHash` 或 request 不一致直接拒绝，避免旧进度套新任务。
- `save()` **串行合并**：并发阶段同时保存时，写盘时才序列化最新状态，旧快照不会覆盖新快照（`packages/core/src/workflow.ts:188-215`）。
- `step()`：已完成阶段直接 `parse` 复用；失败按 `retries` 重试；**只有内容校验失败才重试**，transient/provider/截断/暂停都不重试；失败调用的已计费用量会累加进记录。
- `parse` 只校验结构且必须能接受自己的输出（恢复时复用）；`accept` 才做「对当前世界」的校验（标题是否撞车、作者章纲是否变化），只在新生成时执行。

### 8.3 阶段上下文包

`contextPacket`（`packages/core/src/workflow-config.ts:215-260`）把材料分成两段：

- **stable / prefix**：阶段职责、本书设定与作者约束、材料 → 作为 `systemPrompt` 发送，让 Claude 系 API 能在末尾打缓存断点。
- **variable / suffix**：本阶段方法、本阶段输入、作者要求、返回格式、上次失败原因 → 作为 user 消息。
- 可选块采用**前缀稳定**策略：遇到第一个放不下的可选块就停，后面的全部让位；必带块绝不截断，超限直接 `WorkflowPause("stage-budget")`。
- 预算预检把并发阶段已预留的输入也算进去（`inflight`），一批并发不会一起过线后超支。

### 8.4 模型请求与失败语义（`stage-model.ts`）

- **单一重试层**：SDK `maxRetries: 0`；`withProviderRetry` 负责 transient 退避（2s/6s/15s，±20% 抖动）。
- **错误分类**：先认「余额不足」文案（402/429/400 都可能），再认开头状态码（401/403=鉴权，408/429/5xx=transient），再用 pi-ai 的 context/recoverable 判定；未知错误直接失败，不暂停。
- **stall watchdog**：请求发出后 6 分钟没有首个进度事件，或开始输出后 150 秒没有新事件，中止并按 `stalled` 重试一次。
- **截断**：`stopReason === "length"` 直接失败，但保留已计费用量（同一包重发大概率再截断）。
- **余额/上下文超限**：转成 `WorkflowPause("balance" | "context")`，任务暂停、进度保留，可充值/换模型/缩任务后恢复。
- **鉴权**：`StageError("auth")`，任务失败并给作者明确提示。
- 阶段日志 `workflow_stage` 记录 cacheRead/cacheWrite/cost/packetTokens/prefixTokens/omitted/attempt/ms，便于之后用真实模型核算缓存命中。

### 8.5 章节流水线（`chapter.ts`）

前置：章节必须已存在、不能是 `final`；完整作者章纲（8 字段 + targetWords ≥ 300）优先，不完整才让 planner 补全，且补全**不得改动作者已有字段/章名/目标篇幅**。

| 阶段 id | 做什么 | 说明 |
| --- | --- | --- |
| `outline` | 采用作者章纲，或补全章纲 | 补全有 `accept` 校验，保护作者字段 |
| `scenes` | 规划 1–6 场 | purpose/conflict/information/change |
| `draft-N` | 多稿起稿 | economy=1；标准档黄金前三章=5，其余=2；精品档 8/3；3 路并发；每稿不同开场 |
| `selection` | 读者擂台选稿 | 见下 |
| `review-0..2` / `revise-0..1` | 硬伤审读 + 两轮定向修订 | 最多 5 条硬伤；硬伤必须引用当前正文 |
| `prepared` | 保存交付依据 | 原始正文/篇幅/章纲/标题 + plan |
| `delivery` | 暂存候选 | 作品锁内再次核对章纲；每个候选带 `workflow:<runId>:<index>` 标记；幂等重试不重复保存 |

读者擂台（`editor.ts:31-115`）：每个挑战者与当前擂主按「读者画像 × 正反两个位置」投票；只有**位置一致**的结论才计票；先跑同一画像两个位置预热前缀，其余 4 路并发。写作与评审使用同一模型时会明确标注「排序仅供参考」。

修订保护（`editor.ts:116-141`）：模型只能改硬伤所在段落及相邻段；其他段落必须按原文顺序保留在输出中；篇幅变化超过 30% 直接拒绝。两轮后仍有硬伤 → **不丢弃**，交付最佳稿并标 `unresolved`，由作者判断。

### 8.6 文章流水线（`article.ts`）

| 阶段 id | 做什么 |
| --- | --- |
| `sources` | 作者素材 / 本地原典 / 安全链接读取；故事线不抓新闻 |
| `article-card` | 复用或生成立项卡；`checkCard` 预检；出处链接必须落在给定来源中 |
| `headlines` | 标题矩阵；近期 30 篇标题作为 `avoid`；标题 ≤ 34 字，至少 5 个不重复 |
| `blueprint` | 开篇三段、主稿结构、延伸 |
| `draft-N` | economy=1 / standard=2 / premium=3，全部并发；主标题撞近期文章触发重试 |
| `selection` | 头条读者画像擂台 |
| `review-0..2` / `revise-0..1` | 编辑硬伤审读 + 最多两轮定向修订；硬伤引文必须落在当前正文 |
| `facts` / `facts-revise` / `facts-1` | 事实链；允许 `unsupported`，自动删改一轮后复核 |
| `qa-0..2` | **真实 Python 质检硬闸**；不过线则 `qa-revise-N` 精修，最多两轮 |
| `facts-final` | 精修改动正文后重核事实链 |
| `final-review` | 终审；若正文自上次审读后未变，直接复用审读报告 |
| `prepared` / `delivery` | 保存工作稿与报告；向文章追加带 `workflow:<runId>` 标记的草稿，幂等 |

与章节不同，头条**不降低质检门槛**：真实 `qa_check` 两轮不过仍失败；有硬伤/无来源事实/未解决修订时，工作稿与报告保留并标注，但**不替作者交稿**。

**经济档只减少起稿数量**（`article.ts` 的 `count`），标题矩阵、结构、审读/精修、事实链和质检都不缩减。这是头条真实模型耗时明显高于番茄章节的主要原因，也是后续可做减法的地方。

### 8.7 规划与记账流水线

- `bookPipeline`：`foundation` → `rolling-outline`（3–5 个未来章，不得覆盖已有章）→ `delivery`；作者点「采用」后 `applyPlan` 备份 meta、核对根基/规划未被修改，再写根基与章纲。
- `ledgerPipeline`：定稿后自动记账。`extract` 只记正文明确发生的变化；每章结 10 章时跑 `long-audit`；`delivery` 在作品锁内再次核对正文哈希，冲突事实进入 `pending` 待作者确认。
- 记账不会抢占一个「作者仍可继续/采用」的 run：先写入 `pending-ledger.json` 队列，等空档再跑（`service.ts` 的 `drainLedger`）。

### 8.8 交付幂等与恢复

- 章节交付：候选的 `note` 是 `workflow:<runId>:<index>`；重试时若已存在，核对 `targetRevision` 与正文哈希，一致则复用，不一致则拒绝覆盖。
- 文章交付：文章草稿的 `note` 是 `workflow:<runId>`，同样核对 revision + sha256。
- 中断恢复（`recovery.ts`）：只识别「本任务自己的」落盘副作用；章节核对原始正文/位置/标题/章纲，文章核对待采用草稿与状态历史；其他依据变化则拒绝恢复。
- `service.status` 发现 `running` 但进程已不忙时，把记录改成 `paused` + `reason: interrupted`，提示「上次运行已中断，可从已保存阶段恢复」。
- 交付完成后记录进入 `awaiting-author`；作者「采用」规划/文章会写 `author-application` 阶段，确保不会重复应用。

### 8.9 面板与进度

- 每作品只允许一个活动 run；启动第二个 run 需要作者确认「开始新任务 / 保留上一任务」。
- 进度事件在 `publish` 里做 150ms 合并；终态立即发送；旧响应不能覆盖新快照。
- 写作流水线面板是非模态停靠面板：总览（状态/进度/耗时/用量/费用/预算）、阶段时间线、结构化产出、多稿对照、历史记录、连续性/个人规则页。

---

## 9. 番茄长篇业务认知

### 9.1 领域模型

| 对象 | 关键点 |
| --- | --- |
| `WorkMeta` | schemaVersion、key、title、genre、premise、pace（快爽/稳推/慢燃）、foundation、planning（book/volumes/acts）、revisionImpacts、continuity（working/finalized） |
| `Chapter` | id、title、position、status、body、outline（8 字段）、revision、review、dependencies |
| `ChapterStatus` | `planned → drafting → drafted → reviewed → final` |
| `Candidate` | id、chapterId、body、targetRevision、basis、lint token、editOf/unifyOf、draftLabel、variantGroup、revisionSource、acceptedAt |
| `Ledger` | 最近 1000 条操作留痕（kind、chapter、summary、at） |
| 连续性 | 结构化伏笔线/知情边界/章交接/commits；默认由 `continuity.enabled` 开关控制 |

**revision**：`sha256(JSON.stringify([body, outline, position]))`。标题、状态、审读字段不进 revision；改标题不升版，但汇编输出会变（已知语义边界）。

**状态机要点**：
- 正文变动且原为 `reviewed/final` → 降回 `drafted`。
- `reviewed` 必须带当前 `expectedRevision`；正文一改审读自动失效。
- `final` 必须：正文非空 + 当前 revision 的审读 `pass` + 上下文依据未变 + 前章已 `final`。
- 修改 `final` 正文必须 `force=true`：先保留原字节历史，再降回 `drafted`。

### 9.2 采纳事务

`candidate_accept` 在作品锁内：

1. 跑采纳策略（brief/lint/payoff/human-feel/novel-sense/edit 六类闸；默认软警告，显式 `strict_*` 才硬拒）。
2. 写入 4 个文件：`chapters/<id>.md`、`meta.json`、`candidates/<id>.json`（acceptedAt）、`ledger.json`；旧稿另存 `revisions/<id>/<hash>.md`。
3. 写 `.writer-accept-pending.json` 恢复日志（guard = 候选正文哈希）；失败/中断后可 inspect/resume。
4. 定稿前留轻量快照 `.writer-snapshots/`。
5. **采纳只写工作稿，不自动定稿**。

### 9.3 拆书库九步

`library_import → library_plan → library_dissect_brief → library_facts_stage → library_structure_stage → library_card_stage → library_card_accept → library_report → library_combo_suggest`

- Auto 默认约 10% 分层抽样；Full 必须先看成本回执并 `confirm_token`。
- 引文必须逐字落在来源原文；卡 v2 有 layer/dimension/readerWant/emotionArc/dramaticUnit/replaceables/mustNotCopy/transfer/failWhen/evidence 等校验。
- 拆书产物：`library/{sources,cards,candidates,analyses,index.json}`；写入走 source/plan/analysis/card/discard journal。
- 库是项目级参考资产，不训练模型，不自动覆盖方法或本书事实。

### 9.4 灵感规划

`inspire_start → forge_brief → stage → accept(apply=true)`：候选类型为 foundation / outline / book_plan / volume_plan / act_plan；只有显式 apply 才写作品；参考卡来自显式 `card_ids` 或作品绑定，不做题材猜测。

### 9.5 工具面

- 引擎约 59 个工具：works(12)、reference(1)、audit(6)、candidates(8)、continuity(5)、export(1)、system(3)、methods(3)、library(10)、analysis(4)、inspiration(5)。
- 写作层 7 个：`outline_check`、`ledger_check`、`library_scan`、`quote_check`、`review_report`、`review_get`、`profile`。
- 写手默认全量；`toolset.narrowed=true` 时剔除 16 个诊断/拆书写入工具；编辑只保留 18 个引擎只读/审计 + 6 个写作层工具；规划用 `PLANNER_TOOLS` 白名单。
- 门禁（全部 locked）：`fanqie.finalize_requires_author`、`fanqie.force_requires_author`、`fanqie.continuity_commit_requires_author`；收窄写手还会 deny `candidate_accept`/`candidate_edit_decide` 的旁路参数。

---

## 10. 今日头条业务认知

### 10.1 状态与数据

- 状态五值：`初稿待改 → 待验收 → 已验收 / 验收退回 → 已交稿`；`已交稿` 是终态，只能由作者确认。
- 打回最多 2 轮（`MAX_RETURN_ROUNDS=2`），第 3 轮起需作者同意。
- 数据布局：`<toutiao root>/log.csv`、`feedback.md`、`<id>/meta.json`、`立项卡.json`、`drafts/rev-001.md…`、`edits.json`、`交稿单.md`。
- 文章 id：`YYYY-MM-DD-slug`；草稿只增不改，带 revision + sha256 乐观锁。
- 交稿单自动追加固定末句：`——AI 到此止步。是否采用、何时发布由你决定。`

### 10.2 质检

- Python `rules.py` 是唯一规则源：`VERSION=4.0.0`、`TITLE_MAX=34`、词表/权重/篇幅档/母题。
- `qa_check.py` 六维：ai 24、read 16、title 16、detail 16、structure 14、compliance 18（权重 /104）；综合 `>=84`、零 fail、无硬闸才过线。
- 硬闸包括：非规范标点、标题数字正文没接住、未替换 `{xx}`、标题超 34 字、AI 身份泄漏、长图文延伸与主稿 8 字片段重合 ≥25%、立项卡不符等。
- 质检记录绑定 `rev + sha256 + card_sha256`；改稿或改卡后旧结果自动失效。

### 10.3 工具与门禁

共 21 个工具：方法/规则、热榜、文章创建/列表/详情、立项卡写入/预检、标题矩阵、草稿版本、S5 三联表、质检、状态流转、交稿单、台账、指标回流、反馈、方法方案。

门禁：

- `toutiao.deliver_requires_author`（locked）：置为「已交稿」必须作者确认。
- `toutiao.max_return_rounds`（可关）：第 3 轮打回需作者确认。
- 模式隔离：会话模式已定时拒绝另一模式工具。

### 10.4 方法方案

- 头条默认方案 30 个 id（与原版一一对应）：overview、s1-hot…s7-delivery、template-delivery、16 份语料。
- 长篇默认方案 17 个 id（由原 111 份 forge 原件合并提炼）：overview、plan-foundation、plan-structure、plan-outline、library、write-chapter/scene/prose/rhythm/continuity、platform、edit/revise、模板与案例。
- 方案目录：`<userData>/profiles/<mode>/{default,original,user-N}`；`active.json` 记当前方案；`writer.json` 的 `profile` 可钉死。
- 限制：每模式最多 20 个用户方案、每方案 300 份、单份 256KB、方案名 24 字。

---

## 11. 数据、写入与恢复协议

### 11.1 写作根布局

```text
写作根/
  novels/                 作品目录（桌面统一布局时作为 worksRoot）
  toutiao/                头条文章、台账、反馈
  .writer/                长篇引擎数据根（默认）
    works/<work-key>/     可由 worksRoot 单独指定
      meta.json
      chapters/<id>.md
      candidates/<id>.{md,json}
      revisions/<id>/<hash>.md
      ledger.json
      continuity/         伏笔、知情、交接、commits
      writer-reviews/<章 id>/*.json
      .writer-snapshots/
      .writer-*-pending.json
      .writer-write-lock/owner.json
    library/{sources,cards,candidates,analyses,index.json}
    inspiration/{sessions,candidates,bindings.json}
    manuscripts/
```

应用数据目录（userData）保存：模型配置、会话文件与指针、界面偏好、去敏日志、方法方案、流水线记录、个人规则、工作稿、未保存正文草稿（localStorage 明文，保存或放弃时清理）。

### 11.2 原子性与锁

- 所有关键写走 `atomicWrite`：临时文件 `wx` 创建 → 写入 → fsync → rename；Windows 对 EPERM/EACCES/EBUSY 最多重试 2 秒；POSIX rename 后 fsync 父目录。
- 路径写入拒绝符号链接祖先与链接资产；读路径用 `resolveRealInside` 防链接逃逸。
- 进程内用 `serialize(key)` 串行化同一资源的读改写；跨进程用目录锁：
  - 写作根/作品目录的 `.writer-workspace-lock.json`（owner: id/pid/machine/host/at）；
  - 作品内 `.writer-write-lock/owner.json`（写入互斥，10s 等待，超时报 `resource_locked`，不自动破锁）；
  - `.writer-workspace-claim` 登记目录用于崩溃自愈与接管。
- **原子替换不是跨文件事务**：多文件写入靠 journal 保留意图，恢复时核对 `before/after` 哈希；冲突则停止，不覆盖后续修改。

### 11.3 journal

`packages/fanqie/src/engine/storage/journal.ts` 统一 8 类多文件意图：章节采纳、章节/候选留痕、拆书分析、卡采纳、删卡、灵感应用、拆书计划、书源导入。每个 spec 声明固定目标、来源与守卫；恢复确认绑定 `{id, fingerprint}`。旧版 v1–v5 继续解码，新章节日志 `version:1 + kind`。

---

## 12. 安全与隐私

- **窗口**：`sandbox: true`、`contextIsolation: true`、`nodeIntegration: false`；导航只允许开发源或同一 `file://`；`window.open` 一律拒绝。
- **CSP**：生产环境写入 `index.html` meta；`script-src 'self'`，仅样式允许 `unsafe-inline`；开发环境由主进程下发放宽版。
- **IPC**：只接受主窗口主帧；每个通道在 `validate.ts` 解析；渲染层不能直接碰 Node。
- **只读保护**：主进程入口先按当前选中项目拒绝写作品 POST；带 `base`/`root` 指向另一项目的写请求，再由实际目标作品的存储层锁拒绝（D01 回归覆盖）。界面提供「接管」，接管会核对作者看到的锁 id。
- **路径**：工具入参 `working_dir` / 文件路径限制在作品根或指定根内；拆书导入限制 32 MiB。
- **密钥**：API Key 只以 `safeStorage` 密文落盘；不可用时只留内存并在界面提示；`publicModels` 抹掉明文。
- **日志**：诊断包对密钥、URL 凭据、Bearer/Basic 令牌统一打码；日志保留 7 天。
- **外网**：`network.ts` 只允许 http(s)、禁带登录信息、DNS 全部地址须公网、固定 DNS 防重绑定、2MB/20s 上限、6 次重定向。
- **发布**：`external` IPC 只接受 http/https；release 包暂未做 Windows 代码签名（README 已说明 SmartScreen 提示）。

---

## 13. 质量保障体系

### 13.1 测试分层

日常可先运行 `npm run test:quick`，提交前运行 `npm run verify`；桌面变更运行 `npm run verify:desktop`，完整发行检查用 `npm run test:all`。

| 层 | 命令/位置 | 覆盖 |
| --- | --- | --- |
| 类型/lint/格式/守卫/导出 | `npm run verify` 的 checks | tsc、eslint、格式化、架构守卫、番茄导出审计 |
| Python | `npm run test:py` / verify | 头条 QA、规则、台账、桥接、长篇 bridge |
| Node 单元/流程 | `test/*.test.mjs`、`test/engine/*`、`test/renderer/*` | `executeTool` 生产路径、路由处理函数、存储/恢复、组件状态流 |
| 桌面/PI | `test/desktop/*.test.mjs` | 真实 PI + 本地假模型；运行时、流水线、重试、退出、任务池 |
| GUI | `npm run test:desktop:ui` | Playwright 驱动真实 Electron，一条完整旅程（含无障碍断言） |

最近一次本地执行（2026-11-12，Linux）：Python 224 + 14 + 2；核心 Node 369（368 通过、1 项 Windows 专属跳过）；桌面运行时 131；GUI 1 条旅程。假模型是本地 OpenAI 兼容服务，支持工具调用、SSE、错误、截断、挂起与推理事件。

### 13.2 架构守卫

`scripts/architecture-guard.mjs` 检查：

- 依赖分层、包边界、PI 导入边界、渲染层访问边界、`BROWSER_SAFE`；
- 吞错（无 `allow-catch` 注明）、`any` / 非空断言（AST 计数，基线 1 / 0）；
- 组件前缀跨文件归属、文件行数提示；
- `tsconfig.jsx.json` 对 `packages/ui` 与 `packages/workbench` 的 21 个 JSX 做 `checkJs` 检查；`npm run typecheck` 同时跑 core、desktop、JSX 三套配置；
- 全仓退役包扫描、相对导入循环；
- 版本一致性：`package.json`、`apps/desktop/package.json`、`core/src/version.ts`、`CHANGELOG` 首个 `##` 标题首词。

### 13.3 CI 与发布

- `ci.yml`：`scope`（判断改动范围）→ `test`（Linux 跑 core）→ `desktop-ui`（Windows 跑桌面/PI、构建、GUI）；打包（NSIS/ZIP、随包 Python、`latest.yml`、`SHA256SUMS`）只在手动触发或标签时执行。纯文档推送不触发。
- `release.yml`：tag `v*` 或手动 dispatch；校验版本与校验和后**直接发布**（正式版成为 Latest，含 `-` 的 tag 标 prerelease）。不要用临时标签测试打包。
- 发布门槛：P0 全关、verify/test:desktop 全绿、守卫不退化、Windows 真机安装/升级/卸载手工回归、真实模型经济档实测。当前 Windows 真机与头条真实模型验收（RM02）未完成；番茄 RM01 已完成。

---

## 14. 当前状态与路线

版本、验证计数、真实模型实测与待办不在本文重复：当前状态见 [STATUS](STATUS.md)，未完成事项见[剩余事项](REMAINING-WORK-PLAN.md)。

**重要口径**：仓库自述的 token 节省、缓存命中、耗时下降多数是**结构估算或本地微基准**，不是真实服务商实测；不得据此宣称质量提升或费用下降。

---

## 15. 已知风险与技术债

> 分级：P0=可能产生错误行为/数据风险；P1=违反仓库规则或恢复/安全语义；P2=可维护性/一致性问题。以下为阅读发现，未全部修复。
>
> 2026-11-10 发版前审查新发现、排入 1.0.2 的问题（更新安装时的锁释放、父目录 fsync、切换文章失败释放锁根等）见[剩余事项第 3 节](REMAINING-WORK-PLAN.md#3-已知未修问题)。

### 15.1 数据与恢复

- **恢复错误码**：`journal.ts` 的 `finish()` 已保留 `NovelError` 原 code，只有未知故障归为 `recovery_required`；`read()` 的错误码仍依赖文件名分段。
- **连续性写入（M1 已收口）**：存储保存入口持作品资源锁，commit 复用章节 journal，统一写入伏笔、交接与提交记录；中断通过现有恢复入口接续。
- **版本语义（M2 已修）**：内容 revision 包含标题、正文、章纲和顺序；状态与审读通过独立 readVersion 参与作者操作核对。
- **`selectTarget` 初始化（M1 已修）**：先取得作品锁；只在可写时执行 `ensureStorage`，只读选择仍可登记到本机。保留创建空作品根目录用于取锁和 `realpath`。
- **工作流依据（M3 已收口）**：稳定材料和阶段材料共用指纹投影，目录状态与前章仍核对；无关后章正文不触发旧任务失效，自身交付识别保留。

### 15.2 安全与边界

- **IPC 请求目标（M1 已收口）**：`root/base/work` 归一到已登记目录及物理路径，拒绝未登记 root 与项目不一致；跨已登记项目操作保留，写入核对实际目标磁盘锁。
- **`learning-store` 写保护**：已改为按 `learn-pending.json` / 个人规则实际所在目录判断只读，番茄落在作品目录。
- **主进程错误码（M1 已修）**：主进程传输成功/错误回执，渲染端在 contextBridge 之后重建 Error，保留 name/message/code。

### 15.3 文档漂移

- 历史审查报告与旧交接单已从 `docs/` 移除，需要追溯时查 Git 历史；IPC 总数以 `apps/desktop/src/main/ipc/contract.ts` 为准（39 条）。
- `docs/engine/DATA.md` 的目录优先级保留引擎独立调用的解析顺序；桌面恒传 `storageRoot`，实际根由桌面目标决定。
- `docs/guides/FANQIE.md` 中「默认作品在 `D:/写作/novels`」只适用于统一写作根布局；是否成立取决于 `worksRoot` 项目登记。

### 15.4 业务规则与文案

- **84 分阈值/规则版本有多处副本**：`qa_check.py`、`brief.ts`、`tools.ts`、`SKILL.md`；`rules.py` 没有独立的 `PASS_SCORE` 常量。
- **状态词当逻辑用**（已修复）：`ToutiaoSide.jsx` 与 `quickActions.ts` 不再读展示文案判断状态，统一使用 `status.ts` 的 `TOUTIAO_DELIVERED` 常量。
- **屏显状态词漂移**（已修复）：`status.ts` 恢复显示「初稿待改」「验收退回」，与业务状态词一致。
- **头条六维/九项标尺多处重复**：`store.ts`、`tools.ts`、`ToutiaoSide.jsx` 各列一份。

### 15.5 代码整洁与死代码

- `useToutiao.js` 读取服务端从不返回的 `data.sessions`、`drawEnabled` 参数、`ArticleRow.createdAt` 与 `toBody` 均已删除。
- `api.ts` 的 body 上限在桌面 `ctx.body()` 里被忽略；`/projects` 忽略 `base/project`，与 `/works` 来源可能不同。
- 桌面测试已统一经 `test/desktop/python.mjs` 探测 Python 3.10+；`test:desktop` 已加载 `test/setup.mjs`；`test:desktop:ui` 已先构建再跑 GUI。
- `scripts/test.mjs` 统一测试分组；同一次完整检查复用核心编译、桌面测试准备与桌面构建。Linux 和 Windows CI 分别运行平台测试，静态检查在 Linux 执行。

### 15.6 守卫盲区

- 吞错检测只要错误变量被任何引用就放行（`catch(e){ console.error(e); return null }` 能过）；`.catch(命名函数)` 不检查。
- 组件前缀只取选择器第一个类名，且只扫三个目录；行数只提示不失败；`any` 不统计测试/脚本；版本只查 4 个文件；没有通用的「零引用导出/重复实现」规则（番茄另有专用审计）。

### 15.7 性能与成本

- 章节材料每阶段重新读取作品元数据/章节/连续性并做 JSON 序列化；已引入 2 秒新鲜度共享与 `fanqieDocument` 复用，但长书 IO 仍是主进程热点。
- 阶段卡缓存键不含作品数据（有意为之），但方法依赖注入（如 `s4-news` 需要 `s4-common`）尚未在流水线阶段卡中合并，属于质量问题。
- 读者擂台是 O(候选数 × 画像 × 2) 调用；标准档黄金章 5 稿 × 3 画像 × 2 位置 = 24 票/挑战者，成本较高；整体排序替代方案已在审查报告中提出，尚未实施。
- 修订类阶段仍要求模型输出全文，token 成本较高；结构化 edits 方案尚未实施。

---

## 16. 新人上手路径

### 16.1 建议阅读顺序

1. `AGENTS.md`：仓库约定。
2. `docs/PROJECT-COGNITION.md`（本文）：全局地图。
3. `packages/core/src/{tool,execute,gates,fsx,workflow,workflow-config}.ts`：执行、门禁、持久化、流水线底座。
4. `apps/desktop/src/workflow/{service,run,stage-model,context,chapter,article,editor}.ts`：核心流水线。
5. `apps/desktop/src/main/{lifecycle,targets,operations}.ts` + `main/ipc/{contract,validate,register}.ts` + `preload.ts` + `desktop-api.ts`：启动、IPC、RPC。
6. `packages/fanqie/src/engine/{storage,domain,services,tools}` 与 `packages/toutiao/src/{store,tools,gates}.ts`：业务规则。
7. `packages/workbench/src/commands.ts` + `client/`：写作台契约与组件。
8. `test/desktop/workflow.test.mjs` + `test/desktop/fake-model.mjs`：流水线如何被验证。

### 16.2 常用命令

```bash
npm ci
npm run desktop:dev
npm run verify            # 守卫 + Python + Node 业务回归
npm run typecheck
npm run lint
npm run test:desktop      # 真实 PI + 本地假模型
npm run test:desktop:ui   # Playwright + Electron（需要显示环境）
npm run desktop:build
npm run assets -- check
```

### 16.3 改动落点速查

| 要改什么 | 去哪里 |
| --- | --- |
| 新增模型工具 | `packages/*/src/tools.ts` 或 `engine/tools/`；在 `create.ts` 按角色装配；补门禁与测试 |
| 新增 IPC 通道 | `main/ipc/contract.ts`（IpcMap + IPC_PARSERS）→ `validate.ts` → `register*.ts` → `desktop-api.ts`（preload 使用统一桥） |
| 新增写作台操作 | `packages/workbench/src/commands.ts` COMMANDS → 业务包 `workbench/api.ts` 命令 → 适配器 |
| 新增流水线阶段 | `workflow/<pipeline>.ts` 用 `run.model(id, ...)`；id 加入阶段表；确保 `parse` 能恢复、交付幂等 |
| 改业务阈值 | 先改 Python `rules.py`（唯一源），再核对 TS 引用；不得直接改文档或常量副本 |
| 加测试 | 业务经 `executeTool`/路由；桌面经假模型；界面经 Playwright 现有旅程 |

### 16.4 不要做的事

- 不要改 `packages/*/skill/` 方法原文；不要改质检阈值/标题上限/两轮打回/固定末句。
- 不要新增运行时依赖或改锁定版本（除非作者同意）。
- 不要用空 catch 吞错；不要在边界内重复校验；不要为测试在生产代码加分支。
- 不要把对话里的「完成」当作落盘成功；不要跳过版本/哈希核对。
- 不要在未授权时调用真实模型、发版或打 tag。

---

## 17. 术语表

| 术语 | 含义 |
| --- | --- |
| 作品（work） | 番茄的一本书，对应 `works/<key>/` |
| 章（chapter） | 作品内一章，`chapters/<id>.md`，含 front matter 与正文 |
| 候选（candidate） | 可比较、可采纳但尚未替换当前正文的一份稿 |
| 采纳（accept） | 把候选写成当前工作稿；不等于定稿 |
| 审读（review） | 编辑/读者对某一版正文的结构化意见，绑定正文哈希与 revision |
| 定稿（final） | 作者确认保留的当前叙事版本；需审读通过、依据未变、前章 final |
| basis | 任务开始时读到的作品依据指纹，用于恢复时判断是否还能套用旧进度 |
| 阶段卡（stage card） | 把方法原文压缩成规则卡，按方法+提示+格式+规划模型缓存 |
| 门禁（gate） | 工具执行前的 deny/ask 规则；ask 由作者确认 |
| journal | 多文件写入的恢复日志，记录目标、前后哈希、守卫 |
| guided | 调度员模式：对话 + 流水线，不让主会话直接写长文 |
| 台账 | 头条 `log.csv`，记录发稿与平台回流数据 |
| lean/full 简报 | 章节简报的两种材料厚度；lean 默认只带 craft+状态+前章 |
| 拆书库 | 项目级参考资产库，保存来源、分析、卡与报告 |
| 灵感（inspire） | 原创规划会话，产出根基/全书/卷/幕/章纲候选 |

---

## 18. 认知边界

**已直接验证（主代理逐行阅读/运行路径核对）**

- 执行链：`defineWriterTool` → `executeTool` → `GateEngine` → 作者确认 → 工具执行。
- 流水线：`WorkflowService` → `WorkflowRun.model` → `contextPacket` → `stageModel` → `WorkflowJournal`；章节/文章/规划/记账四条链。
- IPC：39 条通道清单、解析器、preload 映射、`writer:request` 分发与只读保护。
- 会话：PI 适配边界、guided 工具面、主/子会话、任务追踪、自动记账队列。
- 业务规则：头条五状态/84 分/34 字/两轮打回/固定末句；番茄五状态/revision/定稿门禁/采纳事务。
- 存储：原子写、目录锁、journal、快照、草稿、备份脚本。

**子代理通读后汇总（未逐行复核）**

- `fanqie` 的 40 个端口文件与拆书/灵感细节；`toutiao` Python 质检的逐条扣分；`workbench` 组件内部状态流；`apps/desktop/renderer` 的多数功能组件；测试与脚本的逐文件清单。文中相关结论已尽量标注路径，但行号可能随提交漂移。

**未验证/需要外部条件**

- 真实模型：RM01 番茄一章已跑通；RM02 头条未完成（无 Python 质检、无采用），不能宣称头条真实模型验收通过；费用与质量只按已发生的单次实测记录，不外推。
- Windows 真机安装、从 0.9.9 升级、卸载、Alt+F4/任务栏关闭、全屏观感：未执行。Electron 45 已通过 Windows CI，安装包未在真机验证。
- 评分规则调整（T134）未实施。
- PI SDK 的 auth.json 是否落盘明文凭据：由 SDK 决定，本仓库只传路径，未验证其内部行为。

---

## 附录 A：IPC 通道（39 条）

工作区：`state`、`choose`、`workspace`、`projects`、`new-target`、`take-over-workspace`、`external`
会话：`select`、`view`、`running`、`send`、`stop`、`new-conversation`、`conversations`、`context-usage`、`compact`、`context-settings`、`request`
模型/设置：`model`、`model-catalog`、`test-model`、`appearance`、`preferences`、`save-preferences`、`test-search`、`search`
流水线/连续性：`workflow`、`workflow-history`、`continuity`、`learning`、`engine`、`writer-options`
资源/维护：`export`、`backup`、`storage-health`、`recover`、`diagnostics`、`updates`、`library-storage`

## 附录 B：写作台路由（19 条）

操作所属模式、读写范围和变更通知在 `packages/workbench/src/commands.ts` 集中声明；方法方案命令由同一契约生成。

`/projects`、`/snapshot`、`/chapter`、`/chapter/save`、`/chapter/review`、`/chapter/finalize`、`/candidate`、`/diagnostics/scan`、`/diagnostics/stage`、`/candidate/accept`、`/revision/acknowledge`、`/unify/prepare`、`/diagnostics/capabilities`、`/agent/deliver`、`/toutiao/articles`、`/toutiao/article`、`/toutiao/adopt`、`/toutiao/draft`、`/toutiao/agent/deliver`

## 附录 C：关键文件索引

| 关注点 | 文件 |
| --- | --- |
| 工具执行/门禁 | `packages/core/src/{tool,execute,gates}.ts` |
| 原子写/路径沙箱 | `packages/core/src/fsx.ts` |
| 通用 journal/预算/用量 | `packages/core/src/{workflow,workflow-config}.ts` |
| 作品锁 | `packages/core/src/workspace-lock.ts` |
| 方法方案 | `packages/core/src/{profiles,method-pack,profile-tool}.ts` |
| 方法资产 | `packages/*/profiles/default`、`packages/*/skill/`、`assets/manifest.json` |
| 番茄领域模型 | `packages/fanqie/src/engine/domain/` |
| 番茄存储/恢复 | `packages/fanqie/src/engine/storage/` |
| 番茄采纳/简报/诊断 | `packages/fanqie/src/engine/services/` |
| 番茄端口/拆书/灵感 | `packages/fanqie/src/engine/ports/` |
| 番茄工具 | `packages/fanqie/src/engine/tools/` + `packages/fanqie/src/tools.ts` |
| 番茄写作台 | `packages/fanqie/src/workbench/` |
| 头条业务 | `packages/toutiao/src/` + `packages/toutiao/skill/scripts/` |
| 写作台契约 | `packages/workbench/src/commands.ts` |
| 写作区组件 | `packages/workbench/src/client/` |
| 设计系统 | `packages/ui/src/` |
| 流水线 | `apps/desktop/src/workflow/` |
| 主进程/生命周期 | `apps/desktop/src/main/` |
| IPC | `apps/desktop/src/main/ipc/` + `apps/desktop/src/preload.ts` |
| 会话/PI | `apps/desktop/src/session/` |
| 渲染层 | `apps/desktop/src/renderer/` |
| 测试 | `test/` |
| 守卫/脚本/CI | `scripts/`、`.github/workflows/` |
