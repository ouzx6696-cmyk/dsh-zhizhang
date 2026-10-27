# 状态 · dsh-zhizhang 0.17.0

> 完整认知：[COGNITION.md](./COGNITION.md)

| 项 | 事实 |
|----|------|
| 版本 | **0.17.0**（拆书 9 步 + L0 量化底座；Auto 前 10 章 + 后 3 章 + 等距 / Full 须同意；正文引文回溯；51 tools，export 已并入 assemble） |
| 加载方式 | **默认只注册 `zhizhang_enable`**；触发后按 Agent 作用域挂 51 tools + SYSTEM_BRIEF |
| 运行时 | DeepSeek Harness 插件；Node ≥22；Web client 可选 |
| 产品形态 | **一条闭环** + **一张调度图** + **小说阅读工作台**（非多轮拼盘） |
| 调度 | `port.scheduler` → ProductMap / SYSTEM_BRIEF / 面板 nextHints / 回执 |
| 默认写作链 | **`chapter_brief(lean) → stage → lint →（可选 edit）→ accept`** |
| 旁路·多草稿 | `multiDraft.enabled` / `DSH_ZHIZHANG_MULTI_DRAFT=1` → unify_*；**默认关** |
| 目录布局 | `worksRoot` → 作品按书名建可见文件夹；`storageRoot` 管组装稿/灵感；`libraryRoot`/`sourceRoot` 管拆书库与书源 |
| 拆书库 | 默认随项目；`libraryRoot` / `DSH_ZHIZHANG_LIBRARY` 可跨项目共享（含面板） |
| 拆书管线 | import → dissect(批次) → facts(白描) → structure(plot/rhythm/character) → card(v2，可选 steps/bannedDiction) → accept → report(19 节 + L0) → combo |
| 拆书落盘 | `library/analyses/<sourceId>/{meta,chapters.jsonl,plots.jsonl,rhythms.json,characters.json,survey.json,report.md}` |
| 面板 | 三栏阅读默认；管线五区可切；**项目 ▸ 作品两级切换**；编辑抉择说明卡；真采纳二次确认；**常驻，不依赖工具启用** |
| 编辑抉择 | A 一次确认=编辑+验收 · B 仅候选 · C 拒/换模式；未表态按 B；**禁止静默验收** |
| 旁路 | diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · **multi.draft** · finalize.ship |
| 存储 | `.zhizhang/{works,library,inspiration}`；`ledger.json` = 审校留痕（非小说状态，保留最近 1000 条）；卡/候选/源文本/分析 bundle 走 mtime 读缓存；`inspiration/bindings.json` = workKey→绑定技法卡索引 |
| HTTP 根 | 跟随最近一次 Agent 工具的存储根（同进程）；首次工具调用前回退宿主 cwd |
| HTTP 安全面 | 默认仅回环（Origin 若出现须匹配 Host）；POST 须 `application/json`；`allowLanPanel` 另须 Host 白名单（`panelHosts`）+ 可选 `panelToken`；限流 120 GET / 20 POST 每分钟每客户端 |
| 面板快照 | JSON 轮询默认不含 HTML；`?html=1` 才返回；工具 `panel_snapshot` 默认 format=json（紧凑），html/both 须显式传；字段有上界（foundation 600 / 透镜 400 / 候选=待采纳+近 20 已采纳 / payoff 近 12 章 / analyses 20） |
| 发行形态 | **dist + docs + scripts**；无 src/tsconfig 和源码测试，不在发行包目录构建 |
| 安装 | profile `dsh.profile.bundles` 加 `dsh-zhizhang`（或 patch insert）+ 重启；会话内再调 `zhizhang_enable` |
| 测试 | 源码仓库 `npm run check`：构建、静态护栏和一套覆盖主线、资产恢复、并发及面板安全的测试 |
| 打包 | **未打包** |

## 质量环

- **硬闸**：lintPassToken、近期 brief、final/force、confirm_bypass；路径 A 另须 `confirm_accept_after_edit`；面板采纳另须 `confirm`（严格布尔：非 `true` 不算）；候选 accept 全程持候选锁（并发双采纳在锁内被拒，与 lint 写回互斥）
- **软传感**：Accept 一次扫（含人味/书感/反僵硬 tidy；勿例行三 audit）；四廉价闸全过才跑全文软传感（短路）
- **可选硬拒**：strict_* / require_payoff（旁路；**三态**——未传回落 PortConfig 默认，工具/面板都不再强转布尔）
- **章末一致性**：`domain/ending-consistency.ts` 单一评分（锚点加权；payoff 裁决 + 读者合同共用）；foundation 0.35 只做选择；作品根 `quality-lexicon.json` 可开单书严格模式
- **Full 同意**：成本回执绑定参数（batch_chars/总章数/计划章数）；confirm 时参数漂移 → `bad_confirm_token`
- **编辑过稿**：`port.edit` + edit_brief / edit_stage / edit_decide
- **多草稿**：`port.multi_draft`；统一整理稿为普通候选（source=unify），accept 前仍须 lint
- **沙箱**：章节/候选 id 只能是单个路径段（禁 `/`、`\`、`.`、`..`、控制字符、Windows 保留名）；
  统一在 store 校验，工具与 HTTP 同规则
