# 项目状态

- **当前发布版本**：`1.3.0`（`origin/master@20c150a`；本地 `master` 已领先，未发版、未推送）
- **当前代码基线**：master `83bf7f7`；A-02 落在 `arch/freeze-stubs`（代码 `9f9dfa7` + 清洁提交 `0e0d5fc`，未合入、未推送）；D-02 从该分支检出 `feat/D-02-bible-changesets`（本地工作区，未提交）
- **最后核对**：2026-11-17（`npm run check` exit 0；Node 139/139、Python 226+1、桌面构建同日实跑）

## 最新验证矩阵

| 检查项 | 环境 / 范围 | 状态 | 说明 |
| --- | --- | --- | --- |
| `npm run check` | Windows 11 本机 Node 24 + Linux CI | 通过 | 2026-11-17 D-02 后 exit 0；`tsc -b`、`selftest`、ESLint、Prettier、`guard.mjs`、棘轮与体积预算全绿；实测 `any=0`、`!=0`、`!=:0`、`as=173/258`、`main` 裸错误 0、零引用导出 21/36 |
| Python `unittest` | 头条 226 项 + 番茄 1 项 | 通过 | 覆盖 4.0.0 规则源、门禁、台账与桥接脚本 |
| Node 单元/引擎测试 | `test/unit/*.test.mjs`、`test/engine/*.test.mjs` | 通过 139/139 | A-02 的 `union`/`dropUndefined`/`IdSource` 11 条与 `v14-contracts` 8 条；D-02 的区间 6 种相对位置、逆操作全覆盖、提交/撤销/Intent replay、坏文件不覆盖、引用与路径校验、自动依赖与 effectiveFrom、命令真实现 |
| 桌面 E2E | `test/desktop/m0.spec.mjs` + `ui.spec.mjs`，13 条旅程 | 通过 13/13 | 结果沿用 master `4820d4e`；A-02 未改 UI 行为，未重跑。本机需 `ELECTRON_DISABLE_SANDBOX=1`；临时目录在仓库 `test/.tmp/`（见已知问题） |
| 桌面构建 | electron-vite（主进程/预加载/渲染） | 通过 | 2026-11-17 D-02 后重建；渲染资源分块产出，体积预算门通过 |
| 打包 / 安装升级 | 需 Windows 原生环境 | 已跳过 | 作者决定（2026-11-17）跳过全部实机检查：W01–W20 不执行，不产生安装/覆盖升级验收证据；CI `package` job 仍覆盖构建与冒烟 |
| 真实模型 RM01/RM02 & A/B | 需联网与付费预算批准 | 待执行 | 需作者单独批准预算后运行 |

## v1.4 进度（30 张卡）

| 状态 | 数量 | 卡 |
| --- | ---: | --- |
| 已合入 `master` | 4 | M0-1（质检收口）、M0-2（草稿落盘与编辑态标题）、M0-3（竞态/引导/历史详情，含 DEF-01/02 修复）、INF-01（质量门增强） |
| 待审核 | 4 | T-01（假模型夹具，`65b60bf` → `integration/v1.4@69374fa`）；A-01（架构冻结包 F1–F9 + 26 份 ADR，引用自检 42/42）；A-02（`arch/freeze-stubs`，代码 `9f9dfa7` + 清洁 `0e0d5fc`：类型/解析器、24 条命令、导入流水线注册、IPC 令牌、契约测试 118/118）；D-02（`feat/D-02-bible-changesets` 本地工作区：13 文件拆分、状态区间、pending、变更集/撤销、9 条命令真实现，139/139） |
| 已跳过（作者决定） | 1 | M0-4（Windows 实机 W01–W20 与覆盖升级全部不执行；检查单与基线包仅作参考） |
| 未开始 | 21 | 其余 M1–M5 功能卡 |

已合入部分约 7.5 人天 / 88.5 人天（约 8.5%）；A-01（3 人天）、A-02（2 人天）、D-02（4 人天）与 T-01（2.5 人天）均待审核，未计入；M0-4 按作者决定跳过，不计入完成。M0 线是 v1.3 遗留缺陷修复，不推进 v1.4 功能主链。

**关键链**：`A-01 冻结包（已交付，待抽查）→ A-02 接口桩与契约测试（已交付，待审核）→ D-02 设定集与变更集（本地完成，待审核）→ I-02 → I-03 → M1 → … → T-02 → ACC-01 → ACC-02 → v1.4.0`。

## 已知问题与待完成事项

