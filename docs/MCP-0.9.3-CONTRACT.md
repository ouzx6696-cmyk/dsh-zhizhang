# 0.9.3 通用宿主接口约定

0.9.2 不实现 WorkBuddy、ZCode 或 MCP App。先固定已有业务工具到宿主之间的最小边界，不另建会话数据库或调度器。

`packages/host-generic/src/index.ts` 导出 `executeTool(definition, input, execution, options)`。definition 采用现有 HostToolDefinition（name / description / parameters / execute / output），execution 采用 HostToolExecution（cwd / sessionId / role / callId / arguments / token / signal）。

options 提供既有 GateEngine、`bind(run)` 配置上下文和 `confirm(message, signal)` 作者确认。执行顺序为绑定配置检查门禁、宿主确认、取消检查、原工具执行、原 output.render；返回原始 value 与文本 content。工具确认凭据仍按本次 token 消费。拒绝与工具错误原样抛出，由具体宿主组织可读反馈。

桌面 `pi.ts` 集中所有 Pi SDK 导入及 preflightResult 的使用；`session.ts` 管模型角色、独立子会话和原生工具映射。DSH 保留自身 ToolRuntime 注册和审批机制，两种入口使用同一业务工厂、门禁和本地文件。

未来 MCP stdio 适配器负责 schema / content 映射、stdio 生命周期、会话对象与取消信号，调用 executeTool，不复制门禁或存储业务。头条／长篇可静态拆两个服务，editor 实例按原工具白名单／写入拒绝规则装配。确认优先映射宿主 elicitation；不支持时作者在写作台决定，服务不能自授确认。

MCP App 负责展示写作台和反向消息桥；应用身份、资源 URL、sendMessage 是否能续跑、各宿主 elicitation 与 Hook / Agent 支持均需真机确认后再实现。Claude 兼容插件清单、Skill 和子 Agent 外壳也归 0.9.3，0.9.2 不预置空实现。
