# Changelog

## 0.8.0 — 2026-10-30
方法论重写与方法方案。
- **默认方案（精炼版方法论）**：把两套上游方法论提炼重写成插件的默认方法论。今日头条 30 份（方法 13 + 语料 16 + 立项卡模板沿用原版），判据按质检脚本、立项卡预检和门禁的实际逻辑重写，修正与代码冲突的旧说法，语料去掉成品金句和无出处数字；番茄长篇 111 份原件合并为 17 份（总纲、开书、卷幕结构、章纲、拆书、写章、场景、句面、节奏、连续性、平台、审读、修订、模板、示范），原件里的目录与脚本指令全部换成真实工具，审读格式与 `fanqie_review_report` 一致。逐份来源与删改见 `docs/profiles/`。
- **方法方案**：默认 / 原版 / 用户方案一、二……，两种模式各一套。用户方案以默认或原版为底，逐份覆盖或新增；`toutiao_method_get`、`fanqie_forge_get` 按当前方案读，`原版:id` 强制读原件，长篇原版 forge id 自动对到默认方案同类方法。新工具 `toutiao_profile`、`fanqie_profile`（编辑子代理不挂）；新配置 `profilesDir`、`toutiao.profile`、`fanqie.profile`（固定方案）。
- **写作台「方法方案」**：页头按钮显示当前方案；弹窗三栏（方案 / 方法清单 / 全文），新建方案可导入 .md 文件或文件夹，用户方案可逐份编辑保存、对照底稿、恢复底稿、新增、改名、删除（须确认），一键设为当前。
- **资产清单**新增两个来源（两套默认方案）；插件包新增 `profiles/`。
- 测试：新增 `test/profiles.test.mjs`（默认方案完整性与工具名真实性、工具全流程、写作台接口）；方法加载测试同时覆盖默认与原版。Node 93、Python 215、真实 ToolRuntime、两条 headless e2e。

## 0.7.1 — 2026-10-30
资产梳理与更新预设。
- **资产清单**：`assets/sources.json` 登记四个来源（toutiao-viral-writer 4.0.0、inspiration-forge-suite 1.3.0、长篇桥接脚本、引擎内置方法资产）；`assets/manifest.json` 逐份记录类别、出处、可加载 id、大小与 SHA-256，随插件包发布。盘点结果：182 份，其中上游原件 167 份与原件逐字节一致，本项目文件 15 份。
- **更新预设**：`npm run assets -- import <来源> <目录|zip> [--apply]` 比对上游新版并出报告；应用时保留本项目文件、不覆盖登记为 patched 的文件、自动改版本号、重建清单、指出没登记的新方法，报告存 `assets/updates/`。解 zip 时还原没标 UTF-8 的中文文件名。
- **一致性检查**：`npm run assets -- check`（npm test 也跑）拦截清单过期、上游原件被手改、头条方法未登记、登记表指向空文件、版本号不一致。
- **作者自备资产**：新配置 `toutiao.assets.dirs`、`fanqie.assets.dirs`；目录里的 .md/.txt/.json 以 `user:相对路径` 经 `toutiao_method_get` / `fanqie_forge_get` 读取，`id=list` 一并列出；只读、不覆盖自带方法，有大小、数量、深度与越界限制。`assets` 段为以后的资产设置预留（见 docs/ASSETS.md「扩展预留」）。
- **插件包瘦身**：不再带 Python 缓存与规则测试（测试在源码树跑），新增包内 `assets/`。
- 测试：新增 `test/assets.test.mjs`（清单一致、模拟上游 4.1.0 导入、作者自备资产两种模式）。

