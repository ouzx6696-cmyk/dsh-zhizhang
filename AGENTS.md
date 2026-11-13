# AGENTS.md

给在本仓库工作的 AI 代理的说明。维护者是仓库作者（ouzx6696-cmyk）；作者在对话里的要求优先于本文件。

## 项目

织章：Electron 桌面写作客户端，内置 PI SDK，两种模式——番茄长篇（`packages/fanqie`）与今日头条图文（`packages/toutiao`）。规划、起稿、审读、修订、质检走成可暂停、可恢复的流水线，采纳、定稿、交稿由作者决定。DSH 插件形态已退役。

当前状态看 `docs/STATUS.md`，版本变化看 `CHANGELOG.md`，全局地图看 `docs/PROJECT-COGNITION.md`。

## 没有作者明确同意不要做

- 改写作业务规则：标题 ≤34 字、质检 ≥84 过线、编辑两轮打回、固定末句、状态词、头条评分规则版本。
- 改写方法资产原文：`assets/`、`packages/*/profiles/`、`packages/*/skill/`。
- 花钱：调用真实付费模型、跑真实模型 A/B 或验收。
- 推送 `v*` 标签（推送即自动发布 Latest）、改动已发布的 Release、强推 `master`。
- 新增运行时依赖。

其余改动（修 bug、重构、改界面、改文档、开分支推送）按作者交代的任务直接做。

## 怎么交付

- 先 `git pull` 看最新 `master`：仓库里还有其他代理的提交。
- 在分支上改，`npm run verify` 通过、CI 全绿后再合 `master`。
- 提交信息写清改了什么、为什么；跑过的验收命令和结果写进提交说明或回复里。
- 没跑过的就说没跑过，不要写成已验证；本地假模型的结果不代表真实模型效果。

## 代码约定

`scripts/architecture-guard.mjs` 在 verify 里执行，会检查依赖方向、吞错、`any` 上限等；守卫失败就修代码，不要放宽守卫。要点：

- 在边界（IPC、路由、读文件、模型工具参数、配置）解析输入，内部信任类型。
- 不吞错；只降级明确认识的错误（如 `ENOENT`）。确需吞错写 `// allow-catch: 原因`。
- 同一件事只有一处实现（原子写、锁、路径沙箱、状态映射、文案等），先找现有实现。
- 删掉零引用代码，不留兼容旧参数的分支；删前先 `git grep` 确认没有生产引用。
- 不新增 `any`、`as unknown as`、非空断言。
- 测试走生产路径，不为测试改生产代码，不为过测试改阈值。

## 常用命令

```
npm run verify            # 守卫 + Python + Node 单元/流程
npm run typecheck
npm run lint
npm run desktop:build
npm run test:desktop      # PI 运行时 + 本地假模型
CI=1 DISPLAY=:99 npm run test:desktop:ui   # 完整 GUI 旅程（需要虚拟显示）
```

需要 Node ≥24.11、Python ≥3.10。

## 目录

- `apps/desktop/src/main`：主进程、IPC（`main/ipc/*`，参数解析在 `validate.ts`）
- `apps/desktop/src/session`：PI 会话、工具包装、角色、交付
- `apps/desktop/src/renderer`：桌面界面
- `packages/core`：原子写、门禁、方法方案、锁、Python 运行器、工具定义；`src/execute.ts` 是 `executeTool`
- `packages/toutiao`、`packages/fanqie`：两种模式的工具、存储、路由处理
- `packages/workbench/src/client`：写作区 React 组件；`src/commands.ts` 是命令契约
- `packages/ui`：tokens、通用组件、状态映射、文案
