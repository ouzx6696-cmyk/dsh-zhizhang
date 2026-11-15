# 更新日志

## Unreleased

- 增强 `scripts/guard.mjs`：`G-exports` 导出校验、`G-copy` 文案与业务常量守卫、桌面 `main/` 裸错误基线检查与 `as` 断言上限控制；移除旧 `scripts/architecture-guard.mjs`。
- 精简 `.github/workflows/ci.yml`：移除 `scope`/`ci-run.mjs`/`test:platform`，接入 `check`、`test`、`e2e` 与 `Zhizhang` 打包流程。
- 统一 `scripts/check-desktop-package.mjs` 为 `Zhizhang.exe` 与 `zhizhangBridge` 契约，补充核心单元行为测试与 8 份核心文档。

## 1.3.0

- **交付收尾**：修复助手路径越界、候选采纳与定稿状态、同目标运行竞争、失败回答费用漏记和预算预占释放；恢复阶段直接复用已验收输出。
- **正文与资料一致性**：章节加载前文、卷规划及绑定参考卡；头条编辑修订后重核事实，台账失败时保留可重试的文章状态，交稿文件与元数据经写入意图提交。
- **环境与构建**：租约获取/接管/释放共用写锁，切换工作区前停止旧任务；修复 Windows 构建顺序和发行验证命令；测试转换器收敛到已有 esbuild，仅增加一条必要回归用例。

- **品牌与包结构统一**：全仓更名为 `zhizhang`（`app.zhizhang.desktop`、`Zhizhang.exe`、`~/.zhizhang`、`.zhizhang/`），所有内部包登记为 npm workspace `@zhizhang/{core,fanqie,toutiao,workbench,ui,desktop}`。因 `appId` 变更，1.1.1 用户需手动安装新版本。
- **全新磁盘格式（`zhizhang/1.3`）**：移除 `meta.json` 单点热点与 1.x 旧数据/设置兼容分支；确立设定集 `bible/` 为唯一连续性真源；本地草稿迁移至写作文件夹 `.zhizhang/drafts/`。
- **精简与架构收敛**：删除自由写手模式、7 个冗余实验开关及 23 份过期文档；`@zhizhang/core` 收敛为 errors / schema / fs / lock / journal / tool / pipeline / model / methods / python 模块；统一 `AppError` 码表、`ModelGateway` 全局并发/金额预算闸与 `LockService` 三锁合一机制。
- **写作内核升级**：番茄长篇实现纯文本起稿、审读引文逐条容错、初选逐稿独立打分、确定性 `stage-map.json` 阶段取用与段落级 diff 个人规则学习；头条图文修正修订阶段使用 `s5-editing`、实现增量事实链复核并将 `PASS_SCORE = 84` 收口至 `rules.py`。
- **界面与设计系统**：建立 `--zz-*` 三层设计令牌与四色语义分离；流水线面板改为右栏停靠并支持与助手分屏；新增专注模式与强类型 `WorkbenchCommandMap` / `DesktopEvent` 契约。

## 1.1.1

- 确立阶段隔离流水线、可恢复 journal、引文逐字定位、换位读者比较与头条 4.0.0 规则门禁基础能力。
- 完善桌面端离线备份（utility process）、Electron Fuse 安全加固与 Windows 安装包冒烟验证链路。

## 0.x（早期原型）

- 完成桌面端基础壳、番茄与头条双模式初版工作流、Python 质检桥接脚本与本地存储原型。
