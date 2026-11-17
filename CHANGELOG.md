# 更新日志

## Unreleased

- **v1.4 C-01a 文本机制（待审核）**：实现 BOM / UTF-16 / 严格 UTF-8 / GB18030 与 Big5 候选打分、保留原文偏移的规范化、MD/TXT 分节与段落哈希；增加纯机制测试。Electron 45.2.3 主进程已实测三种非 UTF-8 解码器；不新增依赖，不改原文字形，导入 IPC 由 I-01 接线。

- **桌面 E2E 隔离与重启校验**：每个测试状态目录配套独立 Chromium 用户目录，同一旅程重启复用，避免跨用例共享 localStorage 与缓存锁；草稿等待改为核对目标章节键与正文，引导重启校验等待设置落盘并确认应用启动完成后再断言不弹窗。

- **v1.4 D-02 设定集扩展与变更集（2026-11-17）**：`bible/store.ts` 拆为 read/asof/interval/match/audit/state/ops/apply/invert/changeset/commit/pending/query 13 个文件；读取逐文件 schema 校验（坏文件报 `storage.format_unsupported` 且不覆盖），`asOf(N)` 按 `[since, until)` 切片并保留历史线索；状态区间支持开闭、截断、planned 兑现与冲突；`pending.propose/decide` 只写批次，`pending.commit` 在同一 `Intent` 写入真源、ledger、`index.json`、批次与 `changes/<YYYY-MM>.jsonl`；`bible.revert` 支持整批撤销、`rev_changed` 跳过与 force。9 条命令（query/entity/apply/changes/revert、pending.list/get/decide/commit）接入真实现。自审另修：V2 引用校验、`entity.merge` 改写 ledger 引用、同记录多次修改的可逆撤销、部分 `state/style` patch 不抹字段、批次自动 `dependsOn`、`effectiveFrom`、重复提交幂等、路径 id 校验与 index hash 取真实字节。`as` 断言 175 → 173，Node 139/139。待审核：逆操作使用内部 `entity.delete` 载体，确认页由 U-03 接入；v1.3.0 旧 `bible/index.json` 形状未迁移，首次提交会报 `storage.format_unsupported`。
- **全量梳理与清洁（2026-11-17）**：删除未被引用的 `commandPaletteText1/2` 文案键（命令面板未实现），文案键口径校正为 969 条唯一键（15 个模块去重；`COPY` 聚合 810）；清理 `.cache/` 测试转译缓存、`test/.tmp/` 与 Python `__pycache__`；同步 `AGENTS.md`、`README`、`docs/ARCHITECTURE`、`docs/WRITING`、`docs/STATUS` 的分支与测试口径；更新 `plans/v1.4/项目全量梳理.md` 与 tracker 的过期工作区说明。无业务行为变更。
- **v1.4 A-02 接口桩与契约测试（2026-11-17）**：按 arch-freeze-v1 落地 `bible`/`outline`/`import` 最终类型与同名解析器（`union` 判别联合、落盘前 `dropUndefined`）；工作台命令 45 → **68**（新增大纲 5、设定集/待确认 9、导入 9、体检 1，删除 `fanqie.bible.decide`；原文档「90 条」为命令表与策略表重复计数，已校正）；`CommandRefreshScope` 增 `outline/imports/pending`；注册第 8 条番茄流水线 `fanqie.import`（阶段实现待 I-02）；新增 `dialog.pickImport` 一次性令牌（主进程持有绝对路径）；`WorkflowStart.budget?`、`MainView` 增 `plan`、PlanView 懒加载占位与 plan 文案域；F2 §9 五处最小适配（store 批次/ledger、book、ledger、context、BiblePane）。`npm run check` 全绿；Node 118/118、Python 226+1。
- **决策：跳过 Windows 实机检查（2026-11-17）**：M0-4 的 W01–W20 与 1.3.0→1.4.0 覆盖升级全部不执行；检查单、记录模板与 1.3.0 基线包保留作参考，不产生验收证据。发版门移除实机项，安装器、输入法、高对比度、长跑与升级路径的残余风险由作者承担。
- **文档口径校正**：移除 `README` / `docs/USER-GUIDE` 中「专注模式（Ctrl+. / F11）」「命令面板（Ctrl+K）」的描述——当前未实现入口，遗留的 `commandPaletteText*` 文案键已在本轮清理中删除；实际快捷键为 `Ctrl+,` 设置、`Ctrl+.` 收起右栏、`Ctrl+1/2/3` 切右栏标签。
- **文档与工程基线同步（2026-11-17）**：`README`、`AGENTS`、`docs/ARCHITECTURE`、`docs/WRITING`、`docs/USER-GUIDE`、`docs/STATUS` 全部按 `master@83bf7f7` 重写口径；校正头条文章目录为 `meta.json` / `交稿单.md`、工作台命令 90 条、静态守卫 14 条、前文模式 6,000 / 1,800 字；新增 `plans/v1.4/baseline/` 计划原件只读快照（含 SHA256）与 `.workbuddy/` 忽略规则。
- **桌面外壳修复（v1.4 M0 线）**：切换作品时按作品实体比对快照代号，消除章节列表不出现与编辑区反复重挂载；引导「稍后再说」在未配置写作文件夹时不再阻止引导重现；历史运行改为可点开的只读详情（阶段时间线、上下文分区、交付回执、运行级错误），已交付候选稿提供「打开对照」入口。
- **编辑器**：正文草稿经 IPC 落到写作文件夹 `.zhizhang/drafts/`（同 key 串行、最后一次生效），不再写 `localStorage`；编辑态标题拆为独立输入框，稿纸区不再显示 `# 章名` 原文，保存时与 front matter 同步。
- **流水线持久化韧性**：并行阶段（`fanOut`）的运行记录持久化串行化，避免并发重命名瞬时 `EPERM` 被误判为 `storage.locked` 而暂停；`atomicWrite` 对 `storage.locked` 增加指数退避重试（约 10 秒）；两项均补回归测试。
- **头条质检收口**：`qa_check.py` 只输出六维 `items` 时，规则桥按非 `pass` 项合成 `fails`，修复质检未过线时交付步骤崩溃；两轮精修仍未过线保持「初稿待改」。
- 增强 `scripts/guard.mjs`：`G-exports` 导出校验、`G-copy` 文案与业务常量守卫、桌面 `main/` 裸错误基线检查与 `as` 断言上限控制；新增棘轮（`check-ratchet.mjs`）与体积预算（`check-budget.mjs`）门；移除旧 `scripts/architecture-guard.mjs`。
- 精简 `.github/workflows/ci.yml`：移除 `scope`/`ci-run.mjs`/`test:platform`，接入 `check`、`test`、Windows 与 Linux `e2e` 以及 `Zhizhang` 打包流程。
- 统一 `scripts/check-desktop-package.mjs` 为 `Zhizhang.exe` 与 `zhizhangBridge` 契约，补充核心单元行为测试并统一核心文档口径。
- 桌面 E2E 临时目录迁入仓库 `test/.tmp/`（已 gitignore）：本机安全软件会封锁 `%TEMP%` 内的高频临时写盘。

