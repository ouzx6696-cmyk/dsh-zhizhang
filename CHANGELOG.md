# 更新日志

## 2.3.0（番茄长篇方法论升级、轻量单点入口、跨书回查、存稿 KPI、旧书接管与多分支演进）

### 番茄长篇方法论与单点轻量创作（T1 / T2）
- **默认方法论深度升级**：升级 `packages/fanqie/profiles/default/` 下的 `prose.md`、`edit.md`、`examples-write.md`、`profile.json`、`stage-map.json` 并新增 `genres.md`（六大热门题材节奏基准表）；补齐一阶/二阶 AI 腔诊断规范、番茄快爽与打脸文五项专属审改、双稿 A/B 盲评口径与移动端实操示范，同步刷新 `assets/manifest.json` 校验哈希。
- **专项去 AI 腔 / 轻润色与半章断点续写**：`fanqie.revise` 流水线新增 `mode: "revise" | "deai" | "polish"`，专项模式无需手填 `issues` 即可单轮精修并过门禁、产物继续落入候选稿待作者对照裁决（绝不直改正文）；`fanqie.chapter` 新增 `continueFromExisting` 半章断点续写，提取已写正文末 500 字锚点并保留原前缀无缝续写；同步透传至助手工具与 `WorkflowStartForm`。

### 跨书回查、连载存稿 KPI 与旧书接管（T3 / T4 / T5）
- **跨全书单实体时间线回查**：新增 `traceEntityTimeline`、`fanqie.bible.trace` 命令与 `readonly: true` 助手工具 `fanqie_trace_entity`，支持按实体别名自动展开，按“全局优先 + 章节升序”串联实体/章节/状态/知情/伏笔与可选正文摘录（含 `maxBodyHits` 截断保护），并在设定中心新增「时间线回查」页签与点击直跳章节。
- **连载存稿缓冲 KPI**：`WorkMetaSchema` 新增可选 `publishedThrough` 与 `dailyTargetChars`，`computeSerialBuffer` 实时计算连续已定稿章数、连续存稿字数、按日更字数折算可撑天数与缺口后孤立定稿提醒；通过 `fanqie.snapshot` 透传至 `StudioDashboard`，缺口提醒严格使用 `--zz-warn` 琥珀色，不侵占 `--zz-decide`。
- **旧书大稿零模型批量导入**：新增 `importLegacyWork` 与 `fanqie.work.importLegacy`，支持单 TXT 按中文章号/阿拉伯数字自动切章与多文件目录自然序导入，内置 UTF-8 + GB18030 回退解码、`resolveInsideAsync` 路径沙箱、`LockService` + `commitIntent` 原子落盘与 `sources/legacy-import/` 原稿备份；在 `NewTargetDialog` 新增「导入旧书接管」入口。

### 多分支衍生谱系与设定集三分类沉淀（T6）
- **多分支候选谱系追踪**：`fanqie.chapter` 支持 `previousCandidateId` 承接前章未定稿候选，自动在 `.meta.json` 写入 `derivedFrom`（含 `sourceHash` 与真实来源状态）；`acceptCandidate` 时原子更新并检测返回未匹配下游过时候选清单（`staleDownstreamCandidates`），绝不静默删改作者草稿。
- **设定集三分类沉淀**：`bible/pending.json` 与 `ledger` 流水线支持 `settlement` 三分类标注（`resolve_short_term` 短期已解决自动为旧状态封口、`settle_long_term` 长期事实确认沉淀、`update_profile` 人物设定更新合并别名与锁定项）；全仓包版本与 `APP_VERSION` 统一升至 `2.3.0`（保持 `FORMAT_VERSION = "zhizhang/2.0"` 不变）。

