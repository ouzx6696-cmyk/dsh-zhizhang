# 织章（dsh-zhizhang）v1.2 重构计划深度评估报告

> **评估对象**：`v1.2-comprehensive-refactoring-plan.md`
>
> **对照基线**：仓库源码、`docs/REMAINING-WORK-PLAN.md`、`docs/STATUS.md`、`AGENTS.md`
>
> **评估结论**：原 v1.2 计划对现状痛点（锁与只读边界、IPC 错码丢失、`fanqie` 膨胀、测试 4 轮重复编译）的诊断**准确度极高**，但在具体落地方案上存在 **5 个隐藏技术深坑（含 1 个状态机自锁死 Bug 和 1 个打包断链风险）**、**2 项违背项目红线的过度优化**，以及 **全仓大爆炸并发重构的进度失控风险**。建议按本文修正后再启动实施。

## 一、核心设计深坑与逻辑缺陷（必须修正）

### 1.1 【致命逻辑坑】`chapterRevision` 若纳入 `status`，将导致审读与定稿自锁死

* **原方案缺陷**：计划第 2.1(5) 节与 Phase 1 提出「修正 `chapterRevision` 纳入 `title` 与 `status`」。

* **深层冲突**：在 `packages/fanqie/src/engine/storage/chapters.ts` 中，`review.revision` 绑定于 `chapterRevision`，而定稿（`reviewed → final`）要求当前正文具备匹配的 `review.revision`。一旦把 `status` 编入 `chapterRevision`：

  1. 当系统或作者将章节状态从 `drafted` 变更为 `reviewed` 或 `final` 时，`status` 变化会立即导致 `chapterRevision` 改变；

  2. 刚写入的 `review.revision` 瞬间与新的 `chapterRevision` 不一致，后续校验判定审读失效，**形成状态机自锁死**。

* **修正方案**：将单一指纹拆分为正交双版本：

  * **`contentRevision`**：`sha256(body, outline, position, title)` —— 专用于绑定**审读结论、候选基线与正文一致性**（改标题会失效旧审读，改状态不影响正文有效性）。

  * **`stateVersion`（或 `etag`）**：单调递增整数或 `sha256(contentRevision, status)` —— 专用于 `expectedVersion` **乐观锁并发控制**，确保并发改状态或定稿跃迁可被精确拦截。

### 1.2 【工程红线】常驻 Python JSON-RPC Worker 属于伪瓶颈优化

* **原方案缺陷**：计划第 3(5) 节提出「引入长生命周期 Python JSON-RPC worker 模式以消除高频质检冷启动」。

* **对照评估**：`docs/REMAINING-WORK-PLAN.md` §4.6 已明确警示：**「不建立没有性能证据的常驻 Python 进程」**。

  * **收益极低**：`qa_check` 与 `manuscript_linter` 在单次写作流水线中仅执行 1\~3 次，单次冷启动耗时仅数十毫秒；真正的耗时瓶颈是模型端到端生成（数十秒至数分钟）。

  * **代价极高**：常驻 Python 子进程在 Windows 下极易引发**文件句柄占用阻塞应用更新/卸载**、进程僵死监控、状态污染及退出清理复杂化。

* **修正方案**：**彻底放弃常驻 Worker**。保留短生命周期进程模型，重点解决三个真问题：

  1. 用 `stdin` JSON 替代 `--metrics-json` CLI 传参（消除 Windows 32KB 命令行长度上限风险）；

  2. `writer_bridge.py` 的 `hot` 子命令改为直接 `import` 调用而非二次 `subprocess.run`；

  3. 统一 `-E -s -B -X utf8` 隔离参数，并补齐 POSIX 进程组级超时清理（`detached: true` + `-pid`）。

### 1.3 【数据真源破坏】`candidates/index.json` 与 `continuityPatrol` 滑动窗口不可取

* **原方案缺陷**：计划第 3(4) 节提出「`continuityPatrol` 改用滑动窗口」及「`candidates/` 增加轻量 `index.json`」。

* **对照评估**：`docs/REMAINING-WORK-PLAN.md` §4.2(FQ-07) 与 §4.6 明确指出：**「不按目录 mtime 返回可能陈旧的候选列表」**，且长书连续性巡检要求「与原巡检结果等价」。

  * 若 `continuityPatrol` 只扫最近 $N$ 章，会漏掉百章前的早期伏笔与人物知情边界，属于**功能降级**；

  * 若为 `candidates/` 另建 `index.json`，在外部同步盘或崩溃场景下极易与 `.json`/`.md` 实体文件产生双份真源撕裂。

