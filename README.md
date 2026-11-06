# 写作 Agent

**当前源码为 0.9.9-rc.1 候选版，尚未发布。** 最近正式版为下方下载区的 0.9.8。

基于内置 PI SDK 的独立 Electron 写作客户端，面向中文长篇小说与今日头条创作。作品保存在本地；模型协助规划、写作和独立审读，作者决定采纳、定稿及交稿。

## 使用

1. 配置模型接口、模型 ID 和 Key，点击“测试连接”。支持 DeepSeek、Kimi、通义千问、智谱及 OpenAI / Anthropic 兼容接口，具体权限以服务商为准。
2. 选择写作根，新建长篇或头条文章；写手、编辑和规划可分别配置模型。
3. 在稿纸中阅读和修改，在右栏查看任务、审读与方法方案；核对后确认采纳或定稿。
4. 导出 TXT、DOCX 或复制正文。应用不登录或自动发布到平台。

写作根包含 `novels/`、`toutiao/` 和 `.writer/`。设置可打开既有目录、备份与检查未完成写入。停止任务保留已落盘内容。模型请求会把相关创作内容发送至配置的服务商。

## 0.9.9-rc.1 性能与前后端梳理优化

- **后端 I/O 与缓存加速**：`atomicWrite` 复用父目录安全校验结果，省去已存在目录的冗余 `mkdir` 与二次祖先链 `lstat`；`readJsonlCached` 缓存解析后的 JSONL 行并在命中时浅拷贝返回；长篇面板快照、拆书库、灵感候选、章节修订统计、项目与作品扫描、头条多根文章列举、方法方案加载以及桌面 `projects` IPC 全面改为批量受控并发（`Promise.all`），路由匹配改用 `Set` 常数查找。
- **前端渲染与交互打磨**：`Markdown` 组件提升插件常量并接入 `React.memo`；`AgentPanel` 拆出独立 `AgentMessages` 并缓存候选编号与快捷动作，输入草稿不再触发历史消息列表重渲染；`SourceEditor` 字数统计消除逐字符数组分配；桌面顶栏项目切换菜单补齐点击外部与 `Escape` 关闭及无障碍菜单属性。
- **架构整洁与零守卫失败**：拆分全部超长组件/Hook（`AgentPanel`、`useDesktopController`、`useFanqie`、`ToutiaoApp`、`Profiles`）与超长样式表（`shell.css`、`base.css` 等），清理 `tokens.css`、`ledger.css`、`reader.css`、`profiles.css` 重复覆盖规则；`any` 从 100 降至 1、非空断言清零，架构守卫 0 失败（余 2 条超行提示）。

## 0.9.9 开发版功能

- 设置 → 资源：选择 Exa，填自己的 Key，默认轻量模式；测试连接会产生一次真实搜索，可能计费。旧 Tavily Key 仍按 Tavily 使用。单任务默认最多两次搜索、两次来源读取；检索摘要不等于已核实出处。
- Agent 区点击“上下文”：查看当前占用、最近请求、任务和主会话累计输入／输出／缓存，以及本次实际加载的方法。未知价格显示未知，实际费用以服务商账单为准。
- 面板可保存自动压缩开关、触发比例、有效上下文预算（0 为按模型窗口）和近期保留量。默认目标为 80%，同时预留输出空间；小窗口自动收缩近期保留量。
- 空闲时可“压缩当前会话”，填写重点保留内容，也可取消。压缩调用模型并可能改变缓存前缀；原始历史保留，压缩后占用等待新响应校准。
- 修复作者素材出处、原版方法短 ID、无文章投递提示与输出截断状态；补充原生窗口尺寸变化的回归。

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
npm run test:desktop:ui # 单条完整桌面旅程，9 个步骤，需要显示服务
```

Linux GUI 测试可使用 `CI=1 DISPLAY=:99 npm run test:desktop:ui`，需先启动 Xvfb。方法资产通过 `npm run assets -- check` 核对；主动更新资产后运行 `npm run assets -- manifest`。

| 路径 | 职责 |
| --- | --- |
| `apps/desktop` | Electron、IPC、PI 会话和桌面界面 |
| `packages/core` | 工具执行、门禁、存储基础、锁、方法方案 |
| `packages/fanqie`、`packages/toutiao` | 长篇与头条业务、Python 规则和方法资产 |
| `packages/workbench`、`packages/ui` | 路由契约、共享写作区和设计系统 |

## 构建与下载

**0.9.8 已正式发布**，发行提交为 `6ac4e13`，已通过 [Windows 原生构建与发布检查](https://github.com/ouzx6696-cmyk/dsh-zhizhang/actions/runs/41874988698)。

| 文件 | 适用场景 |
| --- | --- |
| [WriterAgent-Setup-0.9.8.exe](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases/download/v0.9.8/WriterAgent-Setup-0.9.8.exe) | Windows x64 安装包（含内置 Python，支持后续通过 GitHub Releases 自动更新） |
| [WriterAgent-Portable-0.9.8-x64.zip](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases/download/v0.9.8/WriterAgent-Portable-0.9.8-x64.zip) | Windows x64 免安装便携包（解压即用） |
| [SHA256SUMS.txt](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases/download/v0.9.8/SHA256SUMS.txt) | 发行包 SHA-256 校验值 |

> **未签名说明**：当前发行包尚未使用 Windows 代码签名证书签名，首次运行可能弹出 SmartScreen 提示，核对 `SHA256SUMS.txt` 后可选择“更多信息 → 仍要运行”。

完整状态、已验证范围与待验收项见 [当前状态](docs/STATUS.md)，架构细节见 [架构说明](docs/ARCHITECTURE.md)，版本记录见 [CHANGELOG](CHANGELOG.md)。
