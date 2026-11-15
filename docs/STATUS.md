# 项目状态

- **当前版本**：`1.3.0`

## 最新验证矩阵

| 检查项 | 环境 / 范围 | 状态 | 说明 |
| --- | --- | --- | --- |
| `node scripts/guard.mjs` | 离线沙箱 | 通过 | 覆盖 `G-core`、`G-layer`、`G-facade`、`G-app`、`G-pi`、`G-error`、`G-copy`、`G-type`、`G-exports`、`G-brand`、`G-docs`、`G-rules`、`G-css` |
| Python `unittest` | 头条 226 项 + 番茄 1 项 | 通过 | 覆盖 4.0.0 规则源、门禁、台账与桥接脚本 |
| Node 单元测试 | `test/unit/*.test.mjs`、`test/engine/*.test.mjs` | 通过 | 覆盖原子写、意图重放、锁、预算、错误、状态机、方法注入与 P1 契约 |
| `npm run check`（`tsc -b` + ESLint + Prettier + guard） | Linux 沙箱 Node 24 | 通过 | tsc 0 错误；ESLint 0 错误 3 警告；Prettier 全部合格 |
| Playwright E2E（`test/desktop/ui.spec.mjs`） | Linux 沙箱 + Xvfb；Windows 由 CI `e2e` job 执行 | Linux 通过 | 4 条旅程 + 助手停止，假模型服务，不出网 |
| 打包 / 安装升级 | 需 Windows | 未验证 | CI `package` job 与 W1–W20 真机检查单 |
| 真实模型 RM01/RM02 & A/B | 需联网与付费预算批准 | 待执行 | 需作者单独批准预算后运行 |

## 已知问题与待完成事项

- **P1 写作内核增量项**：`packages/fanqie/src/context/builder.ts` 的 L5 检索/L6 参考卡注入、`packages/fanqie/src/bible/store.ts` 的状态冲突巡检（`state_conflict`）及 `packages/toutiao/src/domain/claims.ts` 的日期/机构抽取尚待补齐完整实现（已在 `test/unit/fanqie-toutiao-p1.test.mjs` 登记 TODO 用例）。
- **基线清零**：`apps/desktop/src/main/` 裸 `throw new Error(` 已清零，TS `as` 断言 155 处（基线 258），`packages/workbench/src/client/` 尚存 6 个含 JSX 中文的文件，后续按基线只减不增原则逐步清零。
- **Windows 真机验收**：1.3.0 发版前需完成 W1–W20 真机缩放、高对比度、离线备份与安装升级检查单。