* **修正方案**：

  * `continuityPatrol`：保持全书语义等价，改为 **有界并发读取（如并发度 8，防 EMFILE）+ 内存/缓存按 `(chapterId, contentRevision)` 增量跳过未改章节**。

  * `listCandidates`：不引入旁路 `index.json`，仅优化为只读轻量的 `.json` 元数据文件，列表阶段不再触摸或 `stat` 大体积 `.md` 正文。

### 1.4 【打包断链风险】npm Workspaces 与 Electron `app.asar` / Fuses 耦合盲区

* **原方案缺陷**：计划 Phase 0 提出「补齐 `packages/*/package.json`、`workspaces` 与 `tsc -b`」，但未评估打包与随包脚本影响。

* **隐藏风险**：

  1. 当前项目启用了 Electron Fuses（仅从 `app.asar` 加载、禁用 `NODE_OPTIONS`），且 `electron-builder` 基于 `apps/desktop/` 构建。开启根 `workspaces` 后，第三方依赖会提升（hoist）至根目录 `node_modules`，若构建配置未同步适配，`app.asar` 将漏打运行时依赖导致生产包白屏。

  2. `scripts/backup.mjs` 当前通过随包 EXE 的 `RunAsNode` 启动、`packages/*/skill/` 资源通过 `stage-desktop.mjs` 复制，改造成 workspaces 后相对路径锚点极易断裂。

* **修正方案**：

  * `packages/*/package.json` 必须配置条件导出（`"source"`/`"development"` 直指 `./src/index.ts` 供 `electron-vite` 与测试直连，避免先编 `dist/` 再打包的二次同步麻烦）；

  * **Phase 0 的验收标准必须包含 `npm run desktop:pack` 与产物启动校验**，不能只在开发环境跑通单测就宣称基建完成。

### 1.5 【模型稳定性风险】修订阶段一刀切「结构化 `edits`」会降低弱模型成功率

* **原方案缺陷**：计划第 3(3) 节要求修订阶段统一输出 `{ edits: [{ quote, replacement, reason }] }` 替代全文输出。

* **隐藏风险**：中文长篇网文场景下，经济档或较弱模型在生成多处局部 `quote` 时，极易出现引文截断、标点微改或连续补丁区间重叠，导致 `locate()` 批量失败，反而引发重试耗尽与任务中止（`RM02` 真实模型实测中已暴露出模型引文定位失败率偏高的问题）。

* **修正方案**：采用「局部 `edits` 优先，定位失败自动降级单轮全文修订」的混合策略，既在多数场景节省 60%+ 输出 Token，又保住弱模型/经济档的底线成稿率。

### 1.6 【重要遗漏】原计划漏掉了 4 项已确认的底层运行时隐患

对照 `docs/REMAINING-WORK-PLAN.md` §3–§4，原 v1.2 计划遗漏了以下应一并收口的高价值问题：

1. **关闭危险的 `RunAsNode` Fuse**：`backup.mjs` 目前依赖主程序 EXE 的 `RunAsNode` 执行备份；v1.2 应改为 Electron `utilityProcess`（或独立轻量备份入口）并**彻底关闭 `RunAsNode` fuse**。

2. **`updates.ts` 锁释放时机错位**：安装更新前先释放作品锁再调用 `quitAndInstall`，若用户取消或安装失败，应用仍在运行却已丢失文件锁。

3. **`targets.ts` 头条切换失败丢锁**：切换文章失败的路径可能错误释放仍在使用的锁根。

4. **`safeStorage` 异步化预留**：Electron 生态对加密存储的异步演进要求，v1.2 清理 `settings.ts` 时应将密钥读写接口统一收口为 `async`，避免后续再次大改调用链。

## 二、测试体系方案二次评估（Vitest 路线 vs Node 24 原生路线）

原计划建议「全面引入 `Vitest + jsdom + @testing-library/react + pytest`，并将 49 个测试文件压缩至 \~17 个」。经审慎评估，该方案存在两处需要校准的地方：

### 2.1 依赖膨胀与兼容性风险

* **现状约束**：`AGENTS.md` 明确要求克制新增依赖；根 `package.json` 已为 `undici` 锁定了 `overrides: { undici: "8.12.3" }` 以适配 Electron 45 / Node 24。

