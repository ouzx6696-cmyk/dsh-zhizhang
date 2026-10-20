# 改动指南 · 只动 Ports · 测试怎么长

> 策略与可演进行为落在 `src/lib/ports/`。工具保持薄。  
> 端口细则：[PORTS.md](./PORTS.md) · 测试规则：[TEST.md](./TEST.md)

---

## 当前（0.17.0 重构）· 单一事实源 + 模块化

> 起因：同一件事散在多处——工具数 47/51/52、报告 19/22 节、拆书 9/10 步、版本 0.15.6/0.16.0；
> 分析层与库层是千行单体；accept 与前章解析各有 4 份拷贝。补丁式修改只会让下一处继续漂。

- **单一事实源** `dist/lib/domain/`：`chapter-heading.js`（中/阿拉伯章号、序章、卷）、`card-schema.js`（v1→v2 适配 + 5 项校验）、`evidence.js`（引文/正文引文回溯）、`coverage.js`（覆盖权重与 Auto 0.84 封顶）、`report-sections.js`（固定 19 节）、`workflow.js`（拆书 9 / 写作 6 步）。
- **分析层拆模块** `dist/lib/ports/analysis/{paths,chapters,meta,facts,structure,modules,evidence,coverage,survey,report,plan}.js`；`analysis.js` 只做 facade。报告 19 节固定：§1.1 量化底座 / §4.1 开篇十章节拍 / §9.1 爽点密度；小书不再出现幽灵章行与 `-Infinity`；§14 同时列 v2 与 v1 卡。
- **库层拆纯逻辑** `dist/lib/ports/library/{store,schema,audit}.js`（索引/导入、schema/格式化、机械审计）；v1 卡带 `steps/bannedDiction` 直接拒（不再静默丢）；v2 卡不再误报「书感偏薄」；`library_audit` 无正文引文时不再打印 `0/0`。
- **共享服务** `dist/lib/services/accept.js`（tool 与 panel 同一采纳管线）、`chapter-context.js`（brief / accept / audit / panel 同一前章解析）。
- **计数与版本运行时读取**：`zhizhang_enable` 回执/描述、ProductMap 工具面、报告节数、工作流文案都从 domain 读；客户端去掉 `47 个工具` 与版本硬编码。
- **测试**：smoke 新增 19 节、§9.1、无 `Infinity`、v2 不误报、v1 steps 拒绝、中文章号、audit 文案断言。

---

## 0.17.0（前一轮）· 量化底座 + 正文引文回溯 + 卡操作序列

> 起因：Auto 抽样能出剧情条，但全书骨架、卷界、词频、爽点密度这些「代码一跑就知道」的东西不该靠模型猜；
> 同时对照外部拆书资产发现：没有「正文引文回溯」的卡，会把合理想象写成「原文如此」，读起来更顺、实际更危险。

- **新增 L0 量化测绘** `dist/lib/ports/survey.js`：解析原文「第X卷」标记得到真实卷界；统计去空白字数/行数/章长/对话占比；2–4 字 n-gram 高频词（停用词过滤 + 嵌套去重）；按章序十等分热力；关键词密度 + 钩子强度 + 卷首卷末加成得到锚点章。全书扫一遍约 3 秒。
- **报告新增 §1.1 量化底座**：分卷表（章范围/章数/字数/首末章）、高频词 Top 20、分布热力、锚点章 Top 15；**§4.1 开篇十章节拍**；**§9.1 爽点密度**（强/中/弱钩子计数与平均间隔，按卷拆）。
- **置信度拆三层**：覆盖（事实/计划）+ 引文证据（引文通过率）+ 结构完整（测绘/剧情条/节奏/人物），加权后 Auto 抽样封顶 0.84 并标 needs_review，不再出现「1.0」的假达标。
- **`library_audit` 增加正文引文回溯**：只核「声称原文」的引文（前后 40 字含 原文/原著/第N章，或引文 ≥20 字）；示例引语跳过并计数。假引文会直接进 bad 列表。
- **卡新增 `steps` 与 `bannedDiction`**：三步操作公式 + 反AI腔词表；brief 注入（含 lean）时一并显示。
- **模块校验新增软警告**：emotionArc/dramaticUnit 带章号（梗概化）、证据全部同章（单场景）、steps 不足 2 步。
- **Auto 分层改为前 10 章 + 后 3 章 + 等距**：开篇十章节拍必须有事实，否则报告只能给 3 章判断。
- **`library_card_get` 渲染 v2 模块块**（此前 v2 卡只显示 humanFeel 段，看不到 5 项与 steps/bannedDiction）。
- **版本**：0.17.0；工具数仍 52。

