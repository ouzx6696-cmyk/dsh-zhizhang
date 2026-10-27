# 架构与依赖 · 0.18.0

宿主入口 → 工具 / HTTP → 共同作品操作 → 存储与恢复。查询视图单独读取业务数据，不被持久化模块反向依赖。

| 职责 | 实现 |
| --- | --- |
| 宿主按需启用 | `src/index.ts`、`lib/bootstrap.ts` |
| 调用作用域配置 | `tools/context.ts`、`ports/config.ts` 的 AsyncLocalStorage；绑定工具携带实例配置 |
| 稳定公开外观 | `lib/store.ts`，重导出存储与查询接口供现有调用兼容 |
| 工作区与作品操作 | `lib/work-store.ts`，路径、项目发现、候选、采用、业务留痕与汇编 |
| 章节共同保存 | `storage/chapters.ts`，格式、基线、审读、定稿、修订与连续性 |
| 内容身份与历史 | `domain/lifecycle.ts`、`storage/revision.ts` |
| 作者查询 | `lib/panel-query.ts`、`panel-enrich.ts`；不参与领域写入决策 |
| 参考与迁移 | `services/reference.ts`、`tools/reference.ts`；工作区分析不自动入公共库 |
| 库与规划 | `ports/library*`、`ports/analysis/*`、`ports/inspiration.ts` |
| 接续编排 | `tools/methods.ts`、`services/chapter-context.ts` 与 ContextBasis |
| 共享恢复机制 | `storage/recovery-common.ts`；各 journal 保留格式及固定目标白名单 |
| 创作方法与诊断 | `domain/creative-guidance.ts`、MethodRegistry、质量策略与传感器 |
| 作者交互 | `http-api.ts`、`client/client.js`，调用共同作品操作 |

架构护栏解析 TypeScript 实际导入、导出与字面量动态导入，排除纯类型边，拒绝运行时循环和存储反向依赖业务/面板。公开 Store 外观不作为内部持久化依赖入口。库与分析中的底层文件操作直接使用 storage/primitives，时间戳也复用同一实现。类型导入和未使用声明由 TypeScript 配置检查。

五类写入协议复用共同恢复执行器；源文本暂存、卡来源守卫和删除协议保留专用行为。所有协议共享快照与进程所有权核对。保留旧格式，不用新协议猜测恢复旧记录。

文件锁协调配合进程，原子替换不等于 compare-and-swap。路径保护拒绝链接祖先及链接资产；不声称可以抵抗任意外部恶意竞态或保证断电持久性。

插件不内置模型调用。审读记录是声明与版本绑定，不是自动语义验证器。详细契约见 [PORTS.md](PORTS.md)。
