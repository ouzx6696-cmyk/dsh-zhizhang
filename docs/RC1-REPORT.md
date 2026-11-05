# 0.9.9 RC1 开发报告

- 基线：云端 `master` @ `ab70900`（版本 0.9.9，2026-11-05 提交）
- 评估对象：本地 0.9.9.1 工作区（43 文件改动，未提交）
- 报告日期：2026-11-06

## 一、结论

RC1 以云端 0.9.9 为基线，只吸收 0.9.9.1 中可独立验证的部分，放弃依赖缺失文件的重构成果。

三点判断：

1. 0.9.9 基线代码可编译（packages 与桌面端 typecheck 均为 0 错误），可作为 RC1 起点。
2. 11 个缺失文件已按云端实现重建，前端拆分恢复可编译；类型错误从 203 个清理到 0。
3. typecheck、lint、架构守卫、桌面构建全部通过；测试结果与基线持平。

> 重建过程与逐项数据见第七节。

## 二、基线核验

### 2.1 规模

| 目录 | 文件数 | 行数（ts/tsx/jsx） |
| --- | --- | --- |
| `apps/desktop/src` | 77 | 8,289 |
| `packages/fanqie/src` | 157 | 16,513 |
| `packages/toutiao/src` | 11 | 1,622 |
| `packages/workbench/src` | 18 | 3,993 |
| `packages/core/src` | 16 | 1,264 |
| `packages/ui/src` | 5 | 1,007 |
| **合计** | **284** | **32,688** |

另有 Python 脚本 16 个、`test/*.mjs` 20 个。

### 2.2 实测结果

| 检查项 | 命令 | 结果 |
| --- | --- | --- |
| 类型检查（packages） | `tsc -p tsconfig.json --noEmit` | 0 错误 |
| 类型检查（桌面端） | `tsc -p apps/desktop/tsconfig.json --noEmit` | 0 错误 |
| 架构守卫 | `npm run guard` | 通过，**11 条提示** |
| 单元/流程测试 | `npm run verify` | 131 项，Windows 本地 1–3 项失败 |

### 2.3 守卫的 11 条提示

这 11 条正是 0.9.9.1 试图消除的目标：

| 类型 | 文件 | 行数 |
| --- | --- | --- |
| 组件超 400 行 | `workbench/src/client/fanqie/useFanqie.js` | — |
| 组件超 400 行 | `workbench/src/client/shared/Profiles.jsx` | 714 |
| 组件超 400 行 | `workbench/src/client/toutiao/ToutiaoApp.jsx` | — |
| 组件超 400 行 | `apps/desktop/src/renderer/app/useDesktopController.ts` | 465 |
| 组件超 400 行 | `apps/desktop/src/renderer/features/agent/AgentPanel.tsx` | 416 |
| 样式超 300 行 | `apps/desktop/src/styles/agent.css` | 317 |
| 样式超 300 行 | `apps/desktop/src/styles/shell.css` | 771 |
| 样式超 300 行 | `packages/ui/src/styles/components.css` | 324 |
| 样式超 300 行 | `workbench/src/client/styles/base.css` | 1149 |
| 样式超 300 行 | `workbench/src/client/styles/profiles.css` | 301 |
| 样式超 300 行 | `workbench/src/client/styles/reader.css` | 302 |

### 2.4 基线已知缺陷

Windows 本地实测的失败项，均与平台或运行时刻相关，Linux CI 不出现：

| 用例 | 现象 | 原因 |
| --- | --- | --- |
| `T3-12 方案与资产目录 IO 故障` | `assert.rejects` 未捕获 | Windows `stat(file/sub)` 返回 `ENOENT`，Linux 返回 `ENOTDIR` |
| `全流程：故事线长图文` | 期望 `2026-11-06-jingwei`，实际 `2026-11-05-jingwei` | 产物目录按 UTC 日期命名，测试按本地日期断言；UTC+8 的 00:00–08:00 必然不一致 |
| `台账并发：20 篇` | `PermissionError: ... log.csv.lock` | Windows 下 Python 并发创建锁文件被拒 |

