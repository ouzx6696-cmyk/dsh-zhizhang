# 全量梳理审查报告

## 0.9.9 整理复核

本轮基线为 f0aac14（RC3）。下方原报告保留为历史证据，未修列表不等同于当前状态。已处理 P1-1 的 CLI/test 吞错检测盲区、P1-6 资产脚本吞错、P1-7 Python 准备读错后删目录风险、P1-8 作品占用返回契约和 P2-3 四个内部导出。守卫场景覆盖 scripts/test 新范围；新增回归以巡检语义、运行包保护与重复执行两个场景组织。

性能：巡检在分行前排除全文不含人物/事实的章节，保留同段匹配与时间窗。合成数据为 500 章、每章 1000 行中性正文、50 条知识、末章 2 个匹配，预热 3 次后测 7 次，中位数由 832.18 ms 降至 5.10 ms；这是同机微基准，不推广为真实写作耗时。读缓存命中时刷新 Map 顺序，避免热文件按首次插入顺序被淘汰；导出审计将文件成员判断从数组 includes 改为 Set。

测试体系复用既有框架与断言，统一 core/desktop/all 调度及阶段耗时，失败即停；all 不重复顶层类型检查，Windows 发行准备一次生成 NSIS 与 ZIP。CI 不再重复 lint，显式安装 Electron 二进制。未新增依赖，方法资产和质检门槛不变。

保留事项：CSS 跨文件层叠和窄栏容器布局没有在此次性能整理中重写；三个会话模块仍有超行提示。导出审计仍只强制 fanqie，守卫不声称能够自动证明所有十条人工规范。真实模型、Windows 安装和跨版本更新仍需专门验收，云端原生构建结果另行记录。

---

审查基线：`0800a17`（2026-11-07 15:14:41 +0800，标题「清理: 全量梳理 — 死代码/死配置/死通道/失效文档/守卫修复」）及其后的工作区改动；源码版本 `0.9.9-rc.3`，分支 `master`。

审查方式：分三区逐文件阅读（`packages/core` + `scripts` + `test`、`packages/fanqie` + `packages/toutiao`、`apps/desktop` + `packages/workbench` + `packages/ui` + `docs`），文档与代码交叉核对，关键结论回读源码复核。**不以命中数、脚本 pass/fail 或文档自述作为评审结论。**

验证基线：`npm run verify` 改动前后各跑一次，均为 **217 项 / 216 通过 / 1 既有跳过 / 0 失败**；架构守卫 `any=1`（基线 1）、非空断言 0、吞错 0、319 个源文件、3 条超行提示；`git diff --check` 干净。

级别口径：**P0** 会导致错误行为或数据风险；**P1** 明确违反仓库规则、死代码、或导致守卫假绿；**P2** 可改进但不紧迫。本次未发现 P0。

---

## 一、本轮已修复

10 个文件，`+11 / −15`（净减 4 行），全部为零行为变化。

