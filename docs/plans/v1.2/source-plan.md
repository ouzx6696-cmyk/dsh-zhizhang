# 织章（dsh-zhizhang）v1.2 全面重构计划与代码体检报告

> **基线版本**：`1.1.1`（Electron 45.2.3 / Node 24+ / React 18 / TypeScript 5.8 / PI SDK 1.4.0 / Python 3.10+）  
> **重构原则**：项目尚处开发阶段，**v1.2 不考虑任何旧版本数据、配置或接口向后兼容**；严格保留核心写作业务口径（头条标题 ≤34 字、质检 ≥84 分过线、编辑两轮打回、交稿固定末句、作者最终裁判权）。

---

## 一、项目认知基线与整体架构盘点

### 1.1 项目定位与核心价值
**织章（Writer Agent）** 是一款**本地优先（Local-First）的中文写作桌面客户端**，服务于「番茄长篇网文」与「今日头条图文」两类创作者。其核心工程哲学是：**「模型只填内容，代码负责编排、校验、落盘与门禁，作者始终是最终裁判」**。

- **无 HTTP 服务、无数据库**：所有作品、草稿、审读、质检、台账与流水线日志均以文件形式落盘在本地写作根（`novels/`、`toutiao/`、`.writer/`）与 `userData` 中。
- **双引擎共骨**：底层共享原子写、文件锁、门禁、方法方案、Python 运行器与通用工作流日志；上层分别驱动番茄长篇（立项/根基 → 章纲 → 多稿擂台 → 审读修订 → 定稿记账/十章巡检）与今日头条（S1 找题 → S2 立项 → S3 标题 → S4 成文 → S5 红笔 → S6 质检硬闸 → S7 交稿）。

### 1.2 全仓模块规模与职责矩阵

| 模块路径 | 代码文件数 | 代码行数 | 当前核心职责 | 核心痛点摘要 |
| --- | ---: | ---: | --- | --- |
| `packages/core` | 20 | 3,205 | 工具执行、门禁、原子写、锁、方案、Python 运行器、工作流日志 | 反向耦合上层业务工具名与策略；门禁三段式令牌过度设计；缺少 `package.json` |
| `packages/fanqie` | 177 | 25,568 | 长篇引擎（domain/storage/services/tools）、写作层、工作台 API、Python 文风脚本 | **全仓最大膨胀源**：`ports/` 越界成巨型实现、64 个工具碎片化、`continuity` 缺锁 |
| `packages/toutiao` | 19 | 5,607 | 头条 21 个工具、状态机、台账、Python 质检脚本（`rules.py`/`qa_check.py`） | 84 分/六维/九项标尺多处重复硬编码；Python 每次冷启动；旧版 3.x 兼容残留 |
| `packages/workbench` | 38 | 6,924 | 伪 HTTP 路由契约、桌面适配器、写作区 React 组件（`.jsx`/`.js`） | 伪 HTTP (`app://writer`) 过度抽象；`.jsx` 未开 `strict`；隐藏死分支（`hideAgent`） |
| `packages/ui` | 9 | 1,718 | 设计令牌（`--ui-*`）、基础原语、共享文案与状态映射 | 与 `workbench` 的 `--wb-*` 令牌双轨冲突；部分 `.jsx` 混用 |
| `apps/desktop/src/main` | 24 | 1,960 | Electron 生命周期、窗口、IPC 契约与校验、工作区锁选择、SSRF 防护 | `selectTarget` 先写后判只读；跨 IPC 丢 `WriterError.code`；`writer:request` 信任 `root` |
| `apps/desktop/src/session` | 24 | 4,380 | PI SDK 适配、会话管理、工具包装、任务追踪、抽卡、改稿学习 | `guided` 与自由模式分支耦合；并发抽卡 `children` 仅存单值；Prompt 顺序毁缓存 |
| `apps/desktop/src/workflow` | 24 | 3,934 | 章节/文章/全书/记账流水线、读者擂台、阶段模型调用、恢复与采用 | `basis` 过宽误杀；擂台调用量 `O(N*R*2)`；全文重写修订；经济档未减阶段 |
| `apps/desktop/src/renderer` | 50 | 7,088 | 桌面外壳、`desktopStore`/`chatStore`、流水线停靠面板、设置与对话框 | 四套状态源双写镜像；快速切换作品/归档存在迟到响应竞态；重复拉取快照 |
| `scripts/` | 16 | 1,692 | 架构守卫、导出审计、构建打包脚本、测试调度 | 手写 484 行守卫模拟包边界；与多套 `tsconfig` 耦合 |
| `test/` + `skill/tests/` | 49+3 | 21,142 | 单元、引擎、桌面运行时、Playwright UI、Python 测试 | **4 轮重复编译**；v1–v5 历史夹具与开关测试堆积；4 个巨型单文件近万行 |