### 质量、正确性与可靠性全量加固（v2.3.0 优化）
- **Electron CSP 与零外链离线字体**：移除 `apps/desktop/index.html` 的外部 Google Fonts `<link>`，全面统一使用本地打包 `@fontsource/noto-serif-sc` 与系统字体，消除 Electron 严格 CSP 控制台报错。
- **半章续写锁前缀与专项精修真实语义**：`continueFromExisting` 全文归一化校验并硬锁定已写前缀，审修轮次如改动已写前缀自动回退至上一合规稿；`revise(deai/polish)` 明确标记 `editorPass: false`、`reviewPerformed: false`，杜绝绕过完整审读误晋升为 `reviewed`。
- **多分支谱系与原稿接管增强**：`acceptCandidate` 改为 `commitIntent` 原子落盘并补充 `sourceHash` 失配与同章竞争分支过时检测；`fanqie.chapter.finalize` 支持可选 `base` 乐观锁；拆分 `commands/import-parse.ts` 并新增 `fanqie.work.previewLegacy`（总命令数扩展至 50 条），支持卷/章区分、零丢弃序言、原字节无损归档、`import-manifest.json` 清单及前端默认 `drafted` 状态导入与切章预览。
- **L0 原子意图、沙箱回放与并发预算防护**：`commitIntent` 写锁内增加 `beforeHash` 前置冲突校验；`replayPendingIntents` 增加 `allowedRoots` 路径沙箱与写锁保护；`BudgetGuard` 引入并发在途金额预留（`reserveMoney` / `settleMoney`），防止并发请求穿透金额上限。
- **上下文、设定集时间片、存稿缺口与头条验收锁**：`computeSerialBuffer` 检测章号跳跃缺口；BM25 分词缓存改用 SHA-256 内容键；`bible.asOf` 补齐付费节点与未来记账实体过滤；`ledgerPipeline` 解析真实章号定位；`context/builder.ts` 拆出 `context/format.ts` 实现 L2/L4/L5/L6 逐项预算裁剪与 `onIncludedCards` 回调；头条补齐原文逐字证据核验与来源哈希失效，`acceptedRevision`/`deliveredRevision` 绑定防止未重验交稿与交稿后篡改草稿；清理裸 `JSON.parse as` 并收紧 `as` 断言基线至 `115`。

## 2.2.0（灵感源全量对齐、柔和纸面 C2 整合、零超行清理与 CI 加固）

### 柔和纸面 C2 视觉体系与交互重构
- **三层设计令牌与一色一意**：全面落地 `palette.css` → `semantic.css` → `component.css` 暖灰纸面与暗纸双主题（`[data-theme="day"]` / `[data-theme="night"]`），移除旧古风主题与未定义变量（修正 `--zz-radius-btn` → `--zz-btn-radius`）；将 D3 仪表盘节点语义 `decide` 更正为 `active`，删除 `studio-collab.css` 遗留死 diff 类中的 `--zz-decide` 泄漏，确保赭橙严格仅用于作者裁决。
- **无顶栏三栏工作台**：重构为 240px 平铺左栏（`LeftRail` + `LeftRailParts`）、轻量 `CenterBar` + 浮起衬线稿纸中栏、344px 双浮卡右栏（7 段流水线卡 + 只读助手原文引用卡），移除浮层 Toast 并改以左栏底部静默展示保存状态；柔化 `ProjectHub` 激活态与 `Onboarding` 卡片层级。
- **决策卡与并排双稿纸逐处采纳**：完整重写 `compare.css` 精准对齐 `DraftCompare` / `CompareSheets` 的所有类名与交互状态，支持行内红删/绿增、左侧圆形编号、逐处局部采纳（Cherry-pick）与采纳后撤回。
- **创作内核仪表盘与交互式技法仓**：Studio 顶部引入基于 D3 的拆解/整理/填充进度与流水线节点图；`TechniqueWarehouse` 内置交互式技法编辑器与 Markdown 逻辑结构实时预览。

