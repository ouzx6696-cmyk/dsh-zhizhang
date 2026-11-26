# 织章（Zhizhang）

织章是面向中文长篇小说与资讯图文作者的**本地优先写作工作台**，核心产品理念是**「AI 起草，作者裁决」**。拆书提炼、全书立项、多路起稿、审读精修、连续性核对与规则质检交给可暂停、可恢复、预算可控的流水线；**正文采纳、逐段合并、定稿、设定落盘与交稿始终留在作者手中**。

## 五大灵感来源与模块映射

织章将五大上游方法论与界面设计宪法完整映射为确定性的代码模块与资产体系：

| 灵感来源 | 上游资产 / 参考 | 对应核心模块 | 核心能力 |
| --- | --- | --- | --- |
| **拆书技法库** (`inspiration-forge-library` v1.3.0) | `packages/fanqie/skill/forge/inspiration-forge-library/` | `@zhizhang/fanqie` `pipelines/dissect/`、`commands/library.ts`、`TechniqueWarehouse` | 作品结构测绘、分层抽样、逐字引文核验、五层拆解、技法卡三步做法与交互式 Markdown 编辑器 |
| **全书立项规划** (`inspiration-forge` v1.3.0) | `packages/fanqie/skill/forge/inspiration-forge/` | `@zhizhang/fanqie` `pipelines/book/`、`commands/work.ts` | 故事根基、卷纲/幕纲/前序章纲提案隔离（`plan/proposals/<runId>/`）、技法卡绑定与大纲校验 |
| **番茄长篇写作** (`novel-writer` v1.3.0) | `packages/fanqie/skill/forge/novel-writer/`、`packages/fanqie/profiles/default/` | `@zhizhang/fanqie` `pipelines/{chapter,revise,ledger,health}/`、`bible/`、`context/`、`commands/import.ts`、`FanqieWorkspace`、`BibleCenter`、`DraftCompare` | L0–L6 逐项预算裁剪与 BM25 内容哈希缓存、六大题材基准表、半章锁前缀续写、专项去 AI 腔/轻润色、多分支衍生谱系、设定集 `asOf(N)` 与跨书时间线回查、连载存稿 KPI、旧书零模型接管与双稿纸逐处采纳 |
| **头条图文写作** (`toutiao-viral-writer` v4.0.0) | `packages/toutiao/skill/` | `@zhizhang/toutiao` `domain/`、`rules/`、`pipelines/`、`commands/`、`ToutiaoWorkspace`、`ToutiaoLedger` | 资讯/故事双线 × 长图文/短图文/微头条、唯一规则源 `rules.py`（标题 ≤34 字、质检 ≥84 分）、立项卡校验、原文逐字证据核验与来源哈希失效、验收修订绑定、固定末句交稿与发稿台账 |
| **柔和纸面 C2 桌面美学** (`zhizhang-c2-calm.html`) | `packages/ui/src/tokens/`、`apps/desktop/src/renderer/` | `palette.css` → `semantic.css` → `component.css`、`LeftRail`、`CenterBar`、`RightDock`、`DraftCompare` | 去掉顶栏与浮层 Toast 的三栏布局、本地离线思源宋体衬线纸面（零外链字体请求）、一色一意（赭橙仅用于作者裁决）、日夜双主题（`day` / `night`） |

## 界面与协作亮点

