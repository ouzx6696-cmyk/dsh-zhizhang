# 织章 1.0.1 交接说明

更新：2026-11-09 12:45 HKT。仓库 `ouzx6696-cmyk/dsh-zhizhang`，`master@b926d8c`（CI 全绿）。

计划原文：《织章 1.0.1 优化计划（新版）》，以 `99-路线图与任务单.md` 为准，逐条细节在 `modules/01–06`。计划不在仓库里，交接时请把计划目录一并给接手方。

## 1. 工作约定（维护者已定）

- 中文沟通。
- 完成的任务**直接推 `master`，不开 PR**。提交作者统一为 `ouzx6696-cmyk <ouzx6696-cmyk@users.noreply.github.com>`。
- 每个任务单一个提交，提交说明写条目 ID、做法、与计划的偏差、跑过的命令。
- **未经维护者明确批准，不做以下事情**：调用真实模型（DeepSeek 账户余额很低，且维护者不想充值）、升级 Electron 或 @types（T126）、改规则或词表（T134）、改功能开关的默认值、发版或打 tag。
- 范围红线：不加功能；不改业务阈值（标题 34 字、QA 84 分、两轮打回）；不改 `packages/*/skill/` 下方法资产的原文；不新增运行时依赖；纯重构放到 1.0.2。
- 先读仓库根 `AGENTS.md`。

## 2. 已完成

| 周 | 任务单 | 提交 |
|---|---|---|
| 1 | T103 CI 与供应链 | 6b00b82 |
| 1 | FQ-05 library_import 路径收口 | 61520b0 |
| 1 | T101 渲染层单测通道 | 30a0268 |
| 1 | T102 补测，并修复 UI-08 | 59c1c20 |
| 1 | T113 遗留写锁清理、作品锁接管 | cb05e86 |
| 1 | T110 编辑器 Esc 与关窗保护 | 8122ec6 |
| 1 | 修复 Windows 上暴露的老测试 | 43e876a |
| 2 | T120 结构化停止原因、统一错误分类 | 26bd211 |
| 2 | T121 停滞看门狗、计费用量、取消语义 | 778b968 |
| 2 | T114 恢复与记账、FQ-19、新建任务确认 | 19c68ad |
| 2 | T125 安全收口（CSP、sandbox、只读租约、realpath、门禁、诊断脱敏等） | ce823fe |
| 2 | T111 草稿 | 7efc5a0 |
| 2 | T112 提示分区、ErrorBoundary | c8ab05b |
| 2 | 集成修复：快照跳过目录 | 087df22 |
| 2 | CHANGELOG 第 1–2 周 | c54828a |

本地集成末态的验证结果：
- `npm run verify` 全绿，其中 test:node 共 337 个，336 通过，1 个跳过（Windows 专用）。
- `test:desktop` 110/110。
- GUI 旅程 1 passed。
- 守卫：any=1，非空断言 0，吞错 0。

GitHub CI 结果见第 8 节。

P0 状态：除 **ENG-01（Electron 42 → 45，T126）** 外，11 条已关闭，每条都有修复前失败、修复后通过的测试。

## 3. 剩余任务

### 3.1 计划内，可直接做（不需授权）

| 任务单 | 内容 | 条目 | 备注 |
|---|---|---|---|
| T104 | 守卫加固：吞错规则精确化；core 只依赖 node 标准库 | CORE-09 | 第 1 周漏做，S |
| T115 | 连续性提交写入顺序、fsync 父目录 | FQ-04、FQ-16、CORE-19 | 第 3 周，S |
| T123 | 头条流程：typing 注解、去掉 AI 声明提示词、卡片预检对齐、精修后重跑事实链、GBK 台账报错、传 --article-id 等 | TT-01～05、08a、10、12、23、24、26 | 第 3 周，M。“去掉 AI 声明提示词”这类改动若触及 skill 原文，先请维护者确认 |
| T124 | 阶段卡缓存键 = 方法原文 + 提示词 + 格式 + 规划模型 | DK-06、DK-20 | 第 3 周，S |
| T130 | 定稿快照挪到校验之后；continuity 索引删 excerpt；确定性体积测试 | FQ-01①、FQ-02、FQ-18、FQ-23 | 缓冲周，依赖 T114（已完成） |
| T131 | 候选列表解析缓存 | FQ-06、FQ-21 | 缓冲周，S |
| T132 | 流水线事件：先测量体积和频率再节流；按 updated 丢弃旧状态 | FE-05、FE-06 | 缓冲周，M |
| DK-11 | 任务池遇暂停后停止派发 | DK-11 | 模块文档归在 T121，但路线图的 T121 行没列，这次没做。建议补上 |