### PI 内核深度整合与全仓模块洁净
- **PI 内核边界与会话增强**：`pi-adapter.ts` 与纯辅助模块 `pi-helpers.ts` 严格恪守 `[G-pi]` 单文件 SDK 隔离，接入共享 `ModelRuntime`、会话亲和与 Prompt Caching、工具参数纠偏（`validateToolArguments`）、溢出自动压缩重试、思考链流式推送、内置模型目录与配置变更运行时失效机制。
- **全仓零 `[G-size]` 超行拆分**：拆解全部 11 个超过 400 行的 TS/TSX/CSS 模块（`CompareSheets.tsx`、`LeftRailParts.tsx`、`BibleCenterTabs.tsx`、`ToutiaoLedger.tsx`、`dissect/schemas.ts`、`contract/views.ts`、`book/apply.ts`、`context/retrieval.ts`、`server/http-io.ts`、`session/turn-runner.ts`、`session/pi-helpers.ts` 及 `shell-centerbar.css`、`compare.css`、`dock-agent-compose.css`、`studio-library.css`），全仓 300 个 TS/TSX 与 34 个 CSS 文件零超行告警；`as` 类型断言基线由 `122` 收紧至 `116`。
- **CI、打包与文档体系重构**：修复 `scripts/stage-desktop.mjs` 在 hoisted `node_modules` 下解析 `@fontsource/noto-serif-sc/LICENSE` 失败的问题，验证 `npm run desktop:build` 全通过；补全 `.gitignore`、`.prettierignore` 与 `eslint.config.mjs` 忽略规则；全面重写 8 份核心文档以对齐五大灵感源与 v2.2 项目架构。

## 2.1.0（全链路加固、性能优化与文档体系重构）

### L0 核心引擎（`@zhizhang/core`）
- **Python 桥接 UTF-8 与跨平台加固**：`runPython` 改为 `Buffer[]` 合并后统一解码 UTF-8，彻底消除多字节中文跨 chunk 截断乱码；子进程默认注入 `PYTHONUTF8=1` 与 `PYTHONIOENCODING=utf-8`；Windows 解释器探测补齐 `python` 回退。
- **存储、锁与权限安全**：`atomicWrite` 支持 POSIX 权限位（`mode`）；`sandbox` 新增非阻塞 `resolveInsideAsync` / `resolveResourcePathAsync`；`write-lock` 锁目录按 `resource.kind` 命名空间隔离，修复 Unix `EPERM` 存活误判，并全面接入 Schema 校验（覆盖 `lock`、`journal`、`methods`、`usage`、`delivery`）。
- **网关与流水线控制**：`ModelGateway` 接入可选 `UsageTracker`、`requireExplicitBinding` 及流式 `onDelta` 透传；`executePipeline` 精确区分 `signal.reason === "cancelled"`（取消）与暂停（`paused`）；`ToolSpec` 新增 `readonly` 声明与 `ToolCtx` 锁/时钟注入。

### L2 业务模式（`@zhizhang/fanqie` & `@zhizhang/toutiao`）
- **头条原生卡片校验与工作区洁净**：`writer_bridge.py` 新增 `check-card` 子命令并在 `limits` 中结构化返回 `styles`（直接读取 `rules.py`），TS 侧彻底移除内联 `python -c` 并缓存 `limits`/`styles`；头条流水线替换空上下文包为真实预算 `ContextPacket`，临时质检文件移至 `.tmp/` 并在结束后清理。
- **番茄设定集与上下文性能优化**：将 655 行 `bible/store.ts` 拆分为 `schemas.ts` / `audit.ts` / `store.ts`；`audit()` 改用实体索引表与二分查找，消除 $O(C \times K \times E)$ 退化；`read()` 引入基于文件签名缓存；`buildChapterContext` 引入 2-gram LRU 缓存并严格执行 `input.budget` 分级裁剪。
- **番茄流水线并行与容错**：`chapterPipeline` 并行执行候选逐稿评分与前二换位比较；修稿轮次未通过门禁时自动回退保留上一版合规候选稿并记录审读说明，不再整次报废；`work.json` 损坏快速报错不再静默吞没；将 580 行 `pipelines/book/index.ts` 拆分为 `schemas.ts` / `stages.ts` / `index.ts`。

