# 织章（Zhizhang）

织章是面向中文长篇小说与资讯图文作者的**本地优先写作工作台**，核心原则是**「AI 起草，作者裁决」**。拆书提炼、全书规划、多路起稿、审读精修、连续性核对与规则质检交给可暂停、可恢复、预算可控的流水线；**正文采纳、逐处合并、定稿、设定落盘与交稿确认始终由作者拍板**。

## 核心能力

| 创作模式 | 对应包 | 核心工作流 |
| --- | --- | --- |
| **番茄长篇** | `@zhizhang/fanqie` | 拆书提炼与交互式技法仓 → 全书立项与卷/章纲提案隔离 → 分层上下文多路起稿与换位盲评 → 半章锁前缀续写、专项去 AI 腔/轻润色 → 多分支衍生谱系与过时提醒 → 设定集时间切片 `asOf(N)`、跨书时间线回查与三分类沉淀 → 连载存稿缓冲 KPI 与旧书零模型批量接管 |
| **今日头条图文** | `@zhizhang/toutiao` | 本地来源登记与正文提取 → 立项卡结构化校验 → 标题矩阵（严格 ≤ 34 字）与开头/结尾式轮换 → 资讯/故事双线起稿 → 原文逐字证据核验与来源哈希失效 → TypeScript 规则质检（≥ 84 分且零硬闸） → 验收修订锁、固定末句交稿单与发稿台账 |
| **柔和纸面工作台** | `@zhizhang/ui` + `@zhizhang/workbench` + `@zhizhang/desktop` | 无顶栏三栏布局（平铺左栏 + 浮起离线衬线稿纸 + 流水线/只读助手双卡右栏）、日夜双主题（`day` / `night`）、一色一意（赭橙严格仅表作者裁决）、D3 创作内核仪表盘、并排双稿纸逐处采纳与只读 PI 写作助手 |

## 快速开始

### 环境要求

- Node.js `≥ 22.0.0`（远端 CI 使用 Node `24`）

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

# 全量自动化测试（Node 单元测试与引擎集成测试）
npm test

# 内置资产清单、上游版本与 stage-map.json 引用完整性校验
npm run assets -- check

# 构建全仓 workspace 与 Web 预览前端产物
npm run build

# 构建并暂存 Electron 桌面端产物（主进程 + 预加载 + 渲染层 + 离线字体许可）
npm run desktop:build
```

## 数据目录与隐私边界

- **应用状态目录**：`~/.zhizhang/`（可用 `ZHIZHANG_STATE_ROOT` 覆盖），保存全局设置、系统密钥库加密的 `secrets.bin`（`0600` 权限）、运行记录、会话历史与去敏日志；不随写作文件夹同步或备份。
- **本地写作文件夹**：统一采用 `zhizhang/2.0` 磁盘格式：
  - `.zhizhang/`：跨进程租约（`lease.json`）、写锁目录（`.zhizhang-lock/`）、原子意图日志（`intents/`）、工作台未保存草稿暂存（`drafts/`）与回收站（`trash/`）。
  - `长篇/`：番茄长篇作品目录（`work.json`、`bible/`、`plan/`、`chapters/`、`candidates/`、`sources/legacy-import/`）。
  - `头条/`：头条文章目录（`meta.json`、`sources/`、`drafts/`、`qa/`、`delivery.md`）与发稿台账 `ledger.csv`。
  - `拆书库/`：拆书原文来源与结构化技法参考卡。

## 文档导航

仓库维护 6 份核心文档（受 `scripts/guard.mjs` `[G-docs]` 门禁约束）：

- [系统架构与工程规范](docs/ARCHITECTURE.md)：分层依赖边界、双宿主运行架构、存储与并发安全、柔和纸面令牌体系、测试架构与静态守卫
- [写作内核与业务规则](docs/WRITING.md)：受保护的业务规则红线、番茄长篇全链路、今日头条图文规则桥与内置资产维护
- [使用指南](docs/USER-GUIDE.md)：三栏工作台操作、旧书接管、时间线回查、技法仓编辑、只读助手与故障排查
- [项目状态](docs/STATUS.md)：最新实测验证矩阵、架构守卫指标、模块清单与远端 CI 清单
- [更新日志](CHANGELOG.md)：版本发布记录
