# 项目状态

- **当前发布版本**：`1.3.0`（`origin/master@20c150a`；本地 `master` 领先 8 个提交，未发版、未推送）
- **当前代码基线**：`master@83bf7f7`（v1.4 Wave 0 的 M0 线全部合入，另含文档同步提交）
- **最后核对**：2026-11-17 10:48（`npm run check` 复跑 exit 0；测试数字为同日实跑）

## 最新验证矩阵

| 检查项 | 环境 / 范围 | 状态 | 说明 |
| --- | --- | --- | --- |
| `npm run check` | Windows 11 本机 Node 24 + Linux CI | 通过 | 2026-11-17 10:48 复跑 exit 0（约 25 s）；`tsc -b`、`selftest`、ESLint、Prettier、`guard.mjs`、棘轮与体积预算全绿；实测 `any=0`、`!=0`、`!=:0`、`as=171`、`main` 裸错误 0、零引用导出 20 |
| Python `unittest` | 头条 226 项 + 番茄 1 项 | 通过 | 覆盖 4.0.0 规则源、门禁、台账与桥接脚本 |
| Node 单元/引擎测试 | `test/unit/*.test.mjs`、`test/engine/*.test.mjs` | 通过 83/83 | 含原子写并发重试、fanOut 持久化串行化、标题拆分、草稿不落 localStorage、切换竞态守卫 |
| 桌面 E2E | `test/desktop/m0.spec.mjs` + `ui.spec.mjs`，13 条旅程 | 通过 13/13 | 本机需 `ELECTRON_DISABLE_SANDBOX=1`；临时目录在仓库 `test/.tmp/`（见已知问题） |
| 桌面构建 | electron-vite（主进程/预加载/渲染） | 通过 | 渲染资源分块产出；体积预算门通过 |
| 打包 / 安装升级 | 需 Windows 原生环境 | 未验证 | CI `package` job 覆盖；W01–W20 真机检查单已备，待作者执行两轮 |
| 真实模型 RM01/RM02 & A/B | 需联网与付费预算批准 | 待执行 | 需作者单独批准预算后运行 |

## v1.4 进度（30 张卡）

| 状态 | 数量 | 卡 |
| --- | ---: | --- |
| 已合入 `master` | 4 | M0-1（质检收口）、M0-2（草稿落盘与编辑态标题）、M0-3（竞态/引导/历史详情，含 DEF-01/02 修复）、INF-01（质量门增强） |
| 待审核 | 1 | T-01（假模型夹具，`65b60bf` → `integration/v1.4@69374fa`） |
| 进行中（部分） | 1 | A-01（只冻结 F8；F1–F7、F9、ADR-001–025 未产出） |
| 准备完成待实机 | 1 | M0-4（检查单、记录模板、1.3.0 基线包已备） |
| 未开始 | 23 | A-02 与全部 M1–M5 功能卡 |

已合入部分约 7.5 人天 / 88.5 人天（约 8.5%），不含 A-01 的 F8、M0-4 实机工日与审核返工。M0 线是 v1.3 遗留缺陷修复，不推进 v1.4 功能主链。

**关键链断点**：`A-01 完整冻结（缺 plans/novel-manager/plan.md）→ A-02 → D-02 → I-02 → I-03 → M1 → … → T-02 → ACC-01 → ACC-02 → v1.4.0`。

## 已知问题与待完成事项

- **A-01 阻塞（P0）**：`plans/novel-manager/plan.md` 经全盘搜索确认不存在；A-01 无法按 DoD 逐项核对，A-02 不能开工。计划 §2 已含 F1–F10 正文与 25 条 ADR 裁决，可作替代冻结的基础，但需作者书面批准并登记 ADR。
- **写作内核接线**：L5 早期摘要检索、L6 规划与参考卡、前章正文、状态冲突巡检及日期/机构提取已实现；章节流水线加载前文、当前卷规划及绑定参考卡。
- **桌面外壳（v1.4 M0 线）**：切换作品竞态守卫、引导「稍后再说」、历史运行只读详情（含运行级错误与候选稿「打开对照」）已交付；编辑草稿经 IPC 落到 `.zhizhang/drafts/`，编辑态标题单独编辑，不再写 `localStorage` 正文。
- **导入/记账产物链接待接**：历史详情里「导入 → 提案页」「记账 → 确认屏」两个入口依赖 v1.4 Wave 1 的 U-02 / U-06 界面。
- **Windows 并发写盘韧性**：`atomicWrite` 对 `storage.locked` 指数退避（约 10 秒）；`fanOut` 并行阶段的运行记录在同一次运行内串行化；两项均有回归测试。
- **E2E 环境限制（本机）**：Chromium 沙箱无法启动，需 `ELECTRON_DISABLE_SANDBOX=1`；本机安全软件在高频临时写盘后会拒绝进程在 `%TEMP%` 新建文件，故 E2E 状态目录放在仓库 `test/.tmp/`（已 gitignore）。CI 不受影响。
- **发行入口**：Windows CI 已覆盖桌面构建、`e2e`、`e2e-linux`（xvfb）与 `package` job（tag / 手动触发）；仍需 Windows 真机验收。
- **自动化范围**：记账与十章体检由流水线显式发起，定稿动作本身只确认章节状态。
- **依赖审计**：electron-builder / minimatch 构建依赖链有 6 条 moderate，0 high/critical；未更换打包工具版本（2026-11-17 沿用，未重新联网复核）。
- **Windows 真机验收**：`plans/v1.4/windows/checklist.md` 已备 W01–W20 与两轮记录模板；原版 `plans/v1.3/integrated.md` 未随工作区提供，条目按仓库可考引用重建，待作者核对。v1.3.0 基线安装包已本地构建并记录 SHA256。
- **文档口径**：`docs/plans/v1.3.md` 在当前工作区被删除（非助手改动），保持未暂存；`docs/` 现有 4 份 + 根文档 3 份 = 7 份，距 `G-docs` 上限 8 份剩 1 份余量。
- **本轮校正（2026-11-17）**：头条文章目录统一为 `meta.json` 与 `交稿单.md`（旧文档误写 `article.json` / `delivery.md`）；工作台命令实测 90 条（旧口径 45 条为 v1.3 早期数字）；移除「专注模式（Ctrl+. / F11）」「命令面板（Ctrl+K）」描述——代码中无对应实现，`commandPaletteText*` 仅剩未被引用的文案键，实际快捷键为 `Ctrl+,` / `Ctrl+.` / `Ctrl+1·2·3`。

## 质量基线

- `apps/desktop/src/main/` 裸 `throw new Error(` = 0；`any` = 0；非空断言 `!` = 0；确定赋值 `!:` = 0；`as` 断言 171（基线 258，只减不增）；零引用导出 20。
- 13 个文件超过 400 行（8 个源码 + 5 个样式），最大 `packages/fanqie/src/pipelines/chapter/index.ts` 739 行、`packages/ui/src/styles/primitives.css` 934 行；由 `G-size` 提示、不阻断。
- 契约规模：90 条命令、42 个 IPC 通道、23 个错误码、1,002 条文案键、8 条流水线、19 条 `stage-map`、14 条静态守卫。