### L1 & L3 双宿主、会话、网络与前端（`@zhizhang/ui` / `@zhizhang/workbench` / `apps/desktop`）
- **Web 预览安全与可靠性**：静态文件与 `/api/exports/:file` 全面改用 `resolveInsideAsync` 沙箱；`POST /api/rpc/*` 强制校验同源 `Origin` 与 `application/json`；新增安全响应头与静态资源分层 `Cache-Control`；SSE 广播包裹 `safeWriteSse` 自动清理失效连接，前端 `web-bridge.ts` 增加重连状态同步与 RPC 超时。
- **运行时与会话并发加固**：`SessionManager` 按目标串行化 `send`/`compact`/`newConversation`/`view`，`states` 缓存改为 16 槽 LRU（不淘汰忙碌会话），连续 `readonly: true` 工具自动并发执行，工具返回超 24KB 自动截断；`pi-adapter.ts` 增加 15s 连接测试超时、结构化状态码解析、`structuredClone` 与单次 runtime 查询；`RunStore` 隔离损坏记录并按 200 条终态上限自动裁剪；`ConfigService` 以 `0600` 权限落盘 `secrets.bin` 并支持 `onChange` 退订；`network.ts` 支持 gzip/deflate/br 解压、GB18030 回退与保留段落结构的正文提取。
- **模块拆分、前端竞态修复与死代码清理**：拆分 `packages/ui/src/copy/desktop.ts` 与 `apps/desktop/src/main/commands.ts`；`ToutiaoWorkspace` 接入 `useRequestGuard` 防过期响应覆盖且编辑中不被外部刷新打断；修复 `events.ts` 消息计数漂移并防抖刷新目标列表；清除全部死导出（`unusedExports = 0`）并现代化改造 `assets/sources.json` 与 `scripts/assets.mjs`。

## 2.0.0（双宿主重构与 `zhizhang/2.0` 架构升级）

- **统一版本与磁盘格式**：升级至 `APP_VERSION = "2.0.0"` 与 `FORMAT_VERSION = "zhizhang/2.0"`，彻底移除 1.x 旧格式兼容分支。
- **双宿主共享组合根**：抽离无 Electron 依赖的 `HostPlatform`、`createAppRuntime` 与传输无关 `createRpcHandlers`，新增 Web 本地预览服务器（`0.0.0.0:3000` HTTP RPC + SSE）与示例数据初始化，渲染层按运行环境自动切换 IPC 或 HTTP/SSE 桥。
- **内核与流水线升级**：`@zhizhang/core/schema` 支持 `desc` / `nullable` / `toJsonSchema`，`defineTool` 自动推导 JSON Schema；`StageRunner` 串行化 `fanOut` 状态落盘并推送 `PipelineEvent`；`PythonRunner` 加固超时、输出上限与强制 JSON Schema 校验；头条支持基于 `stage-map.json` `when` 条件的赛道动态路由与多路起稿择优；番茄设定集升级为 `commitIntent` 原子落盘，全书规划升级为 `plan/proposals/<runId>/` 提案隔离。
- **前端与守卫收敛**：全面拆解超长 TSX 组件与 CSS 样式表，严格执行全 `.tsx` 零 JSX 中文硬编码与 `scripts/guard.mjs` 静态架构守卫。

## 1.3.0

- **品牌与包结构统一**：全仓更名为 `zhizhang`（`app.zhizhang.desktop`、`Zhizhang.exe`、`~/.zhizhang`、`.zhizhang/`），内部包统一为 `@zhizhang/{core,fanqie,toutiao,workbench,ui,desktop}`。
- **设定集与精简收敛**：删除自由写手模式与冗余实验开关；确立 `bible/` 为唯一连续性真源；落地 `stage-map.json` 确定性直取原文、纯文本起稿、逐稿独立打分与段落级 diff 个人规则学习；建立 `--zz-*` 三层设计令牌与右栏分屏工作台。

## 1.1.1

- 确立阶段隔离流水线、可恢复 `journal`、引文逐字定位、换位读者比较与头条 4.0.0 规则门禁基础能力；完善独立进程离线备份与 Electron 安全配置。

## 0.x（早期原型）

- 完成桌面端基础壳、番茄与头条双模式初版工作流、Python 质检桥接脚本与本地存储原型。
