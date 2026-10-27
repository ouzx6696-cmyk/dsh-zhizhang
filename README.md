# 织章 · dsh-zhizhang

**0.18.0** · DeepSeek Harness 的长篇创作工程插件。

围绕一部作品维护作者目标、参考依据、现行规划、工作稿、审读与定稿。AI 提交创作内容，代码负责版本、文件、授权范围与恢复；插件不内置模型调用。

## 按最终产物进入

| 需求 | 路径 |
| --- | --- |
| 研究指定片段 | `reference_analyze` 准备分析或保存报告与迁移包，默认不入公共库 |
| 完整拆书与正式入库 | `library_import → plan → dissect → facts/structure → card_stage → card_accept`；Full 须确认 |
| 发展作品 | `inspire_start → forge_brief → stage → accept(apply=true)`；参考卡和工作区迁移包均可选 |
| 正文写作 | `chapter_brief → 创作与回读 → candidate_stage → candidate_accept`；采纳自动扫描，深度编辑可选 |
| 作者定稿 | 读章取得 `revision`，声明当前版本审读，再按授权定稿 |
| 修订 | 核基线、保留历史、应用候选、核相关接续；不自动改后文 |

采纳工作稿不等于定稿。工作稿可供下一章条件接续，只有定稿进入定稿接续索引。旧 `happened` 保留为作者材料，不被自动改写。

## 启用与开发

宿主默认只挂 `zhizhang_enable`；调用后工具与必要规则按 Agent 作用域加载。面板常驻，负责阅读、比较、采纳、审读声明和定稿。工具数量由启用回执报告。

```bash
npm ci
npm run check
```

源码仓库要求 Node ≥22。`check` 执行静态护栏、架构依赖检查、构建与四文件测试。发行入口和客户端位于 tracked `dist/`，没有另一套烟测或长流程脚本。

安装与 DSH 配置见 [DSH_INSTALL.md](docs/DSH_INSTALL.md)。支持独立作品根、共享拆书库和源书目录。多草稿默认关闭。

## 数据与恢复

默认保存至会话目录 `.zhizhang/`；`working_dir`、`storageRoot` 或环境配置可指定其他位置。正文修订保留 `revisions/<章>/<原始字节hash>.md`，只有一份现行章节。

作品操作中断用 `zhizhang_status(recovery=inspect|resume)`；公共库用 `zhizhang_library_list`；灵感应用用 `zhizhang_inspire_status`。先核遗留锁与实际写入者，不重复套用操作。离线备份见 [DATA.md](docs/DATA.md)。

HTTP 同时验证可信 Host 与显式 Origin。配置 `panelToken` 后，本机和 LAN 都需令牌；可在织章设置卡输入，仅保留本次浏览器会话。

## 项目文档

| 文档 | 用途 |
| --- | --- |
| [COGNITION.md](docs/COGNITION.md) | 产品目标、信息身份与作品生命周期 |
| [OPTIMIZATION_PLAN.md](docs/OPTIMIZATION_PLAN.md) | 结合技能套件 1.3.0 的整体方案 |
| [IMPLEMENTATION.md](docs/IMPLEMENTATION.md) | 实际实施结果、统一审查与边界 |
| [ARCHITECTURE.md](docs/ARCHITECTURE.md) | 模块职责与依赖方向 |
| [MAP.md](docs/MAP.md) / [PILLARS.md](docs/PILLARS.md) | 任务路径与阶段交接 |
| [DATA.md](docs/DATA.md) / [PANEL.md](docs/PANEL.md) | 文件、版本、恢复与作者面板 |
| [QUALITY.md](docs/QUALITY.md) / [TEST.md](docs/TEST.md) | 创作方法与工程验证的边界 |
| [TOOLS.md](docs/TOOLS.md) / [PORTS.md](docs/PORTS.md) | 运行时接口与业务契约 |
| [STATUS.md](docs/STATUS.md) | 当前版本快照 |
| [ASSESSMENT.md](docs/ASSESSMENT.md) / [REVIEW.md](docs/REVIEW.md) | 重构前的评估证据与历史梳理 |