| # | 级别 | 位置 | 问题 | 处置 |
|---|---|---|---|---|
| 1 | P1 | `test/helpers.mjs:29,40` | `disabled: config.disabledGates` 恒为 `undefined`：0800a17 已从两个 `config.ts` 删除该配置项，全仓仅剩这两行读取方、无任何写入方 | 删两行 |
| 2 | P1 | `packages/core/src/execute.ts:25` | `\|\| ""` 永远取不到：`:15-16` 已保证 `execution.cwd` 为非空字符串 | 删兜底 |
| 3 | P2 | `packages/core/src/profiles.ts:8` | 头注释声称「配置 `profilesDir` → `WRITER_PROFILES_DIR` → 应用状态目录/writer/profiles」三级优先级，源码中不存在 `profilesDir` 解析，优先级也不成立 | 删失效注释行 |
| 4 | P2 | `packages/core/src/method-pack.ts:216` | 注释「本单不接线，由会话层接线任务调用」已失效：`apps/desktop/src/session/prompt.ts:401` 早已调用 `buildMethodPack` | 删失效注释行 |
| 5 | P1 | `docs/guides/PROFILES.md:57` | 教作者在 `writer.json` 写 `profilesDir`，全仓源码无任何解析，作者配置静默无效 | 改为只写 `profile` 固定方案；`profile` 在 `toutiao/config.ts:28,32` 与 `fanqie/config.ts:38,76` 是活配置，保留 |
| 6 | P1 | `docs/guides/PROFILES.md:60` | 目录优先级与代码不符 | 按实际改写：桌面固定在 userData `profiles/`；未由桌面设定时 `WRITER_PROFILES_DIR` 生效，否则用 stateRoot 的 `writer/profiles` |
| 7 | P2 | `docs/guides/PROFILES.md:7` | 「插件自带」「新装插件」「随插件版本更新」——DSH 插件形态已退役 | 改为客户端措辞 |
| 8 | P1 | `docs/ACCEPTANCE.md:63` | `profiles-directory` 自定义目录引用，该兼容读已随 0800a17 从 contract/preload/workspace/lifecycle 全部删除 | 删失效引用 |
| 9 | P1 | `docs/guides/FANQIE.md:57` | 「宿主没有 `sessionController`（headless）时按钮置灰」是 DSH 插件形态 API 残留，全仓源码已无 `sessionController` | 删失效机制描述，保留「没有会话时按钮置灰」 |
| 10 | P2 | `docs/guides/FANQIE.md:56` | 「宿主按它去重」；实际去重在 `apps/desktop/src/main/operations.ts:199-207` 的 `state.deliveries` | 按代码改写 |
| 11 | P2 | `docs/guides/ASSETS.md:60` | 「再补 INSTALL.md 的表」，全仓 `git ls-files` 无 `INSTALL.md` | 改为「再补本节的配置说明」 |
| 12 | P2 | `docs/guides/ASSETS.md:57`、`docs/guides/DESKTOP.md:51`、`docs/engine/TOOLS.md:3` | 「随插件包发布」「业务与宿主边界」「宿主展示的 schema」措辞残留 | 改为安装包 / 桌面外壳 / 工具定义 |
| 13 | — | `CHANGELOG.md:156,210` | `profilesDir`、`sessionController` 仍出现在历史条目中 | **刻意保留**：历史记录不改原貌 |

---

## 二、未修复的确认问题

### P1