* **Vitest 引入代价**：引入 `vitest` + `jsdom` + `@testing-library/react` 会引入数十个深层子依赖，且 `jsdom` 与 Node 24 ESM / `undici` 偶有全局对象冲突；而真正拖垮当前测试速度的**不是 `node --test` 本身**，而是 **4 轮重复 `tsc`、2 个手写 `esbuild` 打包脚本以及 CI 跨 Job 重复跑 `core`**。

* **务实对比与建议**：

  * **方案 A（推荐 · 零冗余依赖路线）**：利用项目已要求的 **Node.js ≥ 24.11 原生运行 TypeScript**（Node 24 默认开启 Type Stripping，可直接运行 `.ts`），仅保留一个极简 Loader（或仅对含 JSX 的 `renderer-features` 跑单次内存转译 / 保留轻量 `happy-dom`），**继续使用原生 `node:test`**。既零额外重型框架风险，又能 100% 砍掉 `tsc` 预编译和 `build-desktop-test.mjs`。

  * **方案 B（Vitest 路线）**：若团队强偏好 Vitest 的监听 DX 与快照能力，必须在 **Phase 0 先做 1 天 POC**，验证 `vitest` + `happy-dom`（比 `jsdom` 轻 5 倍）与 `undici@8.12.3` 及 Electron 类型的兼容性后方可全面迁移。

### 2.2 测试文件数量不宜过度压缩到 17 个

* **风险**：把 2 万行测试强行塞进 17 个文件，会导致每个文件仍高达 600–900 行，重演 `runtime.test.mjs`（4,477 行）多主题混杂的维护困境。

* **修正目标**：建议重组为 **24\~28 个高内聚中等文件**（单文件严格控制在 200\~450 行，按单一模块/领域命名），总行数目标 **10,000\~12,000 行**（精简 \~45%），既消除碎片微文件，又避免新巨无霸诞生。

## 三、重构优先级校准与 ROI 裁决表

原计划将 5 个 Phase 并行铺开，战线过长且容易在中间态导致桌面端长期不可打包。建议按「**回报/风险比（ROI）**」重新裁决每一项改造：

| 改造项 | 评估裁决 | 理由与修正执行策略 | 
| ----- | ----- | ----- | 
| **清除旧版兼容代码（v1-v5/迁移/开关）** | **立即执行** | 零风险纯减法，直接砍掉数千行包袱与测试夹具，为后续重构扫清视野。 | 
| **修复 P0 安全/锁/IPC 错误码/并发抽卡** | **立即执行** | 直接影响数据安全与多实例/并发稳定性，ROI 最高。 | 
| **消除重复编译 & `ci.yml` 重复跑 `core`** | **立即执行** | 1\~2 天即可把 CI 与本地反馈耗时砍半，立竿见影。 | 
| **Prompt 前缀调序 & `s4-news` 注入 `s4-common`** | **立即执行** | 改动极小，直接提升真实模型缓存命中率与头条成文质量。 | 
| **规范 `chapterRevision`（拆内容/状态双指纹）** | **修正后执行** | 按 §1.1 拆分 `contentRevision` 与 `stateVersion`，防止自锁死。 | 
| **溶解 `fanqie/engine/ports/` & 合并 64 工具** | **分步执行** | 先删冗余旁路工具、下沉锁与修 `continuityPatrol` 增量缓存；目录合并可分批做，避免单次 PR 改百个文件。 | 
| **DAG 流水线引擎 + 擂台 Top-2 决胜** | **修正后执行** | 先落 `inputHash` 细粒度化、经济档真裁剪与 `edits` 优先+全文兜底；Top-2 擂台需用真实模型样本对比选稿质量。 | 
| **全量 TSX 化（消灭 `.jsx` + `tsconfig.jsx.json`）** | **建议执行** | 消除类型盲区，可按包渐进转后缀，不阻塞主线功能。 | 
| **废弃 `routes.ts` 改为全面 RPC Action** | **降级/延后** | 虽是过度抽象，但**当前运行稳定**；全面重写前后端 30+ 路由与适配器改动面极大，建议仅先修复 `ctx.body(limit)` 与禁用外部 `root`，RPC 化留待 v1.2 收尾或 v2.0。 | 
| **常驻 Python JSON-RPC Worker** | **坚决砍掉** | 违背已知不做红线，收益远小于 Windows 进程管理风险。 | 

## 四、修正版 v1.2 渐进式实施路线图（可随时出包）

为杜绝“重构两周跑不起来”的困局，将路线图收敛为 **4 个可独立验收、每步都能产出可打包客户端的里程碑**：