---

## 二、全量重构级体检：关键缺陷与技术债清单

### 2.1 P0 级：安全边界、数据一致性与并发缺陷（必须优先修复）

1. **主进程只读保护错位与 `selectTarget` 锁前预写**
   - **位置**：`apps/desktop/src/main/targets.ts:58-71`、`apps/desktop/src/main/operations.ts:192`
   - **问题**：`selectTarget` 在取得 `claimWorkspace(newRoot)` 后未先校验 `access.readOnly`，即执行 `ensureStorage`、`migrateInspirationBindings`、`rememberProject` 等写操作；`operations.ts` 检查当前全局 `state.access.readOnly` 而非请求目标工作区的真实锁状态；且非 `writer:request` 通道（`ipc/session.ts`、`ipc/workflow.ts`、`ipc/library.ts`、`ipc/backup.ts`）均未做只读拦截。
2. **`writer:request` 信任边界漏洞与 `ctx.body(limit)` 静默失效**
   - **位置**：`apps/desktop/src/main/operations.ts:38-68, 128-130`、`apps/desktop/src/main/ipc/validate.ts:89-97`
   - **问题**：渲染层省略 `base` 直接传 `body.root` / `query.root` 时，主进程未经登记校验与 `realpath` 归一化即直接放行；同时 `operations.ts` 中 `async body()` 忽略了各路由传入的 `limit` 参数，导致 413 负载上限保护完全失效。
3. **跨 IPC 丢失结构化错误码 `WriterError.code`**
   - **位置**：`apps/desktop/src/main/ipc/handle.ts:23-26`、`apps/desktop/src/main/ipc/models.ts:32`
   - **问题**：Electron 跨进程序列化会剥离自定义错误属性，约 35 个非 `writer:request` 通道无法向渲染层传递 `NOT_FOUND`、`CONFLICT` 等精准错误码。
4. **番茄连续性存储缺少资源锁与多文件事务保护**
   - **位置**：`packages/fanqie/src/engine/storage/continuity.ts:113-187`、`packages/fanqie/src/engine/tools/continuity.ts:472-478`
   - **问题**：`saveForeshadow` / `saveKnowledge` / `saveCommits` / `saveHandoff` 内部未持 `withResourceLock`；`fanqie_continuity_commit` 顺序写 3 个文件无 `journal` 保护，中途失败会导致三态撕裂。
5. **`chapterRevision` 遗漏 `title` 与 `status` 引发乐观锁盲区**
   - **位置**：`packages/fanqie/src/engine/storage/revision.ts:9-11`
   - **问题**：改标题或改状态（如 `drafted → final`）不改变 `revision`，导致 `expectedRevision` 乐观锁与 `review.revision` 绑定失效。
6. **并发抽卡子会话无法全部级联中止**
   - **位置**：`apps/desktop/src/session/manager.ts:44, 341`、`apps/desktop/src/session/draw-task.ts:31, 63-68`
   - **问题**：`Sessions.children` 为 `1:1` Map，但 `DRAW_CONCURRENCY = 2` 并发启动多个子会话时后者覆盖前者，导致 `stop()` 仅中止最后一个子会话。

### 2.2 P1 级：架构耦合、性能与成本瓶颈

1. **伪工程化 Monorepo 与三套割裂的 `tsconfig`**
   - `packages/*` 无 `package.json`，依赖深层相对路径导入，迫使维护 `tsconfig.json`、`tsconfig.jsx.json`、`apps/desktop/tsconfig.json` 及 484 行 `scripts/architecture-guard.mjs`（且守卫存在动态导入、未做浏览器安全传递闭包检查、吞错绕过等盲区）。
2. **`packages/core` 反向依赖上层业务**
   - `tool-roles.ts`、`method-pack.ts`、`profiles.ts` 硬编码了 `fanqie_*` / `toutiao_*` 工具名与决策表，破坏底层纯洁性；`gates.ts` + `execute.ts` 为同进程单次异步闭环维护了 30 分钟 TTL 的三段式令牌状态机。