---

## 当前（0.16.1）· 抽样两档：Auto 10% 分层 / Full 须作者同意

> 起因：0.16.0 的 sample 只取 4 章（约 0.4%），撑不起全书结论；但全量读 717 万字也不现实。
> 这一版把「读多少」变成显式计划：默认 10% 分层抽样，Full 全量必须作者明确同意。

- **新增 `library_plan`**（第 52 个工具）：Auto 按字数 10% 分层（前 3 章 + 后 3 章 + 其余按累计字数等距），确定性可复现；小书（10% < 3 万字）直接全读。
- **Full 两步闸**：`library_plan(mode="full")` 只出成本回执（章数/字数/tokens/批次数/时长）+ `confirm_token`，不写盘不开读；作者明确同意后带 `confirm_full + confirm_token` 才落盘，并记 `consent`。
- **`dissect_brief` 支持 `batch=n`**：按计划分批返回原文（≤3 万字/批），回执带进度与游标；无计划时保留 from/count 旧路径。
- **`facts_stage` 计划感知**：章号不在计划内 → 软警告（允许手补）；每批提交后推进 `cursor`，中断可续跑。
- **报告/审计/列表**：标 Auto/Full 与覆盖率；Auto 的全书结论一律标「抽样观察」；Full 未完成标「全量未完成」。
- **文档**：`docs/DISSECT.md` 增「四个问题」（什么是/为什么/得到什么/怎么拆）与两档表；SYSTEM_BRIEF / 产品地图 / TOOLS 改为 9 步。

## 当前（0.16.0）· 拆书 8 步：事实 → 聚合 → 模块 → 报告

> 起因：0.15.x 的「读几章 → 出卡」跳过事实层与聚合层，卡只能靠印象写，产出偏「场面观察」，不是写作技巧与创作理念。
> 这一版按成熟拆书方法论重做数据层与工序：先白描事实，再聚合剧情/节奏/人物，最后才抽象成模块与报告。

- **新增分析层** `dist/lib/ports/analysis.js`：章节目录解析、逐章事实（白描）、剧情条、节奏表、人物弧光、覆盖率/置信度、18 节报告拼装。
- **新增 4 个工具**（51 个）：`library_facts_stage` / `library_structure_stage` / `library_report` / `library_card_discard`。
- **`library_dissect_brief` 支持批次**：`mode=opening|chapters|sample|full` + `from/count`，直接返回下一批原文（≤3 章 / ≤15000 字）+ 事实模板。
- **`library_card_stage` 支持 v2 模块**：`layer + dimension + readerWant/emotionArc/dramaticUnit/replaceables/mustNotCopy/transfer/failWhen/evidence`；axis 由层+维度推导（book/arc/unit→mind，scene/chapter/line→craft）。
- **`library_card_accept` v2 硬校验**：5 项 + transfer/failWhen + evidence 逐条回溯；缺项/引文未命中直接拒；旧 v1 卡仍走原路径。
- **`library_audit` 增加分析层**：事实/剧情条/人物/白描违规/覆盖率；v2 模块走模块校验，不再误报「缺 ## 证据 段」。
- **`library_report`**：确定性拼装 18 节报告；覆盖不足标「早期观察」；写入 `library/analyses/<sourceId>/report.md`。
- **面板**：`/library` 返回 `analyses[]` 拆书进度；新增 `/report?source=` 报告接口。
- **SYSTEM_BRIEF**：拆书 7 步改为 8 步（批次 → 白描 → 聚合 → 模块 → 报告）。
- **文档**：新增 `docs/DISSECT.md`（方法论 + 阶段 + schema + 纪律）。

## 当前（0.15.6）· 工作流显式化：照做，别跳步

> 起因：理念注入后还差一步——把「先做什么、下一步是几」直接摆出来，别让 Agent 自己拼。

- **SYSTEM_BRIEF 新增【工作流】**：拆书 7 步 / 写作 6 步，每步带动作与闸；回执里的「下一步 N/7」与此同号。
- **ProductMap 新增 `WORKFLOWS`** 与「## 工作流（照做，别跳步）」段：每步 tool + 动作 + 出库闸。
- **库工具描述带步骤号**：1/7 交书 → 2/7 真读+拆 → 3/7 出卡 → 4/7 读警告 → 5/7 采纳 → 6/7 机械面审计 → 7/7 组包。
- **回执统一「下一步 N/7」**：import / dissect / stage / accept 均指向下一步；stage 的软警告在前、下一步在后。
- **docs/TOOLS.md「默认路径」**改为 7 步 / 6 步表，直接可抄。

