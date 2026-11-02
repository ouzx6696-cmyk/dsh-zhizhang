# AGENTS.md — 写作 Agent 仓库规则

本文件对仓库内所有代码代理生效。先读本文件，再读 `docs/CODING-GUIDE.md`（正反例）。与本文件冲突的旧文档、旧注释、旧习惯一律以本文件为准。

## 项目是什么

Electron 桌面写作客户端，内置 PI SDK（`@earendil-works/pi-coding-agent` 1.4.0），两种模式：今日头条（`packages/toutiao`）与番茄长篇（`packages/fanqie`）。界面在 `apps/desktop`（外壳）和 `packages/workbench/src/client`（写作区组件），设计系统在 `packages/ui`。**DSH 插件形态已退役，不再兼容、不再新增任何宿主适配。**

## 写代码的十条规则

1. **只在信任边界校验。** 边界 = IPC 通道入口、HTTP/路由入口、读文件后的解析、模型工具参数、配置加载、环境变量。在边界把输入解析成明确的类型，失败就报错。边界以内的函数**直接信任类型**：不写 `String(x ?? "")`、`Array.isArray(x) ? x : []`、`typeof x === "string" ? x : ""`、`x || {}`、对非可空值的 `?.`。
2. **不吞错。** 禁止 `catch {}`、`catch { return null | [] | {} | "" | undefined }`、`.catch(() => 默认值)`、`except: pass`。只有明确认识的错误才能降级（例如 `if (err.code === "ENOENT") return [];`），其他错误原样抛出，由界面显示给作者。确需吞错时写 `// allow-catch: 具体原因`，否则守卫失败。
3. **不写不可能的分支。** 类型已排除的情况、恒真/恒假的条件、`a ?? b ?? c ?? ""` 中永远用不到的后项、给内部调用者留的“兼容旧参数/旧字段名”、重复的同一段检查——全部不写。
4. **一件事只有一处实现。** 原子写、读 JSON、存在检查、sha256、ID 生成、时间戳、路径沙箱、锁、恢复日志、状态映射、文案、请求 ID、错误到 HTTP 的映射——先找现有实现再用，**禁止另写一份**。找不到才在对应的公共模块新增。
5. **不留死代码。** 不保留零引用的导出、函数、文件、脚本、文案键、CSS 类、配置项；不保留“以防万一”的旧兼容层；不为测试方便在生产代码加可选参数、导出或分支。只在本文件内使用的符号不加 `export`。
6. **按职责组织文件，不按行数。** 文件行数守卫只是提示。禁止把一个文件机械切成 `xxx-1`、`xxx-2`；一个 CSS 组件前缀（如 `.wb-modal`）只能出现在一个样式文件里。
7. **结构清楚。** 函数单一职责，宜 ≤60 行、嵌套 ≤3 层；长 if 链改成表驱动；命名用业务含义；不建 `utils`/`helpers`/`common` 大杂烩。
8. **类型诚实。** 不新增 `any`、`as any`、`as unknown as`、非空断言 `!`。领域类型（`WorkMeta`、`Candidate`、`Ledger` 等）必须接到真实的读写函数上。`any` 总数只降不升（守卫有基线）。
9. **注释只写“为什么”。** 不复述代码，不写“0.9.x 修复”式流水账，不引用不存在的文件。
10. **测试测行为。** 测试走生产路径（工具经 `executeTool`，接口经路由处理函数，界面经现有 Playwright 场景）。不用正则扫源码当断言，不为测试替身改生产代码，不为让测试通过改质量阈值。

## 禁止事项

- 不新增依赖，除非任务单写明；不改 `package-lock.json` 以外的锁定版本。
- 不改写方法资产（`assets/`、`packages/*/profiles/`、`packages/*/skill/` 下的方法原文）。
- 不改写作业务规则：标题 ≤34 字、质检 ≥84 过线、编辑两轮打回、固定末句、状态词。
- 不改作者可见行为，除非任务单明确列为 bug 修复。
- 不提交、推送、打标签、发布，除非任务单或用户明确要求。
- 不新建测试框架、截图平台、文档目录；不新增 `docs/history/*` 这类版本流水账。

## 工作方式

- 一个任务单一个提交（或一组提交），提交信息写任务编号，例如 `T4: unify storage journals`。
- 改动前跑一次 `npm run verify` 记基线；改完跑任务单列出的验收命令，全部通过才算完成。
- 每个任务结束时在提交说明里写：改了什么、删了多少行（`git diff --stat`）、跑了哪些命令及结果、遗留问题。
- 遇到任务单与代码实际不符（行号漂移、函数已不存在），以代码实际为准，按规则意图处理，并在提交说明里写明。
- 不确定要不要删的代码：先 `git grep` 确认引用；有生产引用就不删，在说明里列出。

## 常用命令

```
npm run verify            # 守卫 + Python + Node 单元/流程
npm run typecheck
npm run lint
npm run desktop:build
npm run test:desktop      # PI 运行时
CI=1 DISPLAY=:99 npm run test:desktop:ui   # 6 个 GUI 场景（需要虚拟显示）
```

## 目录速查

- `apps/desktop/src/main`：主进程、IPC（`main/ipc/*`，参数解析在 `validate.ts`）
- `apps/desktop/src/session`：PI 会话、工具包装、角色、交付
- `apps/desktop/src/renderer`：桌面界面
- `packages/core`：原子写、门禁、方法方案、锁、Python 运行器、工具定义（`defineWriterTool`、`WriterError`）
- `packages/host-generic`：`executeTool`（门禁 → 确认 → 执行）
- `packages/toutiao`、`packages/fanqie`：两种模式的工具、存储、路由处理
- `packages/workbench/src/client`：写作区 React 组件；`src/routes.ts`：路由表与类型
- `packages/ui`：tokens、通用组件、状态映射、文案
