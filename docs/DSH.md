# 与 DSH 宿主的接口

基线：`deepseek-ai/deepseek-harness` 标签 `dsh-v0.2.1-rc.4`，npm `@deepseek-ai/dsh@0.2.1-rc.4`。所有宿主调用集中在 `packages/host`（结构类型 + 能力探测，零 `@deepseek-ai/*` 运行时依赖）。
"已验证"指在测试里用**真实 DSH 组件**跑通：`test/dsh/runtime.test.mjs`（cordis + dsh-tools + dsh-scope + dsh-system-prompt）与 `test/e2e/run-toutiao.mjs`、`test/e2e/run-fanqie.mjs`（真实 `dsh` CLI headless + 打包好的 tgz + 真实 subagent）。

| 接口 | 用途 | 结论 | 证据 / 源码出处 |
|---|---|---|---|
| `tools.register`（宿主根） | 只注册 `writer_enable` | ✅ 已验证 | 启用前模型只看到 `writer_enable`（e2e 断言） |
| `exec.agent.ctx.tools.register` | 按会话挂载模式工具 | ✅ 已验证 | 其他会话看不到（集成测试断言） |
| `systemPrompt.section()` | 常驻规则段落 | ✅ 已验证 | headless 里后续每次模型请求都带上规则（以会话内系统更新出现在 messages 中，保留前缀缓存） |
| `tools/pre-execute` deny / ask + 审批 | 门禁与作者确认 | ✅ 已验证 | `PreToolDecision` 见 `packages/core/tools/src/index.ts`；ask 经 `ctx.get('approval').request()`，无审批服务即拒绝 |
| 子代理深度 `delegationDepth` | 编辑子代理识别、投递目标只记主会话 | ✅ 已验证 | `packages/subagent/subagent/src/depth.ts`；长篇 e2e 断言真实子会话不被记为投递目标 |
| 会话工作目录 | 数据目录默认相对会话 cwd | ✅ 已验证 | `workingDirectory.get(session)` → `session.header.cwd` → `process.cwd()` |
| 工具返回值约束 | 统一 JSON 返回 | ✅ 已验证 | 返回值须为无损 JSON 并符合 `output.schema`（`packages/core/tools/src/json-schema.ts` 子集） |
| bundle 安装 | `dsh plugin add <tgz>` | ✅ 已验证 | 自动写入 `dsh.profile.bundles`；按 id 覆盖 config 生效 |
| 插件内调用 Python | 规则脚本 | ✅ 已验证（Linux） | Node `child_process` 直接调用系统 Python；Windows 待桌面实测 ⚑ |
| `webServer.register` | 写作台接口 | ⚠ 部分 | 注册方式同 `packages/credentials/deepseek-account-platform`；headless 无 webServer，桌面待实测 ⚑ |
| `sessionController.prompt` | 写作台按钮发到对话 | ⚠ 按源码接入，桌面待实测 ⚑ | `packages/api/session-controller/src/index.ts` `@Remote('prompt')`；`commands.ts` 按 requestId 去重、可恢复冷会话、拒绝子代理会话。headless 没有该服务 → 写作台显示不能投递 |
| 客户端模块 `window.__ModuleLoader__` + slots | 侧栏「写作台」、插件详情卡 | ⚠ 构建校验通过，桌面待实测 ⚑ | `main`、`sidebar.panellist`、`plugins.detail.section` 三种席位 |
| `customSkillDirs` | — | 未用 | 方法文件由 `toutiao_method_get` / `fanqie_forge_get` 按步装载，更可控、能测 |

## 注意
- `0.2.2-alpha` 要求插件迁移 `tools.resolve/executable` 与提示词组装接口、最低 Node 24.9。升级时只改 `packages/host`，并重跑 `test:dsh` 与两条 e2e。
- "作者确认"在工具内还有一道复核：只有门禁确实为本次调用（`exec.token`）发起过 ask 并被放行，`toutiao_status → 已交稿` 才会执行。宿主门禁失效时，工具自身也拒绝。
