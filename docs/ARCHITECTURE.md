# 架构

## 桌面调用链与事实归属

## 包与分层

只能向下依赖；`scripts/architecture-guard.mjs` 还检查宿主边界、引擎存储边界、浏览器端边界和依赖环。

## 一次启用
1. Agent 调 `writer_enable(mode, role)`。`core/mode` 认领会话模式，冲突返回 CONFLICT。
2. 对应模式在调用方 Agent 作用域上注册工具、常驻段落、门禁（`tools/pre-execute`）。编辑角色只挂审读相关能力或拒绝写入。
3. 工具解析数据目录时，`core/sessions` 记下这个目录最近的主会话（子代理不记）。

## 独立桌面入口

`apps/desktop/src/session/pi-adapter.ts` 是唯一 Pi SDK 导入边界；`session/` 管理写手、独立编辑和规划角色、精简交接与既有会话文件。Electron main 由 `main/index.ts` 启动，IPC 按领域放在 `main/ipc/*`。渲染层是 `renderer/app` 组装、`renderer/state` 单 store 与 `renderer/features/*` 功能模块；React 工作区直接复用写作台组件。工具调用经 host-generic 回到原业务，不重建方法或存储。

统一根将书放在 novels、文章放在 toutiao、资料与作者偏好放在 .writer。跨入口的作品租约与轻量快照在 core，共享业务写入检查租约。0.9.3 继续基于内置 PI 完善自有客户端的会话、角色协作、上下文和作品一致性，见[开发计划](history/PLAN-0.9.3.md)；不新增其他 Agent 工具适配。
