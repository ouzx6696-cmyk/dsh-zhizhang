# 真实模型验收

验收回答实际稿件是否可用，与假模型工具测试分开。目前尚未执行：需要可用模型连接、至少两个真实新闻链接，以及作者评分。没有这些条件时不得宣布默认方案优于原版。2026-11-07 作者决定 RC3 收尾跳过本验收体系：基线与 A/B 未执行，发布判定不以未执行的评测为依据。脚本支持 `--ab`（小样本轨：三体裁头条各一篇 + 3 章长篇）与 `--v2`（交接 v2 开关）做单变量两臂对比，日后执行时使用。

## 执行

```sh
npm run acceptance:prepare -- --output /path/to/acceptance
# 编辑 acceptance-config.example.json：模型、apiKeyEnv、newsUrls、题材
# 在运行环境配置所引用的 Key 环境变量，不把 Key 写进配置或提交仓库
npm run acceptance:run -- --config /path/to/acceptance/acceptance-config.example.json --output /path/to/acceptance
```

输出目录必须是新的验收目录，已有任务不混入另一次运行。也可手动触发 real-model-acceptance 工作流（需配置 WRITER_ACCEPTANCE_KEY secret，输入两个新闻链接组成的 JSON 数组）。真实调用会产生服务商费用。

默认与原版各跑：资讯长图文 3 篇、故事长图文 2 篇、微头条 2 篇；从一句话开书并规划前十章，逐章写作与独立编辑，第六章前开新对话。脚本拒绝代作者定稿和标记已交稿。

作品、质检、审读及 Pi 会话保留在输出目录。run-records.json 以 head-1…head-7、novel-plan、novel-c001…novel-c010 标识每套方案的 18 项任务，记录对应文章 ID／版本或作品／章节，以及实际耗时、token 和可取得的费用。只有指定产物实际存在才记录任务完成。未配置模型价格时费用是 null，作者按服务商账单填写 actualCost 与币种，不记作免费。失败记录保留，进程中断或任务文字声称完成都不等于质量过线。

## 汇总和作者判断

在 subjective-scores.json 为每篇文章、每章长篇填写可读性与像人写程度（1～5），记录十章内连续性错误数、第六章新对话后是否无需补充设定、实际费用。填写后只重新汇总，不再次调用模型：

```sh
node scripts/acceptance.mjs --summarize --output /path/to/acceptance
```

metrics.json 和 COMPARISON.md 按任务记录读取实际产物：核对 7 篇文章的类别、当前稿件与立项卡质检，以及同一本书的十章章纲和正文。审读回报必须来自独立编辑、完整回读且正文指纹仍有效；缺稿、过期回报、重复任务和类别错误写入 issues，不能计为有效通过。分母固定为约定的 7 篇／10 章。评分表同样按任务 ID 对应，重复评分不能补足缺项。建议线按计划：头条首次质检过线率 ≥60%，两次内 ≥90%；编辑通过率 ≥70%，硬伤均值 ≤1；十章连续性错误 ≤2；新对话可直接接续；默认主观均分不低于原版。质检过线同时要求 ≥84、零 fail、无硬闸。

脚本汇总不是最终审稿：作者仍须抽查人名、时间与已发生事实、回报是否对应实际当前稿，判断定价和费用，并作最终决定。未填人工项或未跑全，不视为验收通过。仅在真实比较指出某份方法存在具体问题后修改那一份；本轮不整体改写方法论。


## 开发回归入口

`npm run verify` 覆盖架构边界、Python 和业务回归；`npm run test:desktop` 覆盖真实 PI 与本地模拟接口；`npm run test:desktop:ui` 是一条含九个步骤的桌面旅程，复用同一客户端并在失败处停止。改动后运行相关入口，不为同一行为复制多组脚本。模拟测试不调用付费服务。

界面验收包含 650／700px 高度下展开上下文时输入区可见、窗口原生尺寸变化、压缩后继续发送和搜索 Key 清除。Windows 原生最大化／全屏分支仅在 Windows 执行，Linux 结果不替代该验收。

## W7 手工验收步骤：Windows 安装与跨版本更新

以下步骤尚未执行过；产物路径以 `apps/desktop/electron-builder.yml` 与 `.github/workflows/ci.yml` 实际配置为准。

### 产物与来源

- 本地打包：`npm run desktop:pack`（NSIS 安装包）、`npm run desktop:portable`（免安装 ZIP），两者都先执行 `desktop:build`；发行前一键核对可用 `npm run verify:release`（串 verify、verify:desktop 与打包，仅 Windows）。产物在 `apps/desktop/release/`：`WriterAgent-<version>-win-x64.exe`、`WriterAgent-<version>-win-x64.zip`、`*.blockmap`、`latest.yml`。
- CI（ci.yml windows-latest 打包步骤）另产出 `RELEASE-CONDITIONS.json`（版本、commit、签名状态、realModelAcceptance）与 `SHA256SUMS`，汇总为 artifact `writer-windows-packages`；发布由 release.yml 走 ci.yml verify 后 publish 到 GitHub Releases。
- 未配置签名证书时安装包不签名，SmartScreen 提示属预期；`RELEASE-CONDITIONS.json` 的 `signing` 字段记录实际状态。

### 安装验收（NSIS）

1. 核对 `SHA256SUMS` 与安装包一致；`latest.yml` 的 `version` 与文件名版本一致（CI 已校验，手工复核一次）。
2. 运行 exe：assisted 安装器，默认装到 `%LOCALAPPDATA%\Programs\写作 Agent`，可更改目录。
3. 首次启动完成引导：模型连接、选择写作根、新建作品；写入一篇验证随包 Python（`resources/python`）与技能资源（`resources/writer`）可用。
4. 免安装 ZIP 解压到独立目录运行 `WriterAgent.exe`，重复上一步冒烟（CI 已校验 zip 内含 WriterAgent.exe、resources/app.asar、resources/python/python.exe、resources/writer/scripts/writer-backup.mjs）。

### 跨版本更新验收

1. 先安装上一正式版并完成：模型配置与 API Key、业务配置、偏好、方法方案、选择一个含作品的写作根。
2. 升级到新版：直接覆盖安装，或应用内检查更新 → 下载 → 安装并重启（electron-updater，GitHub 源，读 `latest.yml`）。
3. 更新后核对 userData（`%APPDATA%\写作 Agent`）保留：
   - `model.json`：模型与 Key 仍可用（safeStorage 加密须同一 Windows 用户），「测试连接」通过；
   - `desktop.json`、`search.json`、`writer.json`：界面偏好、搜索配置、业务配置仍在；
   - `profiles/`：方法方案仍在；
   - `target.json`：最近项目自动恢复，写作根内作品与台账原样可读写；偏好文件（写作根 `.writer/preferences.md`）仍加载。
4. 版本核对：设置内版本号与 `RELEASE-CONDITIONS.json` 一致。

### 卸载与残留检查

1. 卸载配置为 `deleteAppDataOnUninstall: false`：userData 保留（模型 Key、方法方案），重装后配置仍在属预期；彻底清除须手动删除 userData 目录。
2. 核对安装目录、开始菜单与桌面快捷方式、注册表卸载项已移除；写作根内作品文件不受安装与卸载影响。
3. 崩溃残留自愈：在写作根手工创建空目录 `.writer-workspace-claim`（或带死 pid 登记 `owner.json` 的目录）后启动新版，登记应被自动清理并在诊断日志（userData `logs/`）写一条 `workspace_claim_cleaned`；持有进程仍存活时启动应照常报占用而不是清理。遗留的 `.writer-workspace-lock.json` 在持有进程结束后可正常重取。
