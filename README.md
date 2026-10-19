# dsh-zhizhang · 织章（DSH 插件）

**0.15.3**：三柱一环 + 反僵硬 + 可选编辑 A/B/C + 小说阅读工作台 + 可选多草稿（默认关）+ **按需启用（默认只挂 `zhizhang_enable`）** + **工程加固（id 沙箱、面板轮询降载、面板根对齐）**。迷路先 `zhizhang_product_map`。

DeepSeek Harness **工具型**网文工程层：**一条创作闭环**（库 → combo → 灵感 → lean 写作）。

```text
书进库（craft|mind）→ combo（1 mind+N craft）→ inspire 根基/纲 → brief(lean) → stage→lint→（可选 edit）→ accept
```

| 阶段 | 状态 | 交接 |
|------|------|------|
| 拆书库 | **已上线** | 双轴卡入库 → `library_combo_suggest` |
| 灵感 | **已上线** | mind 主粮推演根基/章纲 → `inspire_accept(apply)` |
| 写作 | **已上线** | lean brief 只吃 craft → 候选门禁兑付 |

共享 **MethodRegistry** 按需注入（≠拆书卡）。人味 = 写法+状态，不灌角色声纹。

默认布局可配（`storageRoot / worksRoot / libraryRoot / sourceRoot`），
留空则回退到 `<会话 cwd>/.zhizhang`。

拆书库可跨项目复用：`config.libraryRoot`（或 `DSH_ZHIZHANG_LIBRARY`）指向一个共享目录，
作品目录保持各自独立。书从哪来也可以固定：`config.sourceRoot`（或 `DSH_ZHIZHANG_SOURCE_ROOT`）
指向一个本地书源文件夹，`library_list` 会列出待导入的书，`library_import` 可直接写文件名。

**工程归代码；AI 只负责创作内容并把成稿作为工具参数提交；显式 accept 才持久化。**

## 按需启用（重要）

插件挂载时**只注册一个** `zhizhang_enable`，不注入 46 个工具与硬规则：

```text
普通会话 → 只有 zhizhang_enable（面板仍可读，且支持**项目 ▸ 作品**两级切换）
你说「启用织章」/ Agent 调 zhizhang_enable
  → 46 tools + SYSTEM_BRIEF 挂到本会话（Agent 作用域）
  → 再调 zhizhang_product_map 开始
```

- 换会话或重启后需重新启用；同一会话重复调用幂等。
- Web 面板常驻，不依赖工具启用。
- 想连 enable 工具都不要（标准会话零注入），需要拆成 client-only bundle + agent preset；当前版本未内置，属于后续架构项。

## 侧栏面板（Web）

DSH Web 侧栏点 **织章**：默认**三栏小说工作台**（读正式章全文、对照候选、真采纳）；可切「管线」看 Library / Inspiration 等。正文按需 `GET …/chapter`，不塞进 snapshot。写回仍用显式采纳或 `zhizhang_*`。细节：[docs/PANEL.md](docs/PANEL.md)

## 开发与安装

```bash
npm install            # prepare → tsc → dist/
npm run build          # 只重建
npm run typecheck
npm test               # bun test test/
npm run smoke          # node scripts/smoke.mjs（不需要 DSH / bun）
```

装进 profile：

```bash
# 1) 以 link: 挂进 profile（只解析依赖，不执行构建）
dsh plugin --profile web add link:$(pwd)

# 2) 启用：把 dsh-zhizhang 加进 profile 的 dsh.profile.bundles
#    （CLI 只装依赖，不会自动加 bundle；漏了这一步插件不会加载）
#    或按 cordis.patch.yml 的 insert 形态在 profile cordis.patch.yml 里加一层

# 3) 重启 profile；侧栏出现「织章」；普通会话只多一个 zhizhang_enable
# 4) 要写小说时让 Agent 调 zhizhang_enable（或说「启用织章」），46 个工具才挂载
```

需要 **Node ≥22**。细节：[docs/DSH_INSTALL.md](docs/DSH_INSTALL.md)

> 源码仓只提交 `src/` 与 `docs/`；`dist/` 由 `npm run build` 生成（git 不跟踪）。
> 发行包 = `dist/` + `docs/` + `scripts/smoke.mjs` + `cordis.patch.yml`，不含 `src/`。

## 闭环路径

```text
库：import → dissect_brief → card_stage(axis) → card_accept → combo_suggest
灵感：inspire_start(card_ids) → forge_brief → stage → accept(apply?)
写作：chapter_brief(lean) → candidate_stage → style_lint →（可选 edit）→ candidate_accept
```

迷路先看：`zhizhang_product_map`。

## 哲学

| 归代码 | 归 AI |
|--------|-------|
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

## 冒烟

```bash
npm run smoke        # node ≥22；不需要 DSH / bun
```

覆盖：46 个工具注册、默认写作链（brief→stage→lint→accept）、accept 硬闸、双采纳拒绝、
章节/候选 id 路径沙箱、面板 HTTP（snapshot JSON / `?html=1` / chapter / candidate /
confirm 闸 / projects）。

版本 **0.15.3**。不默认发布 zip。