第二条是产品缺陷：面向中文作者时，作品目录日期应取本地日期。RC1 需单独排期，不在本轮范围。

## 三、0.9.9.1 价值评估

本地工作区相对基线：43 文件修改，+993 / −3420，无新增、无删除。

### 3.1 A 类：可直接吸收

独立性强、无缺失依赖、行为等价或明确修复。

| # | 改动 | 位置 | 收益 | 风险 |
| --- | --- | --- | --- | --- |
| A1 | `atomicWrite` 复用父目录校验结果，父目录已存在时跳过 `mkdir` 与二次祖先链 `lstat` | `core/src/fsx.ts` | 每次原子写省一次 `mkdir` + 一次完整 `lstat` 链 | 无。父目录存在时 `mkdir` 本就是 no-op，二次校验无额外价值 |
| A2 | `listDir` 改用 `isMissingFileError` | `core/src/fsx.ts` | 消除手写 `code === "ENOENT"` 判断 | 无 |
| A3 | 写作活动按 16 章分批并发 | `fanqie/src/engine/dashboard-query.ts` | 100 章统计从 100 次串行 I/O 降到 7 批 | 无。累加仍在批间串行，`daily` 顺序不变 |
| A4 | 候选列表按 16 个分批并发 | `fanqie/src/engine/storage/candidates.ts` | 面板轮询的候选读取并行化 | 无。`rows` 顺序由末尾 `sort` 保证 |
| A5 | 作品列表按 16 个分批并发 | `fanqie/src/engine/storage/projects.ts` | 多作品扫描提速 | 无。`undefined` 过滤后顺序不变 |
| A6 | 面板快照的 library / inspiration / activity 三路并行 | `fanqie/src/engine/panel-query.ts` | 三块独立只读查询并发 | 无。`activity` 从末尾 await 提前到并行，取值等价 |
| A7 | 拆书分析列表并发 + `readJsonl` 并行 | `fanqie/src/engine/ports/analysis/meta.ts` | 分析列表读取并行 | 低。`null` 条目过滤后顺序不变；`ENOENT` 判断写法另见 B3 |
| A8 | 路由匹配改用 `Set` | `fanqie/src/workbench/api.ts` | O(n) → O(1) | 无。路由数量少，收益有限但正确 |
| A9 | `runner.ts` 的 `catch (err: any)` 收窄为 `unknown` | `core/src/runner.ts` | 减少 `any` | 无 |
| A10 | `workspace-lock.ts` 三处 `any` 收窄，`live()` 用 `instanceof` 判定 | `core/src/workspace-lock.ts` | 减少 `any` | 无。`ESRCH` 语义等价 |
| A11 | 字数统计从 `[...text].filter()` 改为单次 `for...of` | `workbench/src/client/shared/SourceEditor.jsx` | 省一次数组分配 + 一次遍历 | 无。`for...of` 与 `[...text]` 同为 code point 迭代 |
| A12 | 项目切换菜单补 `Escape` 与点击外部关闭，补 `aria-haspopup` / `aria-expanded` | `apps/desktop/src/renderer/features/topbar/TopBar.tsx` | 修复菜单无法关闭的缺陷 | 无 |
| A13 | 后台任务列表提取 `backgroundRunning` 变量 | `TopBar.tsx` | 消除一次重复 `filter` | 无 |
| A14 | 4 个样式表清理重复覆盖规则 | `agent.css` / `components.css` / `profiles.css` / `reader.css` | 净减 85 行 | 无。实测顶层选择器零丢失，仍在使用的类全部保留 |

### 3.2 B 类：修正后吸收

思路成立，但实现引入了类型或一致性问题。