## 1.3.0

- **交付收尾**：修复助手路径越界、候选采纳与定稿状态、同目标运行竞争、失败回答费用漏记和预算预占释放；恢复阶段直接复用已验收输出。
- **正文与资料一致性**：章节加载前文、卷规划及绑定参考卡；头条编辑修订后重核事实，台账失败时保留可重试的文章状态，交稿文件与元数据经写入意图提交。
- **环境与构建**：租约获取/接管/释放共用写锁，切换工作区前停止旧任务；修复 Windows 构建顺序和发行验证命令；测试转换器收敛到已有 esbuild，仅增加一条必要回归用例。

- **品牌与包结构统一**：全仓更名为 `zhizhang`（`app.zhizhang.desktop`、`Zhizhang.exe`、`~/.zhizhang`、`.zhizhang/`），所有内部包登记为 npm workspace `@zhizhang/{core,fanqie,toutiao,workbench,ui,desktop}`。因 `appId` 变更，1.1.1 用户需手动安装新版本。
- **全新磁盘格式（`zhizhang/1.3`）**：移除 `meta.json` 单点热点与 1.x 旧数据/设置兼容分支；确立设定集 `bible/` 为唯一连续性真源；本地草稿迁移至写作文件夹 `.zhizhang/drafts/`。
- **精简与架构收敛**：删除自由写手模式、7 个冗余实验开关及 23 份过期文档；`@zhizhang/core` 收敛为 errors / schema / fs / lock / journal / tool / pipeline / model / methods / python 模块；统一 `AppError` 码表、`ModelGateway` 全局并发/金额预算闸与 `LockService` 三锁合一机制。
- **写作内核升级**：番茄长篇实现纯文本起稿、审读引文逐条容错、初选逐稿独立打分、确定性 `stage-map.json` 阶段取用与段落级 diff 个人规则学习；头条图文修正修订阶段使用 `s5-editing`、实现增量事实链复核并将 `PASS_SCORE = 84` 收口至 `rules.py`。
- **界面与设计系统**：建立 `--zz-*` 三层设计令牌与四色语义分离；流水线面板改为右栏停靠并支持与助手分屏；新增专注模式与强类型 `WorkbenchCommandMap` / `DesktopEvent` 契约。

## 1.1.1

- 确立阶段隔离流水线、可恢复 journal、引文逐字定位、换位读者比较与头条 4.0.0 规则门禁基础能力。
- 完善桌面端离线备份（utility process）、Electron Fuse 安全加固与 Windows 安装包冒烟验证链路。

## 0.x（早期原型）

- 完成桌面端基础壳、番茄与头条双模式初版工作流、Python 质检桥接脚本与本地存储原型。
