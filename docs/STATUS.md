# 项目状态

- **当前发布版本**：`1.3.0`（`master` 已领先 7 个本地提交，未发版、未推送）
- **当前代码基线**：`master@4820d4e`（v1.4 Wave 0 的 M0 线全部本地合入）
- **最后核对**：2026-11-17（全部数字为本地实跑结果）

## 最新验证矩阵

| 检查项 | 环境 / 范围 | 状态 | 说明 |
| --- | --- | --- | --- |
| `npm run check` | Windows 11 本机 Node 24 + Linux CI | 通过 | `tsc -b`、`selftest`、ESLint、Prettier、`guard.mjs`、棘轮与体积预算全绿；守卫覆盖 `G-core`、`G-layer`、`G-facade`、`G-app`、`G-pi`、`G-error`、`G-copy`、`G-type`、`G-exports`、`G-brand`、`G-docs`、`G-rules`、`G-css`、`G-size` |
| Python `unittest` | 头条 226 项 + 番茄 1 项 | 通过 | 覆盖 4.0.0 规则源、门禁、台账与桥接脚本 |
| Node 单元/引擎测试 | `test/unit/*.test.mjs`、`test/engine/*.test.mjs` | 通过 83/83 | 新增：原子写并发重试、fanOut 并行持久化串行化、标题首行拆分、草稿不落 localStorage、切换竞态守卫 |
| 桌面 E2E | `test/desktop/ui.spec.mjs` + `m0.spec.mjs`，13 条旅程 | 通过 13/13 | 本机需 `ELECTRON_DISABLE_SANDBOX=1`；临时目录在仓库 `test/.tmp/`（见已知问题） |
| 桌面构建 | electron-vite（主进程/预加载/渲染） | 通过 | 渲染资源分块产出，最大单块 `Studio` 约 35 KB |
| 打包 / 安装升级 | 需 Windows 原生环境 | 未验证 | CI `package` job 覆盖；W01–W20 真机检查单已备好，待作者执行两轮 |
| 真实模型 RM01/RM02 & A/B | 需联网与付费预算批准 | 待执行 | 需作者单独批准预算后运行 |

## 已知问题与待完成事项

- **写作内核接线**：L5 早期摘要检索、L6 规划与参考卡、前章正文、状态冲突巡检及日期/机构提取已实现；章节流水线现已加载前文、当前卷规划及绑定参考卡。
- **收尾修复**：章节/候选/拆书资源路径统一约束；采纳保留审读结果，单独审读可由作者确认写回；修改定稿退回草稿；同目标启动与恢复串行登记；费用包含无效回答，预算按每次预占结算；头条每次修订复核事实，交稿在台账成功后提交并可重试。
- **桌面外壳（v1.4 M0 线）**：切换作品竞态守卫、引导「稍后再说」、历史运行只读详情（含运行级错误与候选稿「打开对照」产物链接）已交付；编辑器草稿改经 IPC 落到写作文件夹 `.zhizhang/drafts/`，编辑态标题单独编辑，不再写 `localStorage` 正文。
- **导入/记账产物链接待接**：历史详情里「导入 → 提案页」「记账 → 确认屏」两个入口依赖 v1.4 Wave 1 的 U-02 / U-06 界面，界面落地后再接。
- **Windows 并发写盘韧性**：`atomicWrite` 对 `storage.locked` 做指数退避重试（约 10 秒），流水线并行阶段的持久化在同一次运行内串行化；两项均有回归测试。
- **E2E 环境限制（本机）**：Chromium 沙箱无法启动，需 `ELECTRON_DISABLE_SANDBOX=1`；本机安全软件会在高频临时写盘后长时间拒绝该进程在 `%TEMP%` 新建文件，故 E2E 状态目录放在仓库 `test/.tmp/`（已 gitignore）。CI 不受影响。
- **发行入口**：Windows CI 已补桌面构建和正确的 Python 准备路径；`release:verify` 使用现有 check/test/E2E 命令。仍需 Windows 原生验证。
- **自动化范围**：记账与十章体检目前由流水线显式发起，定稿动作本身只确认章节状态。
- **依赖审计**：electron-builder/minimatch 构建依赖链有 6 条 moderate 记录，0 high/critical；未更换打包工具版本（2026-11-17 沿用，未重新联网复核）。
- **质量基线**：`apps/desktop/src/main/` 裸 `throw new Error(` 为 0；`any` 为 0；非空断言为 0；`as` 断言 171，基线 258（只减不增）；8 个源码文件超过 400 行（最大 `packages/fanqie/src/pipelines/chapter/index.ts` 739 行），另有 5 个样式文件超线，均由 `G-size` 提示不阻断。
- **Windows 真机验收**：`plans/v1.4/windows/checklist.md` 已备 W01–W20 与两轮记录模板；原版清单 `plans/v1.3/integrated.md` 未随工作区提供，条目按仓库可考引用重建，待作者核对。v1.3.0 基线安装包已本地构建并记录 SHA256。
- **文档口径**：`docs/plans/v1.3.md` 在当前工作区被删除（非助手改动），保持未暂存；README 中的应用内文档导航已移除指向它的链接。