| # | 改动 | 问题 | 修正方式 |
| --- | --- | --- | --- |
| B1 | `profiles.ts` 的 `userMetas` / `listProfiles` / `profileDetail` 并发化 | 新增 `as ProfileMeta` 断言，违反规则 8；`profileDetail` 重复调用 `lib.defaultIds()` | 用具名类型守卫替代断言；`defaultIds` 结果从 `Promise.all` 复用 |
| B2 | `ports/inspiration.ts` 并发化 | 两处 `(err as { code?: string })?.code === "ENOENT"`，与 `isMissingFileError` 重复实现 | 统一改用 `isMissingFileError` |
| B3 | `analysis/meta.ts` 的 `listAnalyses` | 同上，`as` 断言判断 ENOENT | 同上 |
| B4 | `markdown.jsx` 改 `React.memo` | `.jsx` 中 props 推断为 `object`，桌面端 `Markdown.tsx` 报 TS2322 | 补 props 类型注解，或改名为 `.tsx` |
| B5 | `projects.ts` 的 `listProjects` 并发化 | 外层 `Promise.all` 无分批，内层 16 × 外层 N，并发度可能翻倍 | 外层同样按 8–16 分批 |
| B6 | `readJsonlCached` 缓存解析结果 | 返回 `map(item => ({...item}))` 为浅拷贝，嵌套对象仍共享缓存引用 | 文档标注"只读"约定，或对已知嵌套结构做深拷贝 |

### 3.3 C 类：依赖缺失文件（已重建）

11 个新增文件在本地工作区与仓库全部历史中均不存在。已按云端 0.9.9 的实现重建，结果见第七节。

| 被拆文件 | 拆出模块 | 引用位置 |
| --- | --- | --- |
| `AgentPanel.tsx` | `AgentMessages.tsx` | `AgentPanel.tsx:4`，`:194-195` 实际渲染 |
| `Profiles.jsx` | `ProfileParts.jsx` | `Profiles.jsx:16` |
| `useFanqie.js` | `actions.js` | `useFanqie.js:14` |
| `ToutiaoApp.jsx` | `ToutiaoSide.jsx` | `ToutiaoApp.jsx:11` re-export |
| `useDesktopController.ts` | `useDesktopEvents.ts` | `useDesktopController.ts:4`，`:146` 调用 |
| `base.css` | `layout.css`、`cards.css`、`actions.css`、`dashboard.css` | `styles.css` 新增 4 行 `@import` |
| `shell.css` | `paper.css`、`dialogs.css` | `desktop.css` 新增 2 行 `@import` |

后果：

- `tsc` 报 `TS2307: Cannot find module`，桌面端无法构建
- 87 个仍在使用的类失去样式定义（`base.css` 58 个、`shell.css` 29 个）
- 守卫显示 0 条提示，其中 7 条是靠引用不存在的文件"消除"的

处理后置条件：文件找回则本轮拆分可继续；未找回则需重写约 1,500 行 UI 与样式，成本接近重做。

### 3.4 D 类：建议放弃

| 改动 | 理由 |
| --- | --- |
| 类型收紧的当前实现（`readJsonCached` 默认类型、`listCandidates` 返回类型） | 引入 203 个编译错误，根因未同步下游。可另立任务，按"改类型 → 全量 typecheck → 修下游"顺序重做 |
| 4 个样式表的压线达标 | `agent.css` 317→296、`components.css` 324→292、`profiles.css` 301→276、`reader.css` 302→295，均停在阈值下方数行。未按组件真拆分，属形式满足 |

## 四、RC1 范围

### 4.1 纳入

1. A 类 14 项，逐项落到基线代码
2. B 类 6 项，按上表修正后纳入
3. 版本号升至 `0.9.9-rc.1`（根 `package.json`、`apps/desktop/package.json`、`core/src/version.ts` 三处同步）
4. `CHANGELOG.md` 增补 RC1 条目，`docs/STATUS.md` 更新验证范围与遗留项

### 4.2 不纳入

1. C 类 7 组拆分，等待文件确认或另立任务
2. D 类类型收紧
3. 时区缺陷（UTC 日期 vs 本地日期），单独排期
4. 任何写作业务规则、方法资产、作者可见行为的调整