## 上一版（0.15.5）· 核心理念注入：脚本跑过不算，真读才算

> 起因：0.15.4 的工具能证明「引文没编、字段没缺」，但没法证明「卡能用」。
> 这一版把验收判据写进硬规则、简报、暂存、采纳、审计五处，避免再用脚本通过冒充拆完。

- **SYSTEM_BRIEF 新增第 8 条**：拆书验收（真读，不看脚本）——引文/字段/audit 只证明没编没缺；
  五条判据：可操作 / 特异性（换书名还成立=没抓到本书）/ 非梗概 / 状态落纸 / 失败边界具体。
- **dissect_brief 新增「怎么算拆完」**：明确「字段齐全 / 引文能搜到 / 审计通过」不算合格；
  mind 卡须有一句「检验方法」。
- **card_stage 新增读没读的形状警告**：缺证据段、证据无章号（只有简介）、
  mind 缺「设计决策」或「检验方法」、craft 缺「写法」——只是形状，真读仍需人判。
- **card_accept 回执新增「判断面」**：机械审计只证明没编没缺；要求回答「这张卡最可能失效的地方」。
- **library_audit 输出分两面**：机械面（引文/章号/占位）+ 判断面（脚本核不了）；
  结尾固定「机械面通过 ≠ 卡能用」；新增「疑似设定复述」标记（mind 缺设计决策与检验方法）。
- **QualityPolicy 新增** `cardJudgmentLine()` / `cardJudgmentBlock()` / `CARD_JUDGMENT_CRITERIA`。

## 上一版（0.15.4）· 拆书库实测修复（导入编码 / 查询分词 / 卡审计）

> 来源：实际拆 20 本、63 张卡的运行记录。只修跑出来的问题，不扩功能面。

- **导入编码**：`library_import` 不再一律按 UTF-8 读。严格 UTF-8 校验失败时回退 GB18030
  （含 UTF-16LE / BOM 处理），回执显示「编码：gb18030（已转换）」。
  实测：GBK 源书不再整本乱码，省掉手工 iconv。
- **路径兼容**：`file` 支持 MSYS 风格 `/d/foo/bar.txt` 与带引号路径，自动归一化为
  `D:/foo/bar.txt`；读失败时错误信息带上「已尝试路径」，不再只有一句 file_read_failed。
- **查询分词**：`library_search` / `library_combo_suggest` 的 query 按空格、逗号、顿号、
  分号、加号切词，多词=同时满足，并给多词覆盖加成。
  修的是实测 bug：原来整串当一个子串匹配，「都市高武 神话」永远 0 命中，
  两个不同 query 返回同一个组合包。
- **标签精确过滤**：`library_search` 新增 `tag`（如 战斗 / 都市高武 / 信息投放），
  只按标签取卡，不受正文关键词噪声影响。
- **索引自动对齐**：工具首次访问库时，用卡文件回填 index 的 tags / axis / title / updatedAt，
  避免「改了卡、索引还是旧标签」。每进程只跑一次。
- **新增 `library_audit`（诊断旁路）**：逐卡检查
  ① 证据引文能否在原文核对（归一化去标点后比对，省略号分段）；
  ② 证据标题章号 vs 引文实际位置（多数票，≥2 票才判）；
  ③ readingRange 是否仍是「见拆书简报」占位；
  ④ mind 卡是否把 infoStaging 写成剧情分段、pressureMachine 没写「谁逼谁」、卖点过短。
  只诊断不改卡；`card_accept` 采纳时也会跑一遍软审计并把警告写进回执。
- **工具数**：46 → 47（enable 回执、面板文案、smoke 断言同步）。

## 上一版（0.15.3）· 按需启用 + 面板多项目

- **作品目录可见化**：新增 `worksRoot`（或 `DSH_ZHIZHANG_WORKS`），作品直接落在
  `<worksRoot>/<书名>/`（meta/chapters/candidates），不再是隐藏的 `<base>/works/`；
  索引与面板摘要记录 works 路径。本机默认布局见 `cordis.patch.yml`（D:/织章）。
- **本地书源目录**：新增 `sourceRoot`（或 `DSH_ZHIZHANG_SOURCE_ROOT`）指向一个书文件夹；
  `library_list` 列出该目录的 `.txt/.md`（已导入/未导入），`library_import` 可用裸文件名导入；
  面板 Library 区显示待导入数量与文件名。只读扫描，不自动导入。
