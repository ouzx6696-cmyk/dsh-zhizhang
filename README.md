# dsh-zhizhang · 织章（DSH 插件）

**0.17.0**：**拆书 9 步（定档 → 事实 → 聚合 → 模块 → 报告）· Auto 10% 分层 / Full 须作者明确同意** + 三柱一环 + 反僵硬 + 可选编辑 A/B/C + 小说阅读工作台 + 可选多草稿（默认关）+ **按需启用（默认只挂 `zhizhang_enable`）**。迷路先 `zhizhang_product_map`。

DeepSeek Harness **工具型**网文工程层：**一条创作闭环**（库 → combo → 灵感 → lean 写作）。

```text
拆书（定档 → 批次 → 白描事实 → 聚合 → 模块/报告）→ 书进库（book/scene）→ combo（1 book+N scene）→ inspire 根基/纲 → brief(lean) → stage→lint→（可选 edit）→ accept
```

| 阶段 | 状态 | 交接 |
|------|------|------|
| 拆书库 | **已上线** | 双轴卡入库 → `library_combo_suggest` |
| 灵感 | **已上线** | mind 主粮推演根基/章纲 → `inspire_accept(apply)` |
| 写作 | **已上线** | lean brief 只吃 craft → 候选门禁兑付 |

共享 **MethodRegistry** 按需注入（≠拆书卡）。人味 = 写法+状态，不灌角色声纹。

默认布局可配（`storageRoot / worksRoot / libraryRoot / sourceRoot`），
本机当前默认：`D:/织章/{.zhizhang, 小说项目, 拆书库}`。

拆书库可跨项目复用：`config.libraryRoot`（或 `DSH_ZHIZHANG_LIBRARY`）指向一个共享目录，
作品目录保持各自独立。书从哪来也可以固定：`config.sourceRoot`（或 `DSH_ZHIZHANG_SOURCE_ROOT`）
指向一个本地书源文件夹，`library_list` 会列出待导入的书，`library_import` 可直接写文件名。

**工程归代码；AI 只负责创作内容并把成稿作为工具参数提交；显式 accept 才持久化。**

## 按需启用（重要）

插件挂载时**只注册一个** `zhizhang_enable`，不注入 51 个工具与硬规则：

```text
普通会话 → 只有 zhizhang_enable（面板仍可读，且支持**项目 ▸ 作品**两级切换）
你说「启用织章」/ Agent 调 zhizhang_enable
  → 51 tools + SYSTEM_BRIEF 挂到本会话（Agent 作用域）
  → 再调 zhizhang_product_map 开始
```

- 换会话或重启后需重新启用；同一会话重复调用幂等。
- Web 面板常驻，不依赖工具启用。
- 想连 enable 工具都不要（标准会话零注入），需要拆成 client-only bundle + agent preset；当前版本未内置，属于后续架构项。

## 侧栏面板（Web）

DSH Web 侧栏点 **织章**：默认**三栏小说工作台**（读正式章全文、对照候选、真采纳）；可切「管线」看 Library / Inspiration 等。正文按需 `GET …/chapter`，不塞进 snapshot。写回仍用显式采纳或 `zhizhang_*`。细节：[docs/PANEL.md](docs/PANEL.md)

## 安装

```bash
# 1) 以 link: 挂进 profile（只解析依赖，不执行构建）
dsh plugin --profile web add link:$(pwd)

# 2) 启用：把 dsh-zhizhang 加进 profile 的 dsh.profile.bundles
#    （CLI 只装依赖，不会自动加 bundle；漏了这一步插件不会加载）
#    或按 cordis.patch.yml 的 insert 形态在 profile cordis.patch.yml 里加一层

# 3) 重启 profile；侧栏出现「织章」；普通会话只多一个 zhizhang_enable
# 4) 要写小说时让 Agent 调 zhizhang_enable（或说「启用织章」），51 个工具才挂载
```

需要 **Node ≥22**。细节：[docs/DSH_INSTALL.md](docs/DSH_INSTALL.md)

> 本仓库包含 `src/` 和 TypeScript 构建配置。开发时使用 Node ≥22、`npm ci` 和
> `npm run build`；发行包通过 `dist/` 加载；源码仓库统一使用 `npm run check` 校验。

## 闭环路径

```text
库（9 步）：import → plan（Auto 10% / Full 须同意）→ dissect_brief（batch）→ facts_stage（白描）→ structure_stage（剧情/节奏/人物）→ card_stage（v2 模块）→ card_accept → report → combo_suggest
灵感：inspire_start（可选 card_ids）→ forge_brief → stage → accept(apply?)
写作（6 步）：chapter_brief(lean) → 写正文 → candidate_stage → style_lint →（可选 edit）→ candidate_accept
```

迷路先看：`zhizhang_product_map`。

规划可不依赖参考卡。全书、卷和幕分别用 `zhizhang_inspire_stage` 的 `book_plan`、`volume_plan`、`act_plan` 暂存；经 `zhizhang_inspire_accept(apply=true)` 后，关联章节的 brief 和面板会显示已采纳规划。`zhizhang_inspire_status(work=…)` 查看完整内容与来源记录；可带 `history=true` 查看已应用候选，再以 `candidate=…` 查看原内容。

正文采纳或章节保存中断时，使用 `zhizhang_status(work=…, recovery=inspect|resume)`；书源导入、拆书计划或分析、卡采纳或删卡中断时使用 `zhizhang_library_list(recovery=inspect|resume)`；灵感应用中断时使用 `zhizhang_inspire_status(recovery=inspect|resume)`。文件冲突时先保留原文件并核对，不要重复操作。备份与恢复边界见 [docs/DATA.md](docs/DATA.md)。

## 哲学

| 归代码 | 归 AI |
|--------|--------|
| 落盘、锁、原子写、路径沙箱 | 大纲措辞、正文、改稿、拆书分析 |
| 门禁（Ports）、雷达、兑付审计 | 把成稿作为**工具参数**提交 |
| 候选 stage / accept、审校留痕 | 五类证据**诊断**（写入 ledger） |
| final 拒覆盖、禁止双采纳 | **不**直接碰磁盘、**不**自称已写库 |

## 文档（认知层）

从这一份开始读懂全局：**[docs/COGNITION.md](docs/COGNITION.md)**

| 文档 | 内容 |
|------|------|
| [docs/COGNITION.md](docs/COGNITION.md) | **总入口**：是什么、一图、分册导航 |
| [docs/MAP.md](docs/MAP.md) | 默认路径 + 显式旁路 |
| [docs/PILLARS.md](docs/PILLARS.md) | 三柱说明书 |
| [docs/QUALITY.md](docs/QUALITY.md) | 人味·书感·毒点·brief |
| [docs/CHANGE.md](docs/CHANGE.md) | 改哪里、怎么挂测 |
| [docs/PORTS.md](docs/PORTS.md) | 改进端口契约 |
| [docs/TOOLS.md](docs/TOOLS.md) | 工具一览 |
| [docs/DATA.md](docs/DATA.md) | 磁盘布局 |
| [docs/TEST.md](docs/TEST.md) | 测试分层 |
| [docs/STATUS.md](docs/STATUS.md) | 当前版本事实 |
| [docs/REVIEW.md](docs/REVIEW.md) | 全局梳理、修正结果与维护重点 |

## 校验

```bash
npm run check  # 构建、静态护栏和测试
npm test       # 构建并运行测试
```

测试覆盖一条精简创作主线、资产与恢复、并发和面板安全。详情见 [docs/TEST.md](docs/TEST.md)。

版本 **0.17.0**。不默认发布 zip。
