# 当前状态：0.9.7 已构建；公开正式发行仍为 0.9.5

2026-11-02（香港时间）。自有桌面客户端与内置 PI 是当前开发主线；DSH 仅保留存量兼容，不新增其他 Agent 工具适配。

## 0.9.7 源码与发行包

已合并 LAMP-REDESIGN 与 FRONTEND-PLAN，完成夜灯／晨光主题、统一排版与组件、全书仪表盘、头条五步与台账、方法阅读和对照、精简设置与引导、非遮挡提示及开发预览。全量梳理后集中校验通过：Node 97、Python 215、PI 运行时 12、GUI 6 个场景；类型、生产构建与架构守卫通过。

源码与 `v0.9.7` 标签为 [`4612283`](https://github.com/ouzx6696-cmyk/dsh-zhizhang/commit/46122837a8c68d7061a29bee172f529a2216e457)。[Windows 原生构建 41414229424](https://github.com/ouzx6696-cmyk/dsh-zhizhang/actions/runs/41414229424) 全部通过，NSIS／ZIP、实际打包客户端启动及随包 Python 核对通过，下载后 10 项 SHA-256 与更新清单匹配。安装包未签名，约 163.2 MiB；免安装包约 205.8 MiB。

下载 [Windows 发行包与源码](https://github.com/ouzx6696-cmyk/dsh-zhizhang/actions/runs/41414229424/artifacts/13127123157)，[0.9.7 发行草稿](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases) 记录构建及下载入口，尚未公开发布。Release 直传附件受当前认证限制，未新增持久化写权限工作流。完整检查、截图位置和实际限制见 [0.9.7 实施与发行构建验收](history/0.9.7-IMPLEMENTATION.md)。

## 0.9.6 已同步源码

已完成作品与任务范围、文章独立会话、PI 配置来源、模型设置复用、版本条件和上手交互修改，源码已同步 GitHub [`8fccd45`](https://github.com/ouzx6696-cmyk/dsh-zhizhang/commit/8fccd456a44a156de9f709b347ac45e83689fcdf)。检查与实际条件限制见 [0.9.6 实施及验收](history/0.9.6-IMPLEMENTATION.md)。该版本没有另行正式发布。

## 已正式交付的 0.9.5

- 实现提交：[`abf7204`](https://github.com/ouzx6696-cmyk/dsh-zhizhang/commit/abf7204d219013cadb6a980847d9273ae342585f)。
- [正式发布构建 41365336677](https://github.com/ouzx6696-cmyk/dsh-zhizhang/actions/runs/41365336677)全部通过，产出 NSIS 安装器、免安装 ZIP、源码及 SHA-256 清单。
- 实际打包客户端启动、随包 Python、版本及更新清单检查通过；下载后 10 个文件的 SHA-256 校验通过。
- 安装器约 164 MB，ZIP 约 208 MB。未配置签名证书，状态为 NotSigned；已发布 [v0.9.5](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases/tag/v0.9.5)，并标记为 Latest。

## 0.9.5 交付记录

作品切换串行提交；损坏文章、方案与会话读取错误可见；默认模板退出诊断依据；角色提示匹配工具；内部工具异常直接传播；编辑离开策略、任务刷新及 Windows 打包准备收敛。详细记录见[0.9.5 实施及验收](history/0.9.5-IMPLEMENTATION.md)。

核心 Node 96 项、Python 规则 215 项、桌面会话 10 项和 GUI 6 个场景通过；严格类型与架构守卫通过。ESLint 无错误，Hook 依赖警告继续按实际 lint 输出记录。本地截图受安全存储横幅影响，未覆盖视觉基准；CI 按既有策略验证布局与交互。

## 仍需实际条件验收

真实模型文学质量、作者评分与人工视觉验收、Windows 实机安装和跨版本自动更新尚未完成。不能用假模型、结构检查或打包成功替代这些结论。真实模型流程见[验收说明](ACCEPTANCE.md)。

[桌面使用](guides/DESKTOP.md) · [架构](ARCHITECTURE.md) · [0.9.3 实施历史](history/0.9.3-IMPLEMENTATION.md) · [效率重构历史](history/NEXT-ITERATION-IMPLEMENTATION.md)

正式发布标签指向 `ebfa2e8cfce9afc4680223b10eb5cfa96117941d`（包含实现后的文档收尾）；实现代码与上述 abf7204 一致。公开附件 11 项，SHA256SUMS 的 10 项与 GitHub 文件摘要全部匹配。