| # | 位置 | 问题 | 未修原因 |
|---|---|---|---|
| P1-1 | `scripts/architecture-guard.mjs:353-360` | **守卫假绿根因**：`rules` 只遍历 5 个包的 `src`，`scripts/` 与 `test/` 的 `.mjs` 完全不受 R2（吞错）/R8（any）检查；只有 `retired-package` 全仓 walk。下方 P1-6/P1-7 的 7 处吞错因此全部漏检 | 修它必须连带修那批吞错，属「扩规则执行」，不是清残留 |
| P1-2 | `scripts/architecture-guard.mjs:203-311` | 仓库十条规则只实现依赖分层、R2 部分、R6、R8 计数；R1（边界外校验）、R3（恒真分支）、R4（重复实现）、R5（零引用导出）、R9（注释）、R10（测试路径）均无检测；R5 仅由 `scripts/audit-fanqie-exports.mjs` 覆盖 fanqie 一个包 | 同上，属增强守卫能力 |
| P1-3 | `scripts/architecture-guard.mjs:342` | `component-prefix` 用 `part.match(/\.([a-zA-Z_][\w-]*)/)` **只取选择器第一个类**：`.ui-dialog.wb-modal` 记为 `ui-dialog`，`packages/ui/src/styles/dialog.css:57` 对 `.wb-modal` 的覆写漏报 | 需先确认按全类名统计的口径与影响面 |
| P1-4 | `packages/workbench/src/client/styles/overlay.css:13`、`packages/ui/src/styles/dialog.css:57` | `.wb-modal*` 一族跨两个样式文件定义/覆写，违反 AGENTS.md「一个 CSS 组件前缀只能出现在一个样式文件里」；按全类名口径复核约 27 组跨文件 | 调整归属会改变层叠顺序，属作者可见样式变更，需单独立项 |
| P1-5 | `docs/ARCHITECTURE.md:24` | 「一个组件前缀只在一处维护」与 P1-4 的实际代码冲突 | 随 P1-4 一并处理 |
| P1-6 | `scripts/assets.mjs:239,245,323,344,354`；`:307-309` | 五处 `.catch(() => "") / [] / undefined` 无 `// allow-catch:`；`:307-309` 的 `catch { /* 换下一个 */ }` 吞掉全部 Python 失败。违反 R2，守卫扫不到 | 需逐条定降级语义，未擅自改 |
| P1-7 | `scripts/prepare-desktop-python.mjs:20-22,28-30`；`:41` | 两处 `.catch(() => "")` 无注明；`writer-runtime.json` 读取失败被吞成「未准备」，`:41` 会**递归删除已解压的 Python 目录并重下**，有实际误删风险 | 同上；这条建议优先于其他吞错项 |
| P1-8 | `packages/core/src/workspace-lock.ts:350` | `access.owner?.host \|\| "其他应用"`：`workspaceAccess:75` 在 `readOnly` 时必返回非 null owner，`?.` 与兜底均不可能，违反 R1/R3 | 需连同 `workspaceAccess` 契约一起复核后改 |

### P2

| # | 位置 | 问题 |
|---|---|---|
| P2-1 | `packages/workbench/src/client/styles/{cards.css:175, controls.css:249, layout.css:196, overlay.css:158, reader.css:240,249}` | 6 处 `@container wb-panel (...)`，源码中已无任何 `container` / `wb-root` 声明，规则永不生效。CHANGELOG RC1 明确记为「窄栏响应式需把容器声明挂到 `.studio-paper-column` 才能恢复，属作者可见布局变更，单独立项」，故本轮不动 |
| P2-2 | `scripts/audit-fanqie-exports.mjs:71` | `roots` 扫 6 个目录，结果只 `startsWith(root + "/packages/fanqie/src/")`：其余包的零引用导出无人看守。脚本本就名为 fanqie 专用，扩到全包属新增能力；目前其他包恰好干净，不是守卫保证的 |
| P2-3 | `packages/core/src/profiles.ts:27,28,84,107` | `BUILTIN_NAMES`、`BUILTIN_NOTES`、`profilesRoot`、`checkMethodId` 仅本文件内使用却带 `export`，违反 R5。（`PROFILE_LIMITS` 有 `profile-tool.ts:10,33` 包外引用，**不在此列**） |
| P2-4 | `packages/core/src/runner.ts:192`、`packages/core/src/profile-tool.ts:22` | `parseContract`、`readMethodFolder` 生产仅同文件调用，唯一包外引用是 `test/unit.test.mjs` 与 `test/safety.test.mjs`，属为测试保留的导出（R5/R10） |
| P2-5 | `scripts/architecture-guard.mjs:265-271,374-383` | `host-package` 与 `retired-package` 检测同一字符串，前者是后者真子集，重复实现（R4） |
| P2-6 | `scripts/architecture-guard.mjs:193-201,285-309` | `swallowed()` 只认空块、单条 return 字面量、`.catch(() => 字面量)`；`scripts/acceptance-lib.mjs:228-231` 的 `catch { malformedLines++; continue; }` 这类多语句吞错漏检 |
| P2-7 | `scripts/architecture-guard.mjs:277-280` | any 基线只数 `AnyKeyword` 与 `NonNullExpression`，不覆盖 R8 明禁的 `as unknown as` |
| P2-8 | `packages/ui/src/styles/dialog.css:56` | 注释「宿主 ui-dialog 内嵌 workbench 的 .wb-modal 时的口径」——「宿主」术语残留且复述代码（R9） |

