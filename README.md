# 写作 Agent

**0.9.8**：基于内置 PI SDK 的独立 Electron 写作客户端，面向中文长篇小说与今日头条创作。作品保存在本地；模型协助规划、写作和独立审读，作者决定采纳、定稿及交稿。

## 使用

1. 配置模型接口、模型 ID 和 Key，点击“测试连接”。支持 DeepSeek、Kimi、通义千问、智谱及 OpenAI / Anthropic 兼容接口，具体权限以服务商为准。
2. 选择写作根，新建长篇或头条文章；写手、编辑和规划可分别配置模型。
3. 在稿纸中阅读和修改，在右栏查看任务、审读与方法方案；核对后确认采纳或定稿。
4. 导出 TXT、DOCX 或复制正文。应用不登录或自动发布到平台。

写作根包含 `novels/`、`toutiao/` 和 `.writer/`。设置可打开既有目录、备份与检查未完成写入。停止任务保留已落盘内容。模型请求会把相关创作内容发送至配置的服务商。

## 0.9.8 改进

- 退役 DSH 适配，保留独立桌面入口；DSH 插件形态最后版本为 v0.9.7。
- 损坏索引、稿件和资料明确报错；原子写、路径约束、合作锁与八类恢复日志集中维护，作者确认绑定实际版本。
- 主会话持久化并复用提示前缀，PI 管理自动压缩与 streaming 缓存保温；诊断记录普通输入、输出、缓存读写 token 和估算费用。
- 统一 IPC 参数解析、设置与会话迁移、共享状态/文案/Dialog/Steps；组件样式按职责归属。
- 头条 QA 进程内调用，标题上限与规则版本从 Python 加载；长篇文风规则统一由 Python 扫描，保留 UTF-16 原文坐标。

缓存命中受服务商、代理支持和 TTL 影响，压缩或更改前缀可能触发新缓存写入；未知价格不视为免费，实际费用以账单为准。设计与观测口径见[架构说明](docs/ARCHITECTURE.md#pi-上下文与缓存费用)。

## 开发

需要 Node.js ≥22.19（推荐 24）、npm 和 Python 3；Windows 可用 `WRITER_PYTHON` 指定解释器。

```bash
npm ci
npm run desktop:dev
npm run verify          # 架构守卫、导出审计、Python 与 Node 回归
npm run lint
npm run desktop:build
npm run test:desktop    # 真实 PI + 本地假模型
npm run test:desktop:ui # Playwright 驱动 Electron，需要显示服务
```

Linux GUI 测试可使用 `CI=1 DISPLAY=:99 npm run test:desktop:ui`，需先启动 Xvfb。方法资产通过 `npm run assets -- check` 核对；主动更新资产后运行 `npm run assets -- manifest`。

| 路径 | 职责 |
| --- | --- |
| `apps/desktop` | Electron、IPC、PI 会话和桌面界面 |
| `packages/core` | 工具执行、门禁、存储基础、锁、方法方案 |
| `packages/fanqie`、`packages/toutiao` | 长篇与头条业务、Python 规则和方法资产 |
| `packages/workbench`、`packages/ui` | 路由契约、共享写作区和设计系统 |

## 构建与下载

0.9.8 已从提交 `6198356` 在 Linux 交叉构建 Windows x64 免安装 ZIP，压缩包完整性、实际依赖版本及随包 Python/规则桥接经检查通过。NSIS 安装器受当前容器的 32 位 WoW64 崩溃阻塞，未作为成品交付；Windows 原生 CI、实机安装和更新仍待验证。本版尚未公开发布。既有公开版本见 [Releases](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases)；不要把旧版附件当作本版。

Windows 原生构建 `npm run verify:release`，或先 `npm run desktop:build`，再执行桌面 workspace 的 `pack`（NSIS）和 `pack:portable`（ZIP）。产物含固定版本且校验过的 Windows CPython、字体和许可证；未配置证书时为未签名包。CI 会整理源码与 SHA-256 清单。平台与已执行验证见[当前状态](docs/STATUS.md)。

真实模型质量、实际缓存费用、Windows 实机安装和跨版本更新需要对应条件验证，流程见[真实模型验收](docs/ACCEPTANCE.md)。

[桌面使用](docs/guides/DESKTOP.md) · [架构](docs/ARCHITECTURE.md) · [变更记录](CHANGELOG.md) · [方法方案](docs/guides/PROFILES.md) · [资产维护](docs/guides/ASSETS.md)
