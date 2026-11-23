# 更新日志

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
- **模块拆分、前端竞态修复与死代码清理**：拆分 `packages/ui/src/copy/desktop.ts` 与 `apps/desktop/src/main/commands.ts`（全仓零超 400 行告警）；`ToutiaoWorkspace` 接入 `useRequestGuard` 防过期响应覆盖且编辑中不被外部刷新打断；修复 `events.ts` 消息计数漂移并防抖刷新目标列表；清除全部死导出（`unusedExports = 0`）并现代化改造 `assets/sources.json` 与 `scripts/assets.mjs`。
- **文档体系全量重构**：重写 `AGENTS.md`、`README.md`、`docs/ARCHITECTURE.md`、`docs/WRITING.md`、`docs/USER-GUIDE.md`、`docs/STATUS.md`、`docs/plans/v2.md`（替代 `v1.3.md`）与 `CHANGELOG.md`。

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