### 4.3 执行顺序

| 阶段 | 内容 | 完成判据 |
| --- | --- | --- |
| P1 | 在 0.9.9 基线上逐项应用 A 类 | 每项独立可编译，`tsc` 保持 0 错误 |
| P2 | 应用 B 类并修正 | 同上，且 `guard` 的 `any` 计数不高于 99 |
| P3 | 版本号与文档同步 | 三处版本一致，`npm run guard` 的版本一致性检查通过 |
| P4 | 全量验证 | 见第五节 |

## 五、验收标准

| 命令 | 期望 |
| --- | --- |
| `npm run typecheck` | 0 错误 |
| `npx tsc -p apps/desktop/tsconfig.json --noEmit` | 0 错误 |
| `npm run lint` | 无输出 |
| `npm run guard` | 通过；提示数不高于基线 11 条；`any` ≤ 99；吞错 0 |
| `npm run verify` | Python 与 Node 全部通过（Windows 本地排除 2.4 节三项平台相关失败，需在 CI 复跑确认） |
| `npm run desktop:build` | 构建成功 |
| `npm run test:desktop` | PI 运行时用例通过 |
| `npm run test:desktop:ui` | 9 步旅程通过（需显示服务） |

补充约束：

- 每阶段结束记录 `git diff --stat`，净增行数控制在 +400 以内
- 不新增依赖，不改 `package-lock.json`
- 提交信息带任务编号

## 六、遗留问题

| 编号 | 问题 | 严重度 | 建议 |
| --- | --- | --- | --- |
| R1 | 11 个拆分文件缺失，来源未确认 | P0 | 先确认是否存在于其他工作区；确认无果则重写 |
| R2 | 类型检查不在 `npm run guard` 与 `npm run verify` 的必过链路中 | P1 | 把 `typecheck` 前置到 `verify`，让编译失败阻断校验 |
| R3 | 作品目录按 UTC 日期命名，与本地日期不符 | P1 | 单独任务修复，补跨时区回归 |
| R4 | Windows 下 `T3-12` 断言平台不兼容 | P2 | 断言接受 `ENOENT | ENOTDIR` |
| R5 | Windows 下 Python 并发写锁报 PermissionError | P2 | 台账并发用例加锁重试或串行降级 |
| R6 | 4 个样式表停留在阈值下方数行 | P2 | 按组件真拆分，或调整守卫阈值口径 |
| R7 | `readJsonlCached` 浅拷贝不防嵌套修改 | P2 | 明确"只读"契约并在调用处注释 |

R2 值得单独说明：本轮 203 个错误能一路推进到交付，根因是 `guard` 只统计 `any`、吞错与依赖环，`lint` 未启用 type-aware 规则，而 `verify` 的第一道命令虽含 `tsc`，但被拆在 `test:node` 内部，单独跑 `guard` 或 `lint` 时无法暴露。建议把类型检查提到 `verify` 首位，并增加一个只跑 `tsc` 的快速前置命令。

## 七、重建执行记录

### 7.1 方法

云端 0.9.9 与本地 0.9.9.1 逐块比对后确认：`base.css` 与 `shell.css` 相对云端是**纯子集**（0 新增、0 修改块），被移除的规则块即缺失文件的全部内容。因此按选择器族还原归属，不猜测、不重写。

| 源文件 | 云端块数 | 本地保留 | 待分装 |
| --- | --- | --- | --- |
| `base.css` | 191 | 44 | 147 |
| `shell.css` | 136 | 52 | 84 |

### 7.2 样式重建（6 个文件）