- **A-01 已解除阻塞（2026-11-17）**：`plans/novel-manager/plan.md` 不存在，作者批准以计划 §2 替代详细设计冻结（`plans/v1.4/adr/ADR-000-freeze-basis.md`）。已交付 `plans/v1.4/arch/` F1–F9 与 `plans/v1.4/adr/` 26 份 ADR；`verify-refs.sh` 42/42 通过。残余风险：计划与真实设计细节冲突时会在 M1 暴露为返工。
- **v1.3.0 索引升级风险（待作者/主控决定）**：1.3.0 发布的 `bible/index.json` 形状为 `{format, hashes}`，D-02 只认 `{format, files}`；旧工作区首次 `bible.apply` / `pending.commit` 会按“未知格式”报 `storage.format_unsupported`，F7 未列迁移步骤。M0-4 已跳过，升级路径没有实测证据；需要明确迁移方案或在发版说明要求重建。
- **D-02 性能与校验边界**：`readLib` 仍读取全部 `bible/ledger/*.json`，未实现 F2 的按位置懒读；V2 引用校验会扫描全部 ledger，旧工作区若有手工悬空引用，首次写入会拒绝。两项不影响当前测试，但长书性能与升级兼容需要后续卡（L-01/I-03）评估。
- **写作内核接线**：L5 早期摘要检索、L6 规划与参考卡、前章正文、状态冲突巡检及日期/机构提取已实现；章节流水线加载前文、当前卷规划及绑定参考卡。
- **桌面外壳（v1.4 M0 线）**：切换作品竞态守卫、引导「稍后再说」、历史运行只读详情（含运行级错误与候选稿「打开对照」）已交付；编辑草稿经 IPC 落到 `.zhizhang/drafts/`，编辑态标题单独编辑，不再写 `localStorage` 正文。
- **导入/记账产物链接待接**：历史详情里「导入 → 提案页」「记账 → 确认屏」两个入口依赖 v1.4 Wave 1 的 U-02 / U-06 界面。
- **Windows 并发写盘韧性**：`atomicWrite` 对 `storage.locked` 指数退避（约 10 秒）；`fanOut` 并行阶段的运行记录在同一次运行内串行化；两项均有回归测试。
- **E2E 环境限制（本机）**：Chromium 沙箱无法启动，需 `ELECTRON_DISABLE_SANDBOX=1`；本机安全软件在高频临时写盘后会拒绝进程在 `%TEMP%` 新建文件，故 E2E 状态目录放在仓库 `test/.tmp/`（已 gitignore）。CI 不受影响。
- **发行入口**：Windows CI 已覆盖桌面构建、`e2e`、`e2e-linux`（xvfb）与 `package` job（tag / 手动触发）；Windows 实机验收已按作者决定跳过，发版不再以实机项为门。
- **自动化范围**：记账与十章体检由流水线显式发起，定稿动作本身只确认章节状态。
- **依赖审计**：electron-builder / minimatch 构建依赖链有 6 条 moderate，0 high/critical；未更换打包工具版本（2026-11-17 沿用，未重新联网复核）。
- **Windows 实机检查（已跳过）**：作者决定（2026-11-17）不执行 W01–W20 与 1.3.0→1.4.0 覆盖升级；`plans/v1.4/windows/checklist.md`、`acceptance-v1.4.0.md` 与 1.3.0 基线包（SHA256 已记录）保留作参考，不产生验收证据。安装器、输入法、高对比度、长跑与升级路径的残余风险由作者承担，发版材料不得宣称已通过实机验收。
- **文档口径**：`docs/plans/v1.3.md` 已随 `6d510cc` 清理；`docs/` 现有 4 份 + 根文档 3 份 = 7 份，距 `G-docs` 上限 8 份剩 1 份余量。
- **命令契约计数校正（A-02，2026-11-17）**：原「90 条」为 `WorkbenchCommandMap`（45）与 `COMMAND_POLICY`（45）两表重复计数；A-02 后以运行时键集合为准为 **68 条**。`COMMAND_POLICY` 键 = `WorkbenchCommandMap` 键 = 主进程 `INPUTS`/`HANDLERS` 键，由命令分派测试与 `v14-contracts` 双重断言。
- **D-02 待审核偏差**：`pending.decide` 现在只写决定，`pending.commit` 才写真源；`BiblePane` 仍停留在只 decide 的旧交互，确认页在 U-03 接 commit。冻结 `BibleOp` 无 timeline/thread/knowledge/ledger 删除操作，撤销新建记录以内部载体 `entity.delete` + 按 id 删除实现；如需显式契约须走 CCR。整批 stale 时写一条空变更集，ledger 删除在 Intent 后执行。`fanqie.book` / `fanqie.ledger` 的刷新范围仍在各自卡片切换为 `pending`。
- **本轮校正（2026-11-17）**：头条文章目录统一为 `meta.json` 与 `交稿单.md`（旧文档误写 `article.json` / `delivery.md`）；移除「专注模式（Ctrl+. / F11）」「命令面板（Ctrl+K）」描述——代码中无对应实现，未使用的 `commandPaletteText*` 文案键已删除；实际快捷键为 `Ctrl+,` / `Ctrl+.` / `Ctrl+1·2·3`。

## 质量基线

- `apps/desktop/src/main/` 裸 `throw new Error(` = 0；`any` = 0；非空断言 `!` = 0；确定赋值 `!:` = 0；`as` 断言 173（基线 258，较 A-02 的 175 再降 2）；零引用导出 21（基线 36）。
- 13 个文件超过 400 行（8 个源码 + 5 个样式），最大 `packages/fanqie/src/pipelines/chapter/index.ts` 741 行、`packages/ui/src/styles/primitives.css` 934 行；由 `G-size` 提示、不阻断（新增文件仍受 400 行硬限）。
- 契约规模：68 条命令（fanqie 43 / toutiao 12 / profiles 9 / library 4）、43 个 IPC 通道、23 个错误码、969 条文案键（15 个模块去重合计；`COPY` 聚合 810）、9 条注册流水线（番茄 8 + 头条 1）、19 条 `stage-map`、14 条静态守卫。