- **稿纸是主角**：去掉冗余顶栏与打断式浮层，以 240px 平铺左栏 + 浮起衬线稿纸中栏 + 344px 双卡右栏构建安静写作空间；底部静默展示「已保存到本地 · 时间」。
- **一色一意**：赭橙（`--zz-decide`）严格仅用于「需要作者裁决」的提示、圆点与主按钮；蓝（`--zz-run`）表示机器运行；绿/红（`--zz-ok` / `--zz-bad`）表示增删与通过/失败；琥珀（`--zz-warn`）表示需要留意（包括存稿缺口与过时分支提醒）。
- **创作内核仪表盘与连载存稿 KPI**：Studio 顶部内置基于 D3 的拆解/整理/填充进度与流水线节点状态图，番茄长篇同步展示连续可发存稿章数、字数、可撑天数与断档章号缺口提醒。
- **轻量单点与旧书接管**：支持锁定已写前缀的半章续写、专项去 AI 腔/轻润色（不冒充完整审读）、多分支衍生谱系与过时下游告警，以及支持切章预览、原字节备份与默认 `drafted` 状态导入的旧书零模型批量接管。
- **候选稿决策卡与逐处采纳**：并排双稿纸行内展示红删/绿增与编号，支持「丢弃 / 部分采纳 / 采纳候选稿」与采纳后撤回。
- **只读写作助手**：基于 PI 内核的独立会话引擎，提供只读查阅（含跨书实体时间线回查）、原文引用定位与发起流水线能力，**禁止直接改写正文或设定集**。

## 快速开始

### 环境要求
- Node.js `≥ 24.11.0`
- Python `3.13`（头条质检与番茄脚本唯一规则源；Windows 发行包内置随包 Python）

### 常用命令

```bash
# 安装依赖
npm install

# 启动 Web 本地预览（http://0.0.0.0:3000，自动初始化示例作品与头条）
npm run dev

# 启动 Electron 桌面开发环境
npm run desktop:dev

# 全量静态检查（tsc -b + ESLint + Prettier + 架构守卫 guard.mjs）
npm run check

# 全量自动化测试（头条/番茄 Python unittest + Node unit/engine 测试）
npm test

# 内置资产清单、上游版本与 stage-map.json 完整性校验
npm run assets -- check

# 构建全仓 workspace 与 Web 预览前端产物
npm run build

# 构建并暂存 Electron 桌面端产物（主进程 + 预加载 + 渲染层 + 离线字体许可）
npm run desktop:build
```

## 数据目录与隐私边界

- **应用状态目录**：`~/.zhizhang/`（可用 `ZHIZHANG_STATE_ROOT` 覆盖），保存全局设置、系统密钥库加密的 `secrets.bin`（`0600` 权限）、运行记录、会话历史与去敏日志；不随作品目录同步或备份。
- **本地写作文件夹**：统一采用 `zhizhang/2.0` 磁盘格式：
  - `.zhizhang/`：跨进程租约（`lease.json`）、写锁目录（`.zhizhang-lock/`）、原子意图日志（`intents/`）、工作台未保存草稿暂存（`drafts/`）与回收站（`trash/`）。
  - `长篇/`：番茄长篇作品目录（`work.json`、`bible/`、`plan/`、`chapters/`、`candidates/`、`sources/legacy-import/`）。
  - `头条/`：头条文章目录（`meta.json`、`sources/`、`drafts/`、`qa/`、`delivery.md`）与发稿台账 `ledger.csv`。
  - `拆书库/`：拆书原文来源与结构化技法参考卡。

## 文档导航

仓库严格维护 8 份核心文档（受 `scripts/guard.mjs` `[G-docs]` 门禁约束）：

- [开发协作宪法](AGENTS.md)：核心业务红线、分层与样式守卫、代码/测试纪律与目录地图
- [系统架构](docs/ARCHITECTURE.md)：L0–L3 分层、双宿主传输、原子意图与预算并发、PI 会话内核与柔和纸面 C2 令牌体系
- [写作内核与业务规则](docs/WRITING.md)：受保护规则、番茄长篇与头条图文 v2.3 全链路规则及资产清单校验
- [使用指南](docs/USER-GUIDE.md)：柔和纸面 C2 三栏工作台操作、旧书接管、时间线回查、技法仓编辑、备份与故障排查
- [项目状态](docs/STATUS.md)：最新实测验证矩阵、架构守卫指标与远端 CI 清单
- [更新日志](CHANGELOG.md)：v0.x → v2.3.0 演进、方法论升级与全量可靠性加固记录
- [v2 演进规划](docs/plans/v2.md)：关键架构与设计决策台账（D1–D35）与后续路线图