| 文件 | 块数 | 行数 | 归属依据 |
| --- | --- | --- | --- |
| `workbench/styles/layout.css` | 76 | 524 | 骨架、标题、栏位、区块、图标与分段控件 |
| `workbench/styles/cards.css` | 33 | 239 | 卡片、空态、骨架屏、事实表、门禁 |
| `workbench/styles/actions.css` | 30 | 216 | 动作卡、按钮、输入框 |
| `workbench/styles/dashboard.css` | 8 | 57 | 管线、统计、更新时间 |
| `desktop/styles/paper.css` | 38 | — | 稿纸与长篇正文区 |
| `desktop/styles/dialogs.css` | 26 | — | 弹窗、抽屉、命令面板、向导 |

`shell.css` 回填 20 块骨架规则（侧栏、标签、错误页、导航卷）。

校验结果：147 + 84 = 231 块全部有归属，无遗漏；5 个样式文件花括号全部平衡；此前消失的 85 个与 29 个选择器全部回归。

前缀唯一性按守卫要求调整：`wb-icon`、`wb-icon-button`、`wb-segment*`、`wb-mode-switch`、`wb-view-switch` 同属 layout，避免复合选择器造成跨文件。

### 7.3 代码重建（5 个模块）

| 文件 | 来源 | 说明 |
| --- | --- | --- |
| `app/useDesktopEvents.ts` | 云端 `useDesktopController` 的三段 `useEffect` | 启动序列、外观同步、事件订阅；事件内实时解引用 `handlers.current` |
| `agent/AgentMessages.tsx` | 云端 `AgentPanel` 的 `messageBody` / `ChatStream` / `resultCard` / `renderMessage` | 新增 `AgentMessageList`，候选编号按「作品 + 章节」独立计数并用 `useMemo` 缓存 |
| `fanqie/actions.js` | 云端 `useFanqie` 的 `actions` 对象与 `messageOf` | 导出 `createFanqieActions`，含采纳、章节流转、投递、保存、合并 |
| `toutiao/ToutiaoSide.jsx` | 云端 `ToutiaoApp` 的 `QaText` 与 `ToutiaoSide` | 补全 `ActionButton`、`viewText` 导入 |
| `shared/ProfileParts.jsx` | 云端 `Profiles` 的 `NewProfileForm`、`FromTag`、中列与右列 JSX | 中列右列抽为 `ProfileMethodsColumn` / `ProfileMethodEditor`，回调按本地调用签名映射 |

### 7.4 类型修复（203 → 0）

| 根因 | 影响错误数 | 处理 |
| --- | --- | --- |
| `readJsonCached` 默认类型收窄导致 `getCard` 返回塌缩为 `{ axis }` | 35 | `getCard` 显式返回 `Promise<TechniqueCard>` |
| `listCandidates` 返回值被推断为联合类型 | 47 | 定义并导出 `CandidateListRow`；正常行用 `CandidateMeta`，降级条目单处断言 |
| `readJsonl` 未透传泛型 | 6 | `readJsonl` / `readJsonlCached` 增加 `<T>`，分析包按 `ChapterFact` / `Plot` 声明 |
| `Markdown` 经 `React.memo` 后 props 推断为 `object` | 1 | 拆出 `MarkdownView` 并补 JSDoc 类型 |
| 其余零散（scope 形状、可空访问） | 3 | 局部收窄 |
| 缺失模块 `TS2307` | 2 | 随文件重建消失 |

### 7.5 最终验证

| 检查项 | 结果 |
| --- | --- |
| `tsc -p tsconfig.json --noEmit` | **0 错误** |
| `tsc -p apps/desktop/tsconfig.json --noEmit` | **0 错误** |
| `npx eslint .` | 通过，无输出 |
| `npm run guard` | 通过；提示 3 条（基线 11 条）；`any`=99；吞错 0 |
| `npm run verify` | 131 项，129 通过；失败 2 项均为基线既有的平台与时间问题 |
| `npm run desktop:build` | **构建成功**（CSS 525.70 kB，JS 975.35 kB） |

守卫剩余的 3 条提示：`ProfileParts.jsx` 超 400 行、`shell.css` 与 `layout.css` 超 300 行。前两条源于既有大文件，第三条是分装后规则集中的自然结果，均属提示而非失败。