## 0.7.0 — 2026-10-30
最终校验与写作台体验。
- **创作方法论校验**：头条方法与语料（30 份）、forge 三件套（111 份）与原件逐字节一致；三套方法论（头条、forge、引擎方法资产 12 项）全部能经工具加载。新增 `test/methods.test.mjs`：原件对照、逐份加载（源码与打好的插件包各一遍）、规则与说明里提到的工具名和方法 id 必须真实存在、forge 原文之间的链接都能取到。
- **修复**：编辑过稿方法原先指向一份不在安装包里的文档，模型读不到；现为方法资产 `fanqie_method_get ids=edit`（L1–L3 修改层级与交付规则）。`fanqie_forge_get` 认得原文里只写相对路径的引用（如 `references/writing.md`）。头条方法新增 `overview`（SKILL.md 总纲）。
- **修复**：今日头条文章栏的标题被挤成一个字宽（行布局缺状态点列），现在每篇有状态点、标题、体裁与版本，右侧质检分。
- **写作台反馈**：右下角提示栈（成功自动淡出带倒计时、悬停暂停，出错常驻，可展开详情）；动作卡片式写作 Agent 按钮（发送中转圈）；「采用」转圈与完成对勾；「刷新」转圈；投递失败写明原因。
- **写作台视觉**：模式标识、页头分隔、三栏卡片层次与固定栏头、选中行强调条、今日头条五步进度条、空状态图标、全书概况阶段卡片与下一步列表、内容切换淡入、对话框过渡；「采用」改为应用内对话框确认。只用宿主 `--dsw-*` 变量，宿主缺变量时退回系统色；支持"减少动效"。亮色、暗色与 720/1024/1440 宽度均已用 DSH 自带主题变量截图核对。
- 测试：Node 87、Python 215、真实 ToolRuntime、两条 headless e2e。

## 0.6.0 — 2026-10-29
整体梳理：让仓库读起来像一个项目，而不是几轮迭代叠起来的。
- **包结构**：`host`（DSH 适配）→ `core`（文件、脚本、门禁、模式、会话）/ `workbench`（写作台服务端与浏览器端）→ `toutiao` / `fanqie` → `app`。长篇引擎并进 `fanqie/src/engine`，与写作层同包直接调用；去掉中间的钩子层。
- **一套写作台服务端**：访问校验、限流、JSON 读写、路由组合统一在 `workbench/server.ts`，两种模式各自提供接口表；会话追踪与投递统一在 `core/sessions.ts`，两种模式共用同一套"没有会话 / 没有会话控制服务"的提示。
- **配置**：两种模式各有配置解析（`toutiao/config.ts`、`fanqie/config.ts`），未知字段一律报错；长篇引擎不再自带配置 Schema。
- **写作台浏览器端**：按 外壳 / 番茄长篇 / 今日头条 / 共用 分目录；今日头条模式新增状态统计、按状态分组与筛选、质检记录、版本列表；文案统一为"写作台"。
- **清理**：去掉面板 HTML 渲染（`fanqie_panel_snapshot` 只返回 JSON）、各处版本号与任务编号注释、旧目录与旧脚本；一份 TypeScript 配置、一个架构守卫（新增浏览器端边界检查）。
- **文档**：重写 README、ARCHITECTURE、WORKBENCH、DSH、STATUS；引擎细节在 docs/engine/，最初的设计文档在 docs/design/。
- 测试：Node 84、Python 215、真实 ToolRuntime、两条 headless e2e。

## 0.5.0 — 2026-10-29
- **一个入口、两种模式**：插件只注册 `writer_enable`，参数 `mode=toutiao|fanqie`、`role=writer|editor`。删除 `toutiao_enable`、`fanqie_enable`、`zhizhang_enable`。一个会话一种模式，切换返回 CONFLICT。
- **不再有“织章”**：长篇引擎改为 `packages/novel`，工具统一 `fanqie_*`（原 `zhizhang_*`；forge 方法工具改名 `fanqie_forge_get`），数据目录 `.writer/`，接口 `/api/writer`，环境变量 `WRITER_NOVEL_*`。**不兼容旧长篇数据、配置与工具名。**
- **写作工作台**：侧栏「写作台」，顶部切换番茄长篇 / 今日头条。今日头条模式改为 React 三栏（文章 / 当前稿与交稿单 / 概况、质检、采用、写作 Agent），删除旧 HTML 面板 `/writer/toutiao`；按钮"新写一篇 / 继续推进 / 派编辑红笔 / 按质检修改"投递到最近写过头条的主会话。
- **配置重排**：顶层 `python`，`toutiao:`、`fanqie:`（含长篇数据位置）、`workbench:`（局域网与令牌）；旧键加载时报错并提示新位置。
- 测试：长篇引擎 55、Node 29、Python 205 + 10；真实 ToolRuntime 与两条 headless e2e 全部改为 `writer_enable`。

