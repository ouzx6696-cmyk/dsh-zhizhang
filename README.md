# writer-agent · 写作 Agent

基于内置 PI 的独立桌面写作客户端，支持今日头条和番茄长篇网文。本次构建版本为 **0.9.3-rc.1**，尚未作为稳定版本发布。

客户端将规划、写作、候选对照、独立编辑、作者确认和作品存储连在同一工作区。原版、默认及用户方法方案均可使用；旧作品继续兼容。

## 使用

Windows 提供安装器和免安装 ZIP，随包携带 Python。设置模型连接与统一写作根后即可开始创作，详见[桌面说明](docs/DESKTOP.md)。正式发布以 [GitHub Releases](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases) 为准；候选构建从 Actions 的 `writer-windows-packages` 下载。

当前候选版的实现、验证与限制见[构建说明](docs/0.9.3-rc.1-IMPLEMENTATION.md)，真实模型文学质量和 Windows 实机安装/更新不能仅凭构建成功判定通过。

## 开发与验证

源码开发需要 Node.js ≥22（推荐 24）和 Python ≥3.8；Python 规则只依赖标准库。

```bash
npm ci
npm run desktop:dev       # 本地桌面开发
npm run verify            # 核心：架构、规则、业务与资产
npm run verify:desktop    # 桌面：类型、构建、PI 与少量 GUI 场景
npm run verify:release    # Windows：验证并生成候选交付包
```

修改期间运行受影响的检查，通过且相关输入未变就复用结果。真实模型使用现有 `acceptance:run`，按验收阶段运行。无需为日常修改反复执行整套发行流程。

## 框架与当前工作

- [架构](docs/ARCHITECTURE.md)：桌面调用链、共享业务、事实归属与存储边界。
- [当前状态](docs/STATUS.md)、[效率重构实施记录](docs/NEXT-ITERATION-IMPLEMENTATION.md)：实际完成项和证据。
- [迭代要求与验收条件](docs/NEXT-ITERATION-PLAN.md)、[0.9.3 验收报告](docs/0.9.3-ACCEPTANCE-REPORT.md)。
- [方法方案](docs/PROFILES.md)、[方法资产与更新](docs/ASSETS.md)、[长篇业务](docs/FANQIE.md)。

业务与存储位于 `packages/core`、`packages/fanqie`、`packages/toutiao`，共享界面在 `packages/workbench`，自有客户端在 `apps/desktop`。保留现有包和作品格式，不建立第二份作品事实库。

## 存量兼容

既有 DSH 插件复用相同业务与方法，使用见[安装说明](docs/INSTALL.md)及[DSH 接口](docs/DSH.md)。它承担存量兼容，不驱动其他 Agent 工具适配。
