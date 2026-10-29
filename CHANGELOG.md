# 更新记录

## 0.5.0

两种模式入口与可恢复任务；DSH 继续负责 Agent 执行，插件记录目标与产物。新增任务页、写作包、审读方式和导出，保留旧数据与业务门禁；统一任务定位、审读版本及 HTTP 访问边界，收敛检查入口并移除包内测试夹具。详见 [版本说明](docs/releases/0.5.0.md)。

## 0.4.0 · 2026-10-29

- Fix CI Python UTF-8 output on Windows and run the original Zhizhang suite from its package directory; preserve LF source hashes across platforms.

- Merge Zhizhang 0.20.0 source into packages/zhizhang; keep its 47 original tests unchanged and stop independent publishing.
- Ship one dsh-writer package with three enable triggers and the Zhizhang client; unify configuration under zhizhang.
- Reuse internal work selection and chapter readers; save editor reports under each work's writer-reviews directory.
- Merge forge diagnostics into zhizhang_style_lint and deduplicate overlapping same-line findings; remove fanqie_manuscript_lint.
- Add workbench review summaries and confirmed actions routed to the most recently active main session in the same project.
- Enforce fresh passing review reports at shared storage finalization for chat and panel operations.
- Restore Node 24 / TypeScript 5.8.3 / Python 3.11 / pnpm baseline and the seven business error codes.


## 0.3.0 — 2026-10-28
- **番茄长篇整合（M3）**：新增 `fanqie_enable` 与 9 个 `fanqie_*` 工具，建立在织章 dsh-zhizhang 0.20.x 之上、只读织章数据；forge 三件套原文与五个检查脚本原样内置，`fanqie_bridge.py` 统一契约。
- 长篇门禁：定稿与 force 覆盖须作者确认；可选 `fanqie.requireEditorPass`；编辑子代理只读。
- 观察 `zhizhang_enable` 成功后自动挂载长篇工具与门禁（`fanqie.autoMount`）。
- **包名改为 `dsh-writer`，插件 id 改为 `writer`**（0.2.x 用户先 `dsh plugin remove dsh-writer-toutiao`）；新增入口层 `packages/app`。
- 门禁引擎支持 `前缀*` 规则；体裁登记改为进程级单例。
- 测试：Python 205 + 10，Node 29；真实 headless 新增长篇 e2e（真实织章 0.20.0）。

## 0.2.0 — 2026-10-28
- 写手与编辑分离：`toutiao_enable role=editor` 挂载编辑专用 9 个工具与编辑总则；写手不能把自己的稿记成编辑版；新增可选门禁 `toutiao.editor_pass`（配置 `requireEditorPass`）。
- 体裁隔离：头条与番茄长篇（织章 `zhizhang_*`）在同一会话互斥，经 `tools/result` 观察织章启用。
- 写作台“采用”同步台账状态。
- 适配层新增 `onToolResult`。
- 测试：Node 20 项；真实 ToolRuntime 覆盖编辑作用域与体裁隔离；真实 headless 端到端改为主会话派出编辑子代理。

## 0.1.0 — 2026-10-28
- 新增 `dsh-writer-toutiao` 插件：按需启用，19 个头条工具，常驻总则，4 条门禁，本机写作台。
- 新增 `@writer/dsh-adapter`、`core`、`gates` 三个基础层。
- 头条规则沿用 toutiao-viral-writer 4.0.0 原脚本，新增 `writer_bridge.py` 统一 JSON 输出。
- 测试：Python 205 项、Node 17 项、真实 DSH ToolRuntime 集成 1 项、真实 dsh headless 端到端 1 项。