---

## 三、需人工判断的疑点

| 位置 | 疑点 |
|---|---|
| `scripts/prepare-desktop-python.mjs:29,36`、`assets.mjs:40`、`backup.mjs:26`、`acceptance.mjs:124` | 各写一份 sha256，与 `packages/core/src/fsx.ts:124` 构成多处实现；但这些是不能 import TS 源的独立 CLI 脚本，是否豁免需定 |
| `scripts/backup.mjs:30-33` | `inside()` 自写路径越界判断，与 `fsx.ts:11 resolveInside` 同类，同上 |
| `packages/core/src/profiles.ts:299`、`tool.ts:100` | `(meta.id as BuiltinProfile)`、`(args ?? {}) as A`：类型断言与冗余兜底是否触及 R8/R1，取决于框架既有设计 |
| `scripts/acceptance-lib.mjs:228-231` | 坏日志行不分原因吞掉 JSON 解析错误，虽有文字说明但无 `// allow-catch:` 标记 |
| `test/unit.test.mjs:10-19` | 直接 import 纯函数做单测，未按 R10「工具经 executeTool」；被测对象是纯函数，适用范围需界定 |
| `scripts/architecture-guard.mjs:22-27,114,251,442-454` | `BROWSER_SAFE`、`pi-adapter.ts`、`state/desktop.ts` 硬编码白名单；`versions` 用正则硬编码 CHANGELOG 首个 `## ` 标题格式，存在误报隐患 |
| `packages/fanqie/src/engine/storage/chapters.ts:133-135` | 严格校验后仍用 `Array.isArray(...) ? ... : []` 兜底并 `as ChapterDependency[]`；处于「读文件解析」边界，是否触 R1/R8 需定夺 |
| `packages/toutiao/src/tools.ts:767` | 工具入口用 `String(args.markdown ?? "")` 兜底而非 `reqStr` 报错，与 R1「失败就报错」有张力 |
| `survey.ts:232`、`process-lock.ts:43`、`plan.ts:126`、`library/schema.ts:735` | `new Date().toISOString()` 与 `core/src/fsx.ts:150 nowIso()` 并存，且 core 自身也这么写，属跨包共性、非本轮引入 |
| `apps/desktop/src/session/task-tracker.ts:126` | `parsed.context?.focus \|\| {}` 及 client 多处 `\|\| {}`：取决于 IPC 回执是否已算信任边界 |
| `docs/STATUS.md:5,7,9,11` | PI 运行时数字 27/30/31/32/61 混排；当前 `test/desktop/runtime.test.mjs` 实为 61 项，其余是各轮历史记录，口径需统一 |
| `docs/guides/ASSETS.md:14` | 「随插件包发布」措辞未改（本轮只改了 `:57`）；与 `DESKTOP.md:51`、`PROFILES.md:7` 同类，是否算 DSH 残留需定 |
| `apps/desktop/out/` | 构建产物仍含 `profiles-directory` / `writer_enable` 旧符号，已被 `.gitignore` 排除、`git ls-files` 为 0，属过期产物，明确排除不计源码残留 |

---

## 四、复核为干净的部分