## 0.4.0 — 2026-10-29
- **织章并入**：织章（dsh-zhizhang 0.20.0）完整源码并入 `packages/zhizhang/`，随 dsh-writer 发布，**不再单独安装**（装 0.4.0 前先 `dsh plugin remove dsh-zhizhang`）。数据格式、`.zhizhang/` 目录、写作台接口与 0.20.x 完全兼容；织章原 47 项测试保留。
- 一个包：根上三个触发工具 `toutiao_enable` / `fanqie_enable` / `zhizhang_enable`；织章配置并入 `writer` 配置的 `zhizhang:` 段（原 `fanqie.zhizhang` 移除）。
- 番茄长篇直接调用织章内部接口（作品选择、读章），不再按磁盘布局解析；`zhizhang_enable` 成功后经织章启用钩子自动挂长篇，不再靠回执文字识别。
- 编辑审读回报改存作品目录 `writer-reviews/<章>/`，跟着书走（原 `fanqie.outputsDir` 移除）。
- **linter 合并**：`zhizhang_style_lint` 在织章语感雷达之后附 forge 正文体检（超长段、套话），与雷达重复的命中去掉；删除 `fanqie_manuscript_lint`。
- **织章写作台接入写作 Agent（T3.8）**：右栏新增"写作 Agent"区块，显示编辑审读回报（结论、是否过期、硬伤数）；按钮"续写下一章 / 派编辑审读本章 / 按回报修改"把一条消息排进最近在本项目用过织章的主会话（DSH `sessionController.prompt`，mode=queue，requestId 去重；子代理会话不算）。
- `requireEditorPass` 同时约束对话定稿与写作台定稿（织章内部 finalizeGuard）。
- 测试：织章 54（原 47 + 新 7）、Node 30、Python 205 + 10；真实 ToolRuntime 改用内置织章；长篇 headless e2e 不再另装织章，并验证真实子代理不覆盖投递目标。

## 0.3.0 — 2026-10-28
- **番茄长篇整合（M3）**：新增 `fanqie_enable` 与 9 个 `fanqie_*` 工具，建立在织章 dsh-zhizhang 0.20.x 之上、只读织章数据；forge 三件套原文与五个检查脚本原样内置，`fanqie_bridge.py` 统一契约。
- 长篇门禁：定稿与 force 覆盖须作者确认；可选 `fanqie.requireEditorPass`；编辑子代理只读。
- 观察 `zhizhang_enable` 成功后自动挂载长篇工具与门禁（`fanqie.autoMount`）。
- **包名改为 `dsh-writer`，插件 id 改为 `writer`**（0.2.x 用户先 `dsh plugin remove dsh-writer-toutiao`）；新增入口层 `packages/app`。
- 门禁引擎支持 `前缀*` 规则；体裁登记改为进程级单例。
- 测试：Python 205 + 10，Node 29；真实 headless 新增长篇 e2e（真实织章 0.20.0）。

## 0.2.0 — 2026-10-28
- 写手与编辑分离：`toutiao_enable role=editor` 挂载编辑专用 9 个工具与编辑总则；写手不能把自己的稿记成编辑版；新增可选门禁 `toutiao.editor_pass`（配置 `requireEditorPass`）。
- 体裁隔离：头条与番茄长篇（织章 `zhizhang_*`）在同一会话互斥，经 `tools/result` 观察织章启用。
- 写作台“采用”同步台账状态。
- 适配层新增 `onToolResult`。
- 测试：Node 20 项；真实 ToolRuntime 覆盖编辑作用域与体裁隔离；真实 headless 端到端改为主会话派出编辑子代理。

## 0.1.0 — 2026-10-28
- 新增 `dsh-writer-toutiao` 插件：按需启用，19 个头条工具，常驻总则，4 条门禁，本机写作台。
- 新增 `@writer/dsh-adapter`、`core`、`gates` 三个基础层。
- 头条规则沿用 toutiao-viral-writer 4.0.0 原脚本，新增 `writer_bridge.py` 统一 JSON 输出。
- 测试：Python 205 项、Node 17 项、真实 DSH ToolRuntime 集成 1 项、真实 dsh headless 端到端 1 项。