### Milestone 1：止血与基建提速（预计占比 25%）

1. **消除重复编译与 CI 冗余**：修正 `scripts/test.mjs` 与 `.github/workflows/ci.yml`，消除 Windows Job 重复执行 `core`；删除 `test/fixtures/journals/chapter-v1..v5.json` 及全部历史兼容开关测试。

2. **P0 安全与并发加固**：

   * 修复 `targets.ts`（先验锁后初始化 + 失败保留原锁）、`updates.ts`（确认退出后放锁）；

   * 修复 `operations.ts`（禁用渲染层裸 `root`、实装 `ctx.body(limit)`、实时校验目标工作区 `readOnly`）；

   * `handle.ts` + `preload.ts` 统一透传 `WriterError.code`；

   * 修复 `Sessions.children` 为 `Set` 以支持并发抽卡全量中止。

3. **数据锁与版本指纹修正**：

   * `packages/fanqie/src/engine/storage/continuity.ts` 全写函数下沉 `withResourceLock` 并为 `continuity_commit` 接入 `journal`；

   * 落地 `contentRevision` 与 `stateVersion` 双指纹，避免改状态自锁审读。

* **验收**：`npm run verify` 与 `npm run desktop:pack` 全绿；新增并发锁与 IPC 错码回归测试通过。

### Milestone 2：去包袱与业务瘦身（预计占比 30%）

1. **全仓清理 P2 死代码**：删除 `migration.ts`、`continuity-migration.ts`、`recovery.ts`、`taskPromptV1`、`inspiration-migration.ts`、`hideAgent` 死分支、`MODE_ALIAS` 等全部历史兼容代码。

2. **`core` 与规则单一来源**：剥离 `core` 的上层业务工具名硬编码，简化 `gates.ts`；`rules.py` 统一导出 `PASS_SCORE=84`、`QA_DIMS`、`READER_RUBRIC`、`STOP_LINE` 给 TS/UI 消费；Python 桥接统一 `stdin` JSON 与 `-E -s -B -X utf8`（不建常驻进程）。

3. **`fanqie` 瘦身与长书优化**：解散 `engine/ports/` 巨型存储实现，合并写作层双入口与 8 个 `*-journal.ts`，64 工具收敛至 \~28 个；`continuityPatrol` 改有界并发 + 按 `contentRevision` 增量缓存；`listCandidates` 不再在列表期 `stat` `.md`。

* **验收**：业务与测试代码净减 35%+；`npm run desktop:pack` 与 Playwright 核心旅程全绿。

### Milestone 3：流水线降本与会话重构（预计占比 25%）

1. **精细化 `inputHash` 与经济档裁剪**：拆分 `context.ts` 为关注点切片指纹，解决无关修改中断流水线；头条经济档跳过冗余阶段；`methods.ts` 实现 `s4-news → s4-common` 依赖注入。

2. **混合局部修订与擂台优化**：实现 `edits` 优先 + 全文兜底机制；优化擂台选稿（单轮评分 + Top-2 双盲决胜）；`promptText` 调整为静态 `<writer-method>` 在前。

3. **会话解耦与安全加固**：`session/create.ts` 拆离调度员与自由模式装配器；`usage.ts` 改为只读解析历史统计；用 `utilityProcess` 替换备份的 `RunAsNode` 并关闭该 Fuse。

* **验收**：`fake-model` 全流程调用次数与 Token 估算显著下降；备份恢复与正式包 Fuses 校验通过。

### Milestone 4：Workspaces、全面 TSX 与前端收敛（预计占比 20%）

1. **标准 Workspaces + TS Project References**：补齐 `packages/*/package.json`（含 `"source"` 条件导出）与 `tsc -b`，简化 `architecture-guard.mjs`。

2. **全量 TSX 与测试体系收口**：`packages/ui` 与 `packages/workbench` 全量迁为 `.ts/.tsx`（`strict: true`），删除 `tsconfig.jsx.json` 与 `--wb-*` 双令牌；测试体系按 24\~28 个高内聚文件 + 3 个 Playwright 冒烟 Spec + `pytest` 完成最终收编。

3. **前端竞态守卫**：为 `selectSnapshot`、`loadView`、`useToutiao`、`PersonalPane` 补齐请求代数与 `AbortSignal` 守卫，消除重复快照拉取。

* **验收**：`tsc -b` 零错误、全仓零 `.jsx`、打包产物 `desktop:pack` 及全套测试（L1+L2+L3）一次性通过。