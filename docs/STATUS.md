# 项目状态

- **当前版本**：`1.3.0`

## 最新验证矩阵

| 检查项 | 环境 / 范围 | 状态 | 说明 |
| --- | --- | --- | --- |
| `node scripts/guard.mjs` | 离线沙箱 | 通过 | 覆盖 `G-core`、`G-layer`、`G-facade`、`G-app`、`G-pi`、`G-error`、`G-copy`、`G-type`、`G-exports`、`G-brand`、`G-docs`、`G-rules`、`G-css` |
| Python `unittest` | 头条 226 项 + 番茄 1 项 | 通过 | 覆盖 4.0.0 规则源、门禁、台账与桥接脚本 |
| Node 单元测试 | `test/unit/*.test.mjs`、`test/engine/*.test.mjs` | 通过 | 覆盖原子写、意图重放、锁、预算、错误、状态机、方法注入与 P1 契约 |
| `npm run check`（`tsc -b` + ESLint + Prettier + guard） | Linux 沙箱 Node 24 | 通过 | tsc 0 错误；ESLint 0 错误 0 警告；Prettier 全部合格 |
| Playwright E2E（`test/desktop/ui.spec.mjs`） | Linux 沙箱 + Xorg dummy；Windows 由 CI `e2e` job 执行 | Linux 通过 | 4 条旅程 + 助手停止，假模型服务，不出网 |
| 打包 / 安装升级 | 需 Windows | 未验证 | CI `package` job 与 W1–W20 真机检查单 |
| 真实模型 RM01/RM02 & A/B | 需联网与付费预算批准 | 待执行 | 需作者单独批准预算后运行 |

## 已知问题与待完成事项

- **写作内核接线**：L5 早期摘要检索、L6 规划与参考卡、前章正文、状态冲突巡检及日期/机构提取已实现；章节流水线现已加载前文、当前卷规划及绑定参考卡。
- **收尾修复**：章节/候选/拆书资源路径统一约束；采纳保留审读结果，单独审读可由作者确认写回；修改定稿退回草稿；同目标启动与恢复串行登记；费用包含无效回答，预算按每次预占结算；头条每次修订复核事实，交稿在台账成功后提交并可重试。
- **发行入口**：Windows CI 已补桌面构建和正确的 Python 准备路径；`release:verify` 使用现有 check/test/E2E 命令。仍需 Windows 原生验证。
- **测试规模**：Python 227 项、Node 46 项、桌面 E2E 5 项；本轮只新增 1 个费用重试/恢复用例，其余复用现有旅程。手写 TypeScript 转换器改用已有 esbuild。
- **自动化范围**：记账与十章体检目前由流水线显式发起，定稿动作本身只确认章节状态。
- **依赖审计**：electron-builder/minimatch 构建依赖链有 6 条 moderate 记录，0 high/critical；未更换打包工具版本。
- **基线清零**：`apps/desktop/src/main/` 裸 `throw new Error(` 已清零，TS `as` 断言受基线 258 约束，`packages/workbench/src/client/` 尚存 6 个含 JSX 中文的文件，后续按基线只减不增原则逐步清零。
- **Windows 真机验收**：1.3.0 发版前需完成 W1–W20 真机缩放、高对比度、离线备份与安装升级检查单。