- **拆书库复用**：新增 `libraryRoot` 配置（或 `DSH_ZHIZHANG_LIBRARY`），把 `library`
  指到共享目录；`works / manuscripts / inspiration` 仍按项目隔离。工具与面板读取同一份库。
- **面板多项目**：工具在 `ensureStorage` 时把工作区登记进 `$DSH_HOME/zhizhang-projects.json`
  （只存指针 + 时间，不复制正文）；面板新增 **项目下拉**（`GET …/projects`），
  顶栏 `项目 ▸ 作品` 两级切换。`?base=<项目 id>` 只接受**已登记且存在**的根，
  未知根一律 `400 bad_base`——面板不会退化成任意路径浏览器。
  - 项目摘要（作品数 / 章节 / 字数）每次都从各项目自己的 `.zhizhang` 现算（5s 缓存），
    可重算、可删索引、**不再是权威副本**；项目不可达时保留 `exists:false` 行并标「不可达」。
  - 采纳 / 读章 / 读候选 / 统一整理都跟随面板当前项目（POST body 的 `base` 字段）。


- **按需加载**：profile 挂载只注册一个 `zhizhang_enable`（+ 只读面板 HTTP），
  **不再**每会话注入 46 个工具与 SYSTEM_BRIEF。
  - 触发后按 **Agent 作用域** 挂载 46 tools + 硬规则；仅该会话可见
    （宿主不支持作用域时退化为进程内全局）。
  - 同一 Agent 重复调用幂等；换会话 / 重启后需重新启用。
  - Web 面板仍常驻（读正式章 / 候选 / 真采纳），不依赖工具启用。
- **版本**：`src/lib/version.ts` 单源 `PLUGIN_VERSION`；package / ProductMap / Scheduler / EditPort /
  MultiDraftPort / 面板页脚都引用它（测试断言 0.15.3）。
- **面板视觉**（`src/client/client.js`，只动样式与结构，不动语义）：
  - 颜色全部由 `currentColor` 经 `color-mix()` 派生（`--zz-line / --zz-surface / --zz-muted / --zz-accent …`），
    跟随 DSH 明暗主题自动适配；去掉硬编码明暗两套色值。
  - 阅读器：中文段落 `text-indent:2em`、衬线字体、`text-wrap:pretty`、正文列居中；工具栏 `position:sticky`。
  - 章节列表：标题单行省略（`title` 悬停看全）、字数右对齐、选中左侧竖条；窄栏（≤1100px）隐藏字数让标题呼吸。
  - 候选对照：工具栏显示只读身份 chip（`「稿名」id · 字数 · lint`）——**不新增采纳入口**。
  - 无待采纳时「本章闸」的 lint 行改中性色（`zz-gate-idle`），不再误标红。
  - 骨架屏 `.zz-skel` + `@keyframes zz-shimmer`；Library 书源改自适应网格；`prefers-reduced-motion` 关动效。
  - 可访问性：tab `aria-selected`、章节 `aria-current`、候选行 `role=button`+Enter/Space、
    `zz-err`/`zz-ok` 加 `role=alert/status`、`:focus-visible` 焦点环、确认框复选框 `accent-color`。
  - 断点：≤1100px 两栏（右栏整行）、≤720px 单栏（左栏 40vh / 中栏 56vh）、≤520px 收边距。

## 此前（0.15.2）

- **按需启用**：profile 挂载只注册 `zhizhang_enable` + 只读面板 HTTP；触发后按 Agent 作用域
  挂 46 tools + 硬规则。回执直接带 `ProductMap.formatForAgent()`，省一次往返。

## 此前（0.15.1）