### 3.2 需要维护者授权

| 任务单 | 需要的决定 |
|---|---|
| T126 | Electron 42 → 45（退路 44.10.x），@types 和 engines 对齐 Node 24，clipboard 加 await，对话框补 defaultPath，Fuses 只开 NodeOptions、Inspect、OnlyLoadAppFromAsar。AGENTS 规定不改锁定版本，所以需要**书面授权**。这是最后一条未关闭的 P0 |
| T134 | 规则变更 TT-06/07/16/17/18/25。需要授权，升 VERSION，写 CHANGELOG。不授权也可以照常发版 |
| 真实模型实测 | 经济档番茄 1 章、头条 1 篇（发布门槛 5）。需要预算批准 |

### 3.3 发布门槛（打 tag 1.0.1 前全部满足）

1. P0 全部关闭：差 ENG-01（T126）。
2. verify 与 test:desktop 全绿：已满足；每次推送后看 CI。
3. 守卫基线不退化：已满足。
4. **Windows x64 安装包手工回归**：未做。内容包括安装、从 0.9.9 升级、卸载；番茄 1 章和头条 1 篇的全流程；备份与恢复；关窗时有未保存内容的确认弹窗；另外 Alt+F4 和任务栏关闭也要测。沙箱做不了，需要维护者在真机上做。
5. **真实模型实测**：未做，需要预算批准。结果写进 CHANGELOG 的“实测”一节。
6. CHANGELOG：第 1–2 周已写（“1.0.0-preview.1 + 1.0.1 开发中”一节，写明了 WB-02 旧草稿迁移在 1.0.2 删除）。后续任务完成后继续追加。

## 4. 待维护者确认的偏差与存疑

**第 1 周**
- T103：publish job 的超时是 15 分钟，计划写 20 分钟。ENG-04 只做了 scope 的规模警告，没有新增 AGENTS.md 规则和脚本。
- FQ-05：沿用现有错误码 `OUT_OF_ROOT` / `NOT_FOUND`，计划写的是 `outside_root`。
- T113：清锁放在 `recoverWork` 内；额外支持只有锁、没有 journal 的恢复；FQ-11 仍归类 `recovery_invalid`。另一个实例确实在运行时，“接管”按钮也会显示，靠确认文案把关。
- T110：编辑器打开时不会自动聚焦，所以 Esc 由外壳处理。是否改成自动聚焦，等维护者决定。

**第 2 周**
- T120：停止原因存在记录的扁平字段 `reason` 上，没有用 CORE-01 写的 `pause:{reason,detail}`。单独出现的 `ECONNRESET`、`ETIMEDOUT` 现在直接失败、不再重试（交给 pi-ai 判定）。stderr 上限 64 KB 时终止脚本，有人担心对 Python 警告较多的环境偏紧。风险表里的“分类结果写进诊断日志”还没做。
- T114：DK-19 的确认分两条路径：面板在应用内确认；模型工具 `writer_pipeline_start` 和面板状态过期这两种情况，回落到原生对话框 `host.confirm`。是否改成让模型工具直接拒绝，等维护者决定。FQ-19 只放宽了修订影响判断，没有放宽 `changed`。`article.ts` 现在 407 行，守卫会提示超过 400 行，但不算失败。
- T125：
  - **TT-20 改了头条 skill 的脚本** `ledger.py`、`qa_check.py`（台账 CSV 公式前缀转义），并重建了 `assets/manifest.json`。没有改词表和判分，也没升 RULES_VERSION。需要维护者确认这些改动可以留在 T125，而不必归入 T134。
  - 错误码用 `INVALID_ARGS`，计划写的是 `INVALID_INPUT`。
  - 找不到 Python 时提示用环境变量 `WRITER_PYTHON`，因为应用里没有“设置 › Python”页面。
  - 只读检查依据的是内存里的 `state.access`，跨项目请求没有覆盖。
  - 我在 GUI 旅程里发现 Vite 把小字体以 `data:` 形式内联，CSP 已改为 `font-src 'self' data:`。
