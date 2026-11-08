# 织章 · 写作 Agent

面向中文网文与图文创作者的本地桌面写作客户端：**番茄长篇**与**今日头条图文**两种模式，规划、起稿、审读、修订、质检走成一条可看、可停、可恢复的流水线，**每一次采纳、定稿和交稿都由作者决定**。

基于内置 PI SDK 的 Electron 应用。作品只存在你的电脑上；模型只在你发起任务时收到相关创作内容。

> 最近正式版 **[v0.9.9](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases/tag/v0.9.9)**；测试版 **[v1.0.0-preview.1](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases/tag/v1.0.0-preview.1)**。`master` 上的源码领先于测试版，变化见 [CHANGELOG](CHANGELOG.md)。

## 能做什么

**番茄长篇**

- 从立项卡、全书根基、章纲到正文，按阶段推进；长书只带本章需要的材料（本章章纲、前章结尾、到期伏笔、已确认事实），不随章数撑爆上下文。
- 一章多稿，读者视角两两比较择优；硬伤审读与改进建议分开，定向修订后仍有问题会如实标注交给作者，不会悄悄丢稿。
- 连续性看板（人物、设定、伏笔、冲突待确认）、定稿后自动记账、每十章长线体检与节奏曲线。
- 文风规则由 Python 扫描，标注落回原文位置。

**头条图文**

- 从来源到成稿：标题矩阵、故事线、事实链（每条事实须落在提供的原文里）、正文与真实质检硬闸，质检不过不交稿。
- 内置多个垂类语料与方法；近期用过的标题自动避开。

**写作台**

- 稿纸阅读与编辑：查找替换（Ctrl+F / Ctrl+H）、未保存内容本机暂存可恢复、阅读位置保持、字号可调。
- 写作流水线面板：停靠在侧边，边看正文边看进度；每个阶段的耗时、用量、费用和产出都能展开查看，可暂停、恢复、从失败处重试。
- 写作助手对话：随时下指令或追问，忙时消息排队；上下文占用一眼可见，支持手动压缩。
- 个人规则：从你的改稿里归纳候选规则，确认后才生效。
- 导出 TXT、DOCX 或复制正文。应用不登录、不自动发布到任何平台。

## 快速开始

1. 从 [Releases](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases) 下载 Windows x64 安装包（`.exe`）或免安装包（`.zip`），可用 `SHA256SUMS` 校验。
2. 打开“设置 › 模型”，填接口、模型 ID 和 Key，点“测试连接”。支持 DeepSeek、Kimi、通义千问、智谱，以及 OpenAI / Anthropic 兼容接口；写手、编辑、规划可分别配模型。
3. 选择一个写作根目录，新建长篇或头条文章，开始第一个任务。

> 发行包暂未做 Windows 代码签名，首次运行可能出现 SmartScreen 提示；核对校验值后选“更多信息 › 仍要运行”。

写作根目录包含 `novels/`、`toutiao/` 和 `.writer/`，可以直接备份或放进同步盘。详细用法见[桌面说明](docs/guides/DESKTOP.md)。

## 费用与隐私

- 只有你发起任务时才调用模型；请求内容会发送到你配置的服务商。
- 每个任务有输入预算，到顶会暂停并保存进度；服务商返回余额不足时同样暂停，充值或换连接后可从断点继续。
- 限流、过载、网络中断会自动退避重试；停止任务保留已落盘内容。
- 界面显示的用量与费用按服务商返回计算，价格未知时显示“未知”，实际以账单为准。缓存与计费口径见[架构说明](docs/ARCHITECTURE.md#pi-上下文与缓存费用)。

## 开发

需要 Node.js ≥ 22.19（推荐 24）、npm 和 Python 3；Windows 可用 `WRITER_PYTHON` 指定解释器。

```bash
npm ci
npm run desktop:dev      # 启动开发版
npm run verify           # 架构守卫、导出审计、Python 与 Node 回归
npm run lint
npm run typecheck
npm run test:desktop     # 真实 PI + 本地假模型
npm run test:desktop:ui  # 完整桌面旅程（需显示服务）
npm run desktop:build
```

Linux 下跑 GUI 旅程：先启动 Xvfb，再 `CI=1 DISPLAY=:99 npm run test:desktop:ui`。方法资产用 `npm run assets -- check` 核对，更新后运行 `npm run assets -- manifest`。代码约定见 [AGENTS.md](AGENTS.md) 与[编码指南](docs/CODING-GUIDE.md)。

| 路径 | 职责 |
| --- | --- |
| `apps/desktop` | Electron 主进程、IPC、PI 会话、写作流水线与桌面界面 |
| `packages/core` | 工具执行、门禁、存储、锁、方法方案、流水线记录 |
| `packages/fanqie` | 长篇业务、Python 文风规则与方法资产 |
| `packages/toutiao` | 头条业务、Python 质检与语料方法 |
| `packages/workbench` | 稿纸阅读器、编辑器与路由契约 |
| `packages/ui` | 设计系统、文案、通知与基础组件 |

## 文档

- [当前状态](docs/STATUS.md)：已实现范围、验证情况与边界
- [架构说明](docs/ARCHITECTURE.md)：数据流、上下文与缓存、阶段式写作
- [自动化验收](docs/ACCEPTANCE.md)
- [方法方案](docs/guides/PROFILES.md)、[长篇指南](docs/guides/FANQIE.md)
- [CHANGELOG](CHANGELOG.md)：版本记录