- **工程加固（不改默认链 / 不改旁路表）**：
  - **id 沙箱**：章节 / 候选 id 统一在 store 校验（禁 `/`、`\`、`.`、`..`、控制字符、Windows 保留名；允许中文），
    工具与 HTTP 同源；新错误码 `bad_id`。`candidate_stage` / `chapter_save` / `chapter_read` 等全部覆盖。
  - **面板轮询降载**：`GET …/snapshot` 默认**不**返回 HTML（显式 `?html=1` 才带）；
    候选 `wordCount` 在 stage 时落盘（旧数据回退读正文）；章节透镜按 mtime+size 缓存；
    候选正文按 id 加载，不再每 6s 重拉。
  - **面板根对齐**：HTTP 面板跟随最近一次 Agent 工具使用的存储根（`last-agent-tool`），
    不再固定读宿主 cwd（之前会「工具写 workspace、面板看 profile」两套根）。
  - **Web 修复**：切章清空旧正文/标题；snapshot 的 `ok:false` 不再被当成空态；
    `load` 加请求序号防乱序；采纳后强制刷新（防「已采纳仍显示待采纳」导致二次采纳）；
    采纳超时后自动对账；候选轮询不再丢失阅读选区；剪贴板 Promise 兜底；`escapeHtml` 补 `'`。
  - **包**：新增 `scripts/smoke.mjs`（`npm run smoke`，node ≥22，无需 DSH/bun）；
    补 `types`；移除指向不存在源码的 `build/prepare/typecheck/test` 脚本与 devDependencies
    （本目录是发行形态，构建请回源码仓）。
- **版本**：package / ProductMap / Scheduler / EditPort / MultiDraftPort 统一 **0.15.1**。

## 此前（0.15.0）

- **统合切片**：COGNITION/MAP/PORTS/PANEL/STATUS/FRAMEWORK/README 与 package / ProductMap / Scheduler / EditPort / MultiDraftPort 全部钉 **0.15.0**。
- 面板↔工具：snapshot nextHints 含编辑稿/多草稿提示；panel-html 展示 draftLabel/unifyOf；右栏编辑抉择说明卡。
- 前端美化：工作台层次、阅读区、模式切换、空态/徽章（同主题变量）。
- **不改**：默认链；multi-draft 默认关；无 Tiptap；无静默写章；audit 不进默认链。

## 此前（0.14.0）

- **可选多草稿 + 统一整理（默认关）**：`PortConfig.multiDraftEnabled` / 插件 `multiDraft.enabled` / env `DSH_ZHIZHANG_MULTI_DRAFT=1`。
- 同章可多次 `candidate_stage(draft_label)`（关着也能 stage）；`unify_brief` / `unify_stage` 须开启。
- 整理稿 `source=unify` + `unifyOf`；仍走 lint → accept；**不进默认 nextHint**。
- 面板：列出全部待采纳标签；开启后「统一整理」→ `POST …/unify/prepare` 只返回 brief。
- 默认链负重与 0.13 相同。

详见 [PORTS.md](./PORTS.md) · [TOOLS.md](./TOOLS.md) · [PANEL.md](./PANEL.md)。

## 此前（0.13.0）

- **小说阅读工作台（默认）**：三栏（章节 / 正式章正文 / 状态与闸）；轻量 MD 只读；候选对照；`localStorage` 记作品+章。
- **按需读正文**：`GET …/chapter`、`GET …/candidate`；snapshot **仍无**全文。
- **管线五 Tab** 保留为顶栏「管线」次级视图。
- **真采纳**不变（confirm + AcceptPolicy）。
- 当时未做：Tiptap、页内起草、面板 A/B/C、静默写库。


## 此前（0.12.0）

- 完整 Web 控制台五 Tab + 真采纳 + 自动刷新 + settings 卡。
- `GET …/library`、`GET …/inspiration`；HTML 对齐。

---


## 总则

| 可以 | 不可以 |
|------|--------|
| 改 Port 实现或 `PortConfig` | 在工具 `execute` 里新写 if-硬闸 |
| 给 Gate 加可选 flag（默认软） | 把禁词命中默认升级为硬拒质量法 |
| 扩展 MethodRegistry 资产 id | 把整包方法灌进 `SYSTEM_BRIEF` |
| 经 Audit 端口换传感器实现 | 让 AI / bash 直写 `chapters/` / `library/cards/` |
| 扩展 Library / Inspiration 契约 | 用 foundation notes 假装技法卡已入库；静默 foundation_set |
| 改 Scheduler 默认线/旁路表 | 在工具里另写一套「推荐链」绕过 Scheduler |

契约类型：`GateDecision`（`ok` + `messages[]`；`ok===false` 须硬拒）。

---

## 改哪里（按意图）