3. **`packages/fanqie` 严重膨胀（177 文件 / 25,568 行）**
   - `engine/ports/` 膨胀至 7,605 行（实质承担存储与业务）；`engine/tools/` 55 个文件一工具一文件；`src/` 写作层与 `src/engine/` 平行造轮子；`panel-query.ts:128-134` 每次刷新无上限并发全量读取全书所有章节正文，形成长书 I/O 热点。
4. **流水线引擎成本与脆弱性问题**
   - **全局 `basis` 过宽**：`workflow/context.ts:124-146, 285-290` 将整本书的 `foundation`、`planning`、全量连续性塞入 `basis`，作者微调后续无关卷纲即中断当前章运行。
   - **读者擂台高调用量**：`workflow/editor.ts:40-128` 为 `(N-1) × |readers| × 2`，黄金前三章 `premium` 档（8 稿×5 画像×2 位）单次选稿高达 **70 次**模型调用。
   - **全量重写修订**：`editor.ts:197`、`article.ts:207`、`article-qa.ts:102` 均要求模型输出完整正文，Token 成本高且易触发截断。
   - **头条经济档未裁剪阶段 & `s4-news` 缺依赖注入**：`article.ts:152` 仅减起稿数不减后续 10 余阶段；`methods.ts` 不支持方法卡依赖，导致 `s4-news` 漏注 `s4-common`。
   - **Prompt 顺序破坏 KV Cache**：`session/prompt.ts:342-354` 将动态 `<writer-context>` 置于长达 36KB 的静态 `<writer-method>` 之前，导致 Prefix Cache 频繁失效。
5. **跨语言规则未真正单一来源 & Python 进程冷启动**
   - `84` 分过线阈值、六维权重、九项读者标尺在 Python `rules.py` 与 TS `store.ts`、`tools.ts`、`brief.ts`、`ToutiaoSide.jsx` 重复定义；`manuscript_linter.py:211` 依赖脆弱下标 `PRIMARY_RULES[6]`；Node-Python 每次调用均冷启动新进程（热榜抓包甚至二次 `subprocess` 套娃）。
6. **前端伪 HTTP 抽象、四套状态源与迟到响应竞态**
   - 无 HTTP 服务却维护 `routes.ts`、`app://writer`、`ctx.body()`、`status` 4xx/5xx 往返，导致所有适配器返回值退化为 `Promise<Json>`。
   - `desktopStore`、`chatStore`、Controller Refs、`useFanqie`/`useToutiao` 四层状态双向同步，存在 `selectSnapshot`、`loadView`、`useToutiao`、`PersonalPane` 的迟到响应覆盖竞态，以及切 `view` / `TaskForm` 的重复快照请求。

### 2.3 P2 级：v1.2 可直接删除的历史包袱与死代码清单

由于 v1.2 无需考虑向后兼容，以下历史包袱可整体移除（预计直接削减 **8,000+ 行**业务与测试冗余代码）：

| 模块 | 可直接删除的兼容/死代码目标 |
| --- | --- |
| **`packages/core`** | `workflow.ts:78-99` (`LEGACY_REASONS`)；`workflow-config.ts:59-64` (`engineVersion`)；`profiles.ts:364-365` (`nameConflict`)；`workspace-lock.ts:346-376` (`cleanStaleWorkspaceClaim` 空目录兼容)；`diagnostics.ts:43-53` (非 JSON 行降级)；`fsx.ts:18` 二次透传 |
| **`apps/desktop/main`** | `settings.ts:60-81, 100-137` (`engineVersion`/单模型结构/`tavily` 隐式迁移)；`targets.ts:66` (`migrateInspirationBindings`)；`operations.ts:33-37, 162-167` 多字段兼容；`ipc/workflow.ts:74` (`continuity.migrate`) |
| **`apps/desktop/session`** | `migration.ts` 全文件（会话历史迁移）；`manager.ts:95-97` (`initialize`)；`prompt.ts:95-199` (`taskPromptV1` 与 `handoff.v2` 开关)；`task-methods.ts:29-51`；`create.ts:132-170`（`continuity.enabled` / `multiDraft.enabled` / `draw.enabled` / `learn.enabled` / `creationFirst` / `perChapter` 等已固化开关） |
| **`apps/desktop/workflow`** | `continuity-migration.ts` 全文件；`recovery.ts` 逆向剥离交付逻辑；`service.ts:202-216` 旧 Journal 状态修补；`book.ts:11-17` 反序列化 `basis` |
| **`packages/fanqie`** | `storage/chapter-journal.ts:8-31`（v1–v5 兼容）；`storage/inspiration-migration.ts` 全文件；`domain/card-schema.ts:139-175`（v1 卡兼容）；`ports/library/schema.ts:66-152`（legacy 迁移）；`tools/continuity.ts:600-676`（`fanqie_continuity_migrate`）；`workbench/paths.ts` 旧 `last-root` 双轨；已被 `AcceptPolicy` 内嵌的 3 个冗余审计旁路工具 |
| **`packages/toutiao`** | `rules.py:87-90, 176-198`（`MODE_ALIAS`、`快图文`/`深图文`、`LEDGER_FIELDS_V3`、`line_of` 推断）；`writer_bridge.py:105-113`（`_capture` 死代码）及 `legacy` 标题回退；`store.ts:443-445` 旧反馈行式兼容；`config.ts:26-29` (`revision.strict` 开关) |
| **`workbench` & `ui`** | `Inspector.jsx`、`ToutiaoSide.jsx`、`common.jsx` 中 `hideAgent` 后的旧版 Agent 投递死分支；`fanqie/actions.js:111-139` (`deliver`)；`workbench/src/client/shared/ui.jsx:136-254` 手写 SVG `ICONS`；`styles/base.css` 的 `--wb-*` 覆盖层 |

