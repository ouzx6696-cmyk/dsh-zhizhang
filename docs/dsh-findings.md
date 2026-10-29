# DSH 扩展点验证结论（T0.4）

基线：`deepseek-ai/deepseek-harness` 标签 `dsh-v0.2.1-rc.4`，npm `@deepseek-ai/dsh@0.2.1-rc.4`。
"已验证"指在本仓库测试里用**真实 DSH 组件**跑通：`test/dsh-real.test.mjs`（cordis + dsh-tools + dsh-scope + dsh-system-prompt）与 `test/e2e/run-headless.mjs`（真实 `dsh` CLI headless profile + 打包好的 tgz）。

| # | 扩展点 | 结论 | 证据 / 源码出处 |
|---|---|---|---|
| 1 | `systemPrompt.section()` 注入段落 | ✅ 已验证 | 启用后 `prompt_section:true`；headless 端到端里后续每次模型请求都带上总则（以会话内系统更新的形式出现在 messages 中，而非首条 system，保留前缀缓存）。用法同织章 0.20.0 |
| 2 | 按会话挂载 / `tools.restrict` | ✅ 已验证（按会话注册） | 在 `exec.agent.ctx` 上 `tools.register`，其他会话看不到（集成测试断言）。`tools.restrict()` 仅允许 scoped ctx（`packages/core/tools/src/index.ts` restrict()），本期未用，M2 体裁路由再用 |
| 3 | `agent.inject()` | ⏸ 未用 | M1 不需要；M3 写作台投递时验证 |
| 4 | `tools/pre-execute` deny / ask + 审批 | ✅ 已验证 | `PreToolDecision` 定义见 `packages/core/tools/src/index.ts`；ask 经 `ctx.get('approval').request()`，无审批服务即拒绝（同文件 resolveAsk）。集成测试覆盖 allowed-once / rejected；headless 无审批通道 → 拒绝 |
| 5 | 子代理 + agent preset | ⏸ 未验证 | M2 角色路由时做（`ctx.subagents`、`dsh-agent-preset`） |
| 6 | 插件内调用 Python | ✅ 已验证（Linux） | 用 Node `child_process` 直接调用系统 Python，不依赖 DSH 沙箱；Windows 待 ⚑ 实测 |
| 7 | Chat 节点 `ConversationNodeDefinition` | ⏸ 未验证 | M2 体裁选择卡时做；M1 用 HTTP 写作台替代 |
| 8 | `ctx.commands` 斜杠命令 | ⏸ 未验证 | M4 |
| 9 | 插件会话状态记录 API | ⏸ 未用 | M1 状态全部落在 meta.json |
| 10 | Skill 目录加载 | ↪ 改用工具装载 | DSH 支持 `customSkillDirs`（`packages/skill/skill-filesystem/README.md`），但本插件用 `toutiao_method_get` 按步装载，更可控、能测 |
| — | 会话工作目录 | ✅ 已验证 | `workingDirectory.get(session)`（`packages/session/working-directory/src/index.ts`）→ `session.header.cwd` → `process.cwd()`；headless 中产物落在会话 cwd 下 |
| — | webServer 路由（写作台） | ⚠ 部分 | 注册方式同织章与 `packages/credentials/deepseek-account-platform`；headless 无 webServer，未在 Web/桌面实测 ⚑ |
| — | bundle 安装 | ✅ 已验证 | `dsh plugin --profile headless add <tgz>` 自动写入 `dsh.profile.bundles`；`--dump-config` 出现 `writer-toutiao`；按 id 覆盖 config 生效 |
| — | 工具返回值约束 | ✅ 已验证 | 返回值须为无损 JSON 并符合 `output.schema`（`packages/core/tools/src/json-schema.ts` 子集）；adapter 统一 JSON 化 |

## 关键注意
- `0.2.2-alpha.2`（2026-10-28）要求插件迁移 `tools.resolve/executable` 与提示词组装接口、最低 Node 24.9。升级时只改 `packages/dsh-adapter`，并重跑 `test:dsh` 与 `test:e2e`。
- 门禁的"作者确认"在工具内还有一道复核：只有门禁确实为本次调用（`exec.token`）发起过 ask 并被放行，`toutiao_status → 已交稿` 才会执行。宿主门禁失效时，工具自身也拒绝。


## 0.4.0 新增与收口（锁定 dsh-v0.2.1-rc.4）

- 会话普通用户消息：`packages/api/session-controller/src/index.ts` 的 SessionController.prompt；请求字段在 `packages/api/session-controller/src/types.ts` 的 SessionPromptRequest/PromptContentPart，使用 requestId、sessionId、mode=queue、content=[{type:text,text}] 和 AbortSignal。没有使用猜测的 inject/sendMessage 签名。
- 子会话判别：`packages/core/session/src/types.ts` 的 SessionHeader.origin、parentSession；业务角色由本插件的 fanqie_enable 记录。
- 工具执行/注册及 tools/result/pre-execute：`packages/core/tools/src/index.ts`。内部启用织章通过 scoped tools.execute，不直接绕过执行管线调用工具正文。
- 提示段落：`packages/core/system-prompt/src/index.ts` 的 section。
- 工作目录：`packages/session/working-directory/src/index.ts` 的 get。
- 面板路由：`packages/host/webserver/src/index.ts` 的 WebServer.register。
- Cordis get/on/inject/effect：`vendor/cordis/src/context.ts`、`events.ts`、`fiber.ts`；可选配置 Schema 来自 `vendor/schemastery/src/`。
- 原织章客户端继续通过 rc.4 的 `packages/client/modules/src/` 模块加载与 `packages/client/ui-slots/src/` 席位接口挂载；发行模块 id 为 dsh-writer，原面板/API id 保持兼容。

原织章服务端宿主注册、系统段落、路由和可选 Schema 现均经 packages/dsh-adapter。共享存储定稿回报检查不是 DSH API，直接位于本项目 packages/zhizhang/src/lib/storage/chapters.ts。