| 你想改的 | 打开 |
|----------|------|
| 默认路径 / 旁路表 / 回执下一步 | `ports/scheduler.ts`（再确认 ProductMap / SYSTEM_BRIEF 引用它） |
| 产品地图叙事 / 三阶段交接文案 | `ports/product.ts`（闭环句 ≡ Scheduler.defaultLine） |
| 质量面文案 / 毒点政策 / 书债线索 | `ports/quality-policy.ts` |
| 拆书双轴 / 准入 / combo / lean 卡块 | `ports/library.ts` |
| 灵感分喂 / forge / apply | `ports/inspiration.ts` |
| Accept 组合顺序与旗标默认 | `ports/accept-policy.ts` + `ports/config.ts` |
| 写后可选编辑 / A·B·C | `ports/edit.ts` + `tools/candidates.ts`；技能 `docs/skills/web-novel-master-optimizer.md` |
| 各闸软硬行为 | `*-gate.ts` |
| lean/full 方法包列表 | `ports/methods.ts` + `method-assets.ts` |
| 常驻硬规则短文 | `tools/brief.ts`（`SYSTEM_BRIEF`；保持短，细节指 product_map） |
| 当前小说状态 / happened 对齐 | `ports/foundation.ts` + `tools/candidates.ts`；读者合同 `method-assets.ts` |
| 库准入（声纹假阳） | `ports/library.ts` `admitCardContent` / `neutralizeVoiceNegations` |
| 工具名与参数壳 | `src/tools/*`（只接线，不藏策略） |
| 落盘路径与原子写 | `lib/store.ts`（谨慎；DATA.md 同步） |
| 面板 UI / HTTP | `src/client/client.js` + `lib/panel-html.ts` + `lib/http-api.ts`；见 [PANEL.md](./PANEL.md) |

Compose 入口：`src/index.ts` 只注册工具 + apply，不塞业务 if。

---

## 新能力怎么挂

1. **先定端口**：新策略 → 新 Port 或扩展现有 Port；导出挂到 `ports/index.ts`。  
2. **工具薄接**：`defineTool` → 调 Port → 回执引用 `Scheduler.nextHint(...)`。  
3. **地图/硬规则**：若改变「怎么跑」，更新 Scheduler（及必要时 SYSTEM_BRIEF 一句指针）。  
4. **测试**：一条**契约套件**，不是 N 条句子测试。  
   - 产品叙事（闭环句、分喂、互指）→ `test/contracts/product-loop.test.ts`  
   - 调度默认/旁路 → `test/contracts/scheduler.test.ts`  
   - 闸/传感 → `test/gates/`  
   - 支柱工序 → `test/pillars/`  
5. **断言偏好**：hit code / 硬拒 code；少绑中文长句；金样放 `test/fixtures/`。  
6. **禁止**：为 SYSTEM_BRIEF / dissect 新加的一句单独开 `test()`。  
7. **版本**：只改 docs → 可不升版；动契约/默认行为 → 升小版并改 `package.json` + STATUS + ProductMap/Scheduler `version` 对齐。  
8. **打包**：用户不主动要 zip **就不打包**。

---

## 改完自检

```bash
# 源码仓：
bun test
npm run typecheck
# 需要 dist 时再 npm run build

# 本发行包：
npm run smoke
```

确认：默认链仍最短合格；旁路仍显式；mind/craft 分喂未破；雷达默认仍软。

---

## 0.11.1

- **编辑深度优化（仍可选）**：`polish-depolish` brief / MODE_INFO 正向写成「保留呼吸与毛边」；明确去AI味 ≠ 磨成范文齐句；禁止为去味熨平句长、主语砍光。
- **技能** `web-novel-master-optimizer` 对齐同一口径；齐刷短句优先退回写手或换 `polish-rhythm`。
- **edit_stage 软提示**：对人味 `uniform_short_run` 等挂回执（不阻断 A/B/C）。
- A/B/C 契约不变；写手 lint 后仍可直 accept。
- 版本号与 ProductMap / Scheduler / EditPort `version` 对齐 **0.11.1**。

---

## 0.11.0


- **写后可选编辑**：`port.edit`；默认模式 `polish-depolish`；链上 lint 后可选 edit_brief→edit_stage→用户选 A/B/C。
- **路径 A**：一次确认 `confirm_accept_after_edit` = 应用编辑 + accept；未确认硬拒；未表态按 B；禁止静默验收。
- **反僵硬**：拆书 craft 抽打碎逻辑 + 本书载体；`allowedEdges` 应落纸；lean 一行正向；`stiffness_tidy` 默认 warn（非脏话配额）。
- **连续性**：lean n≥2 注入前章正文全文；对外「当前小说状态」。
- 版本号与 ProductMap / Scheduler / EditPort `version` 对齐 **0.11.0**。
- 更早小步说明见 [archive/CHANGE_NOTES_0.10.x.md](./archive/CHANGE_NOTES_0.10.x.md)。