---

## 三、v1.2 目标架构重构蓝图

结合 TypeScript Agentic Workflow（参考 [Mastra](https://mastra.ai/)、[Vercel eve](https://www.firecrawl.dev/blog/best-open-source-agent-frameworks) 的显式工作流检查点与工具边界理念）及三层小说上下文工程实践（参考 [Novel-OS](https://www.reddit.com/r/ClaudeCode/comments/1mttiil/introducing_novelos_an_opensource_system_that/)），v1.2 采用以下六大架构升级：

1. **标准 npm Workspaces + TS Project References**
   - 根 `package.json` 声明 `"workspaces": ["apps/*", "packages/*"]`，为 5 个子包补齐 `package.json` 与 `"exports"`（严格区分 `@writer/core` 与 `@writer/core/browser`）。
   - 启用 TS `composite` Project References（`tsc -b` 一步增量检查与构建），删除 `tsconfig.jsx.json` 并全面 TSX 化；引入 `eslint-plugin-boundaries` + `Knip` 替代 80% 手工正则守卫，仅保留业务专属校验。
2. **强类型 RPC Action 替代伪 HTTP 路由**
   - 废弃 `routes.ts`、`app://writer` 与 `ctx.body()`，在 `@writer/workbench` 建立 `RpcContract`（`action -> { input, output, mutatesWork }`）。
   - 主进程 `handle.ts` 统一捕获 `WriterError` / `NovelError` 并结构化透传 `{ ok, code, error }`，彻底禁止渲染层传入任意 `root` 路径，写通道统一执行先验锁后初始化的实时 `readOnly` 守卫。
3. **声明式 DAG 流水线引擎 + 节点级输入指纹**
   - 引入 `PipelineGraph` + `StageNode` 替代过程式 `chapter.ts`/`article.ts`：
     - **节点级 `inputHash`**：废弃全量 `basis`，仅对节点实际消费的切片计算哈希，支持作者安全并行编辑其他章节。
     - **结构化局部 Edits**：修订阶段统一输出 `{ edits: [{ quote, replacement, reason }] }`，由确定性代码 `locate` 替换，消除全文输出与截断失败。
     - **擂台降本与经济档真裁剪**：`economy` 档跳过 `blueprint`、多余审修与擂台；`standard`/`premium` 改用「单轮多维打分 + Top-2 双盲正反决胜」，将 8 稿 `premium` 调用量从 70 次降至 ~18 次。
     - **方法卡依赖图**：在 `methods.ts` 声明 `requires`（如 `s4-news -> ["s4-common"]`），自动拓扑注入；调整 Session Prompt 为静态方法前缀在前、动态上下文在后。
4. **`packages/fanqie` 深度瘦身（目标削减 35%–45% 代码与文件数）**
   - 解散膨胀的 `engine/ports/`，存储归 `storage/`、业务归 `services/`；合并 `src/*.ts` 写作层与 `engine/` 双入口；8 个 `*-journal.ts` 收敛为单一声明式 `journals.ts`。
   - 64 个工具按资源+`action` 合并至 ~25–30 个；将 `withResourceLock` 与多文件 `journal` 下沉至 `storage/continuity.ts`；修正 `chapterRevision` 纳入 `title` 与 `status`；`continuityPatrol` 改用滑动窗口与增量缓存。
5. **跨语言规则单一来源与 Python 常驻/统一协议**
   - 在 `packages/toutiao/skill/scripts/rules.py` 导出完整 `PASS_SCORE=84`、`STOP_LINE`、`QA_DIMS`、`READER_RUBRIC`、`STATUSES`、`LEDGER_METRIC_MAP`，通过 `limits` 一次性下发 TS 与前端消费。
   - `manuscript_linter.py` 使用具名规则 ID 替代 `PRIMARY_RULES[6]`；Node-Python 统一改用 `stdin` JSON 传参（消除 argv 32KB 风险），`hot` 子命令取消二次 `subprocess`，并支持长生命周期 JSON-RPC worker 模式以消除高频质检冷启动。
6. **全面 TSX + 单一 UI 令牌与统一工作区 Store**
   - `packages/ui` 与 `packages/workbench` 全量迁为 `.ts/.tsx`（`strict: true`）；废弃 `--wb-*` 双令牌与手写 SVG 图标，统一使用 `--ui-*` 与 `lucide-react`。
   - 收敛渲染层四套状态源，消除 `onTarget`/`onContext` 双向回传及重复快照拉取，为所有异步请求统一增加请求代数与 `AbortSignal` 守卫。

---

## 四、v1.2 全新精简高效测试体系方案

参考业界 Electron + Vite + React 现代测试分层实践（[Testing in 2026: Vitest + RTL + Playwright](https://www.nucamp.co/blog/testing-in-2026-jest-react-testing-library-and-full-stack-testing-strategies)、[vite-electron-test 架构](https://github.com/kkerti/vite-electron-test) 与 [Accomplish 测试策略](https://deepwiki.com/accomplish-ai/accomplish/9-testing-strategy)），彻底淘汰当前「`tsc`×3 + `esbuild`×2 + 手写 `runtime.mjs` + `node --test` + 串行 Python」的异构链路，建立 **Vitest + Playwright + pytest** 三层金字塔：

### 4.1 工具链升级与「删、并、留」全量清单

| 层级 | 工具与运行方式 | 核心改造动作 |
| --- | --- | --- |
| **静态门禁** | `tsc -b` + `eslint` + `prettier` + `guard` + `knip` | **全流程仅执行 1 次**，彻底消除 `test:node`、`test:desktop`、`desktop:build` 中的 3 轮重复 `tsc` |
| **L1 单元与集成** | **Vitest**（内置 esbuild 直跑 `.ts`/`.tsx` + `jsdom` + `@testing-library/react`） | **直接删除**：`build-test-components.mjs`、`build-desktop-test.mjs`、`test/engine/runtime.mjs`、`components.jsx`、`entry.ts`、`runtime-effects.ts`、`channel.test.mjs`、`test/fixtures/journals/chapter-v1..v5.json` 及所有旧开关/源码正则断言测试。<br>**合并重组**：将 33 个 JS 测试文件按领域整合为 **~14 个高质量 `.test.ts/.tsx` 文件**（拆分 `runtime.test.mjs` 4,477 行与 `workflow.test.mjs` 2,528 行，合并 <70 行的碎片文件）。<br>**补齐盲区**：新增 `desktop-ipc.test.ts`（14 个 IPC Handler 边界与错误码透传）、`core-fs-lock.test.ts`（多进程抢锁/续租压测）、`renderer-features.test.tsx`（快捷键/草稿防丢失/弹窗）。 |
| **L2 桌面 E2E** | **Playwright (`@playwright/test`)** | 将 993 行单文件串行 `ui.spec.mjs` 拆分为 **3 个独立冒烟 Spec**（`smoke-fanqie.spec.ts`、`smoke-toutiao.spec.ts`、`smoke-settings-cancel.spec.ts`），复用 `fake-model` 驱动真实 Electron 打包产物，失败隔离。 |
| **L3 Python 质检** | **pytest**（`pytest -q packages/*/skill/tests`） | 替代 `scripts/test-python.mjs` 的串行 `spawnSync` 循环，单进程并行发现并执行全部 Python 测试。 |

### 4.2 精简效果与 CI 收益对比

| 指标 | 现状（v1.x） | v1.2 目标体系 | 预期优化幅度 |
| --- | --- | --- | --- |
| **测试文件数** | 49 个（`test/`）+ 3 个（`.py`） | ~17 个（`test/`）+ 3 个（`.py`） | **减少 ~62%** |
| **测试代码总量** | ~21,142 行 | ~9,500–11,000 行 | **精简 ~48%–55%** |
| **单测前编译轮次** | 4 轮（`tsc`×3 + `esbuild`×2 + `vite`） | **0 轮预编译**（Vitest 直跑源码；仅 E2E 跑 `desktop:build`） | **消除 100% 单测预编译耗时** |
| **CI 流水线（`ci.yml`）** | `test` 与 `desktop-ui` 重复执行 `core` | Ubuntu 跑 `checks + vitest + pytest`；Windows **仅跑 `desktop:build` + Playwright 冒烟** | **总 CI 时长预计缩短 45%–60%** |

---

## 五、v1.2 分阶段重构实施路线图

| 阶段 | 核心目标 | 关键改造任务 | 阶段验收标准 |
| --- | --- | --- | --- |
| **Phase 0：工程底座与新测试基建** | 打通 Workspaces、TS 编译链与 Vitest/pytest，移除旧兼容测试 | 1. 补齐 `packages/*/package.json` 与 `workspaces`，切至 `tsc -b`。<br>2. 引入 `vitest` + `pytest`，迁移首批核心单测并删除 `build-*-test.mjs`、`runtime.mjs` 与 `v1–v5` 夹具。<br>3. 清理 `ci.yml` Windows Job 的重复 `core` 步骤。 | `tsc -b`、`vitest`、`pytest` 全绿，单测无需预编译即可秒级反馈。 |
| **Phase 1：安全边界、IPC 与数据锁加固（P0）** | 消除只读越权、路径信任漏洞、错误码丢失与并发写撕裂 | 1. 重构 `targets.ts` 先验锁后初始化；收紧 `operations.ts` 禁止外部 `root` 与实装 `ctx.body(limit)`；全写通道接入实时只读守卫。<br>2. `handle.ts` + `preload.ts` 统一结构化错误透传。<br>3. `continuity.ts` 补齐 `withResourceLock` 与事务 journal；修正 `chapterRevision`；修复 `Sessions.children` 为 `Set`。 | `desktop-ipc.test.ts` 与 `core-fs-lock.test.ts` 并发压测通过；`WriterError.code` 跨进程完整保留。 |
| **Phase 2：包瘦身与规则单一来源（P1）** | 削减 `packages/fanqie` 40% 冗余，清理 `core`/`toutiao` 历史包袱 | 1. 剥离 `core` 的上层业务依赖，简化 `gates.ts` 三段式令牌。<br>2. 解散 `fanqie/engine/ports/`，合并写作层与 `engine/`，tools 64→~28；`continuityPatrol` 改滑动窗口。<br>3. `rules.py` 导出完整规则元数据，`manuscript_linter.py` 去下标依赖，Python 桥接统一 `stdin` JSON。 | 业务包净减 35%+ 代码；跨语言规则无重复常量；全部历史兼容分支归零。 |
| **Phase 3：DAG 流水线引擎与会话重构（P1）** | 实现节点级断点恢复、结构化局部修订与提示词缓存对齐 | 1. 引入 `PipelineGraph` 替代过程式 `chapter.ts`/`article.ts`，切分节点级 `inputHash`。<br>2. 修订阶段改结构化 `edits` 补丁；落地擂台 Top-2 决胜与经济档阶段裁剪；实现 `methods.ts` 依赖注入。<br>3. 拆分 `session/create.ts` 调度与自由模式，调换 `promptText` 静态方法前缀顺序。 | 章节与文章流水线在 `fake-model` 下调用次数与 Token 估算显著下降；修改无关章不中断运行。 |
| **Phase 4：全量 TSX、RPC Action 与前端收敛（P2）** | 消灭伪 HTTP 抽象与 JSX 混合状态，补全 UI 交互测试 | 1. `routes.ts` 替换为 `RpcContract` 强类型 RPC，消灭 `Promise<Json>`。<br>2. `packages/ui` 与 `packages/workbench` 全量转 `.ts/.tsx`，删除 `tsconfig.jsx.json` 与 `hideAgent` 死分支，收口 `--ui-*` 令牌。<br>3. 收敛前端 Store 与异步竞态守卫，拆分 Playwright 为 3 个独立冒烟 Spec。 | 全仓零 `.jsx`/零 `any` 新增；`npm run test:all` 全绿且 CI 总耗时下降 45%+。 |