- **两个业务包**：`fanqie` / `toutiao` 代码本身残留 0。`config.ts` 每个键都有生产读取方（`handoff.v2`、`toolset.narrowed`、`continuity.enabled`、`draw.enabled`、`learn.enabled`、`brief.creationFirst`、`session.perChapter`、`proactiveCompact`、`qa.judge`、`multiDraft` 等逐项核对）；`ROUTES` 19 键全有引用；`WRITER_EXCLUDED_TOOLS` 16 项全有 `name:` 注册定义。
- **业务规则未动**：标题 `TITLE_MAX=34`（`skill/scripts/rules.py:12`）、质检 `overall>=84`（`qa_check.py:486`）、两轮打回 `MAX_RETURN_ROUNDS=2`（`store.ts:35`）、固定末句 `STOP_LINE`（`store.ts:36`）、状态词 `STATUSES` 五值（`store.ts:30`）。
- **桌面通道**：32 条 IPC 从 `contract.ts:49-117` ≡ `IPC_PARSERS:139-200` ≡ 各 `register*.ts` ≡ `preload.ts:11-63` ≡ 渲染层调用一一对应；`routes.ts` 19 项与 adapter 对应；325 个导出无零引用命中（动态拼接的 `ttRole_*`、`ui-button-${variant}` 已排除误判）。
- **测试与规则**：`test/helpers.mjs` 与 `test/engine/helpers.mjs` 经 `executeTool` 和路由处理函数走生产路径，未用正则扫源码当断言；11 处 `allow-catch` 均注明原因；无空 catch、`as any` / `as unknown as`、新增非空断言、机械切分的 `xxx-1/xxx-2`；抽查的 `catch` 均转成 `NovelError` / `Error` 抛出或按 `isMissingFileError` 精确降级。
- **文档**：markdown 本地链接有效，19 个 `npm run xxx` 均在 scripts 中；`unsafe_path`、`getContextUsage`、`writer_search` / `read_url`、`requireEditorPass` 等名称与代码一致。

---

## 五、审查过程中修正的误判

写下这些是为了避免下一轮重复劳动或改错。

| 初判 | 复核结论 |
|---|---|
| `profile` 配置项也是死配置 | **活配置**：`packages/toutiao/src/config.ts:28,32`、`packages/fanqie/src/config.ts:38,76` 有定义与解析，文档已保留 |
| `PROFILE_LIMITS` 只在本文件用，应去 export | **有包外引用**：`packages/core/src/profile-tool.ts:10,33`，不能去 |
| `WRITER_PROFILES_DIR` 环境变量完全有效 | **桌面运行时永不生效**：`apps/desktop/src/main/lifecycle.ts:39` 无条件 `setProfilesRoot(state.home/profiles)`，`profiles.ts:85` 的 `configuredRoot` 短路；测试环境未设 root，env 才生效。文档已按实际写 |
| `docs/guides/FANQIE.md:56` 的去重由「宿主」完成 | 实际在 `apps/desktop/src/main/operations.ts:199-207`，key 为 `[operation, requestId, root, base, work]` |
| `scripts/audit-fanqie-exports.mjs:71` 是守卫 bug | 脚本命名即 fanqie 专用，属设计意图；列为 P2 增强项而非缺陷 |
| `CHANGELOG.md:156,210` 是 DSH 残留 | 历史条目，保留原貌 |

---

## 六、本轮改动清单

```
 docs/ACCEPTANCE.md               | 2 +-
 docs/engine/TOOLS.md             | 2 +-
 docs/guides/ASSETS.md            | 4 ++--
 docs/guides/DESKTOP.md           | 2 +-
 docs/guides/FANQIE.md            | 4 ++--
 docs/guides/PROFILES.md          | 6 +++---
 packages/core/src/execute.ts     | 2 +-
 packages/core/src/method-pack.ts | 1 -
 packages/core/src/profiles.ts    | 1 -
 test/helpers.mjs                 | 2 --
 10 files changed, 11 insertions(+), 15 deletions(-)
```

跑过的命令及结果：`npm run verify`（改动前后各一次，均 217/216/1/0，exit 0）、`node scripts/architecture-guard.mjs`（通过，319 个源文件）、`git diff --check`（干净）。

遗留：第二节全部未修项、第三节全部疑点；发布侧 W7 手工清单（Windows 安装与跨版本更新）仍未执行，真实模型 A/B 验收按作者决定跳过，不据未执行的评测下结论。
