# 当前状态：0.9.5

2026-11-02（香港时间）。自有桌面客户端与内置 PI 是当前开发主线；DSH 仅保留存量兼容，不新增其他 Agent 工具适配。

## 当前交付

- 实现提交：[`abf7204`](https://github.com/ouzx6696-cmyk/dsh-zhizhang/commit/abf7204d219013cadb6a980847d9273ae342585f)。
- [Windows 构建 41338948556](https://github.com/ouzx6696-cmyk/dsh-zhizhang/actions/runs/41338948556)全部通过，产出 NSIS 安装器、免安装 ZIP、源码及 SHA-256 清单。
- 实际打包客户端启动、随包 Python、版本及更新清单检查通过；下载后 10 个文件的 SHA-256 校验通过。
- 安装器约 164 MB，ZIP 约 208 MB。未配置签名证书，状态为 NotSigned；没有发布 GitHub 正式 Release。

## 本轮结果

作品切换串行提交；损坏文章、方案与会话读取错误可见；默认模板退出诊断依据；角色提示匹配工具；内部工具异常直接传播；编辑离开策略、任务刷新及 Windows 打包准备收敛。详细记录见[0.9.5 实施及验收](history/0.9.5-IMPLEMENTATION.md)。

核心 Node 96 项、Python 规则 215 项、桌面会话 10 项和 GUI 6 个场景通过；严格类型与架构守卫通过。ESLint 无错误，Hook 依赖警告继续按实际 lint 输出记录。本地截图受安全存储横幅影响，未覆盖视觉基准；CI 按既有策略验证布局与交互。

## 仍需实际条件验收

真实模型文学质量、作者评分与人工视觉验收、Windows 实机安装和跨版本自动更新尚未完成。不能用假模型、结构检查或打包成功替代这些结论。真实模型流程见[验收说明](ACCEPTANCE.md)。

[桌面使用](guides/DESKTOP.md) · [架构](ARCHITECTURE.md) · [0.9.3 实施历史](history/0.9.3-IMPLEMENTATION.md) · [效率重构历史](history/NEXT-ITERATION-IMPLEMENTATION.md)