- T111：
  - 恢复基于旧版本的草稿后，保存会被当作冲突拒绝，作者只能自己复制文字，没有合并或强制覆盖。
  - 头条按文章算“其它作品”，写满清理时同一写作根下的其它文章也会被清。
  - 迁移失败只写在控制台。
- T112：同屏最多 10 条提示，窄窗口下有没有挡住编辑区，还没目视检查过。
- 集成：找不到 Python 的提示文案用了 T125 的写法（“指定解释器路径”）。

## 5. 旧遗留（优先级低）

- `test/desktop/runtime.test.mjs` 里的抽卡并发测试在 Windows 偶发失败，还没修。
- 收益数字没有实测；原典六篇的字句需要作者核对；`timeoutMs` 的作用范围没有验证；额度类词可能把 Google 429 误判。
- Dependabot 的 npm 更新报 `ETARGET`（playwright-core@1.65.0 太新），不影响主线。
- CI 的 desktop-ui 偶尔因为 Electron 下载 504 失败，与代码无关，重跑即可。

## 6. 环境与测试注意事项

- 跑桌面测试要设 `NO_PROXY=127.0.0.1,localhost`。
- **跑 GUI 旅程前必须先 `npm run build -w @writer/desktop`**，否则会用旧的 `out/`，出现假失败。
- GUI 旅程在 Linux 无头环境的跑法：`Xvfb :99 &`，然后 `CI=1 DISPLAY=:99 NO_PROXY=127.0.0.1,localhost npm run test:desktop:ui`。需要 libgtk-3。
- 并行开多个 worktree 时，不要各自 `npm ci`（会内存不足，exit 137）。用 `cp -al` 硬链接 `node_modules`。
- 全量验证命令：`npm run verify`、`NO_PROXY=127.0.0.1,localhost npm run test:desktop`，再 build，再跑 GUI 旅程。
- 架构守卫会核对版本号：CHANGELOG 第一个 `## ` 标题的首个词必须等于 package.json 的版本（现在是 1.0.0-preview.1）。发版时三处版本号和标题一起改成 1.0.1。
- PI 不走环境代理，沙箱里调真实模型要用本地中继。前提是维护者已批准真实模型调用。

## 7. 建议的下一步顺序

1. 确认 c54828a 的 CI 全绿。
2. 做 T104、T115、T124、DK-11（小而独立，可以并行）。
3. 做 T123。动到 skill 原文前先问维护者。
4. 做 T130–T132。
5. 拿到授权后做 T126（Electron 45），之后由维护者完成 Windows 手工回归。
6. 拿到预算后做真实模型实测，结果写进 CHANGELOG。
7. 维护者把第 4 节的存疑项逐条拍板，确认发布门槛全部满足后，再打 tag 1.0.1。

## 8. CI 记录

- 43e876a（第 1 周末）：scope、test、desktop-ui 全部 success。
- c54828a：CHANGELOG 标题写成 1.0.1，被版本号守卫拦下；404c19c 改为“1.0.0-preview.1 + 1.0.1 开发中”。
- 推送 Windows 后又暴露两处只在 Windows 上失败的测试，已修（都是测试问题，不是产品代码）：
  - d2a00ad：`rootIdentity` 大小写断言只在非 Windows 上做。
  - 896359c：“思考超过 150 秒不被中止”用例在 Windows 粗粒度计时器下推进的模拟时间不够，改为每步推进 2.5 秒。
  - b926d8c：GUI 旅程里推算流水线目录键时，按 core 的 `rootIdentity` 规则处理（Windows 下小写、正斜杠）。
- **b926d8c：scope、test、desktop-ui（Windows）全部 success。**
- 注意：CI 对只改 `docs/**` 和 `*.md` 的推送不触发，需要时用 workflow_dispatch 手动跑 ci.yml。
- 沙箱提示：本会话末尾沙箱里的 GTK 库丢了（没有 root，装不回去），本地 GUI 旅程起不来；最后一处 GUI 修复只经 Windows CI 验证。换环境后先装 libgtk-3-0、libatk1.0-0、libnss3、libgbm1。
