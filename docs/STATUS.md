# 状态 · dsh-zhizhang 0.15.3

> 完整认知：[COGNITION.md](./COGNITION.md)

| 项 | 事实 |
|----|------|
| 版本 | **0.15.3**（按需启用 + 0.15.1 工程加固；能力面同 0.14） |
| 加载方式 | **默认只注册 `zhizhang_enable`**；触发后按 Agent 作用域挂 46 tools + SYSTEM_BRIEF |
| 运行时 | DeepSeek Harness 插件；Node ≥22；Web client 可选 |
| 产品形态 | **一条闭环** + **一张调度图** + **小说阅读工作台**（非多轮拼盘） |
| 调度 | `port.scheduler` → ProductMap / SYSTEM_BRIEF / 面板 nextHints / 回执 |
| 默认写作链 | **`chapter_brief(lean) → stage → lint →（可选 edit）→ accept`** |
| 旁路·多草稿 | `multiDraft.enabled` / `DSH_ZHIZHANG_MULTI_DRAFT=1` → unify_*；**默认关** |
| 目录布局 | `worksRoot` → 作品按书名建可见文件夹；`storageRoot` 管组装稿/灵感；`libraryRoot`/`sourceRoot` 管拆书库与书源 |
| 拆书库 | 默认随项目；`libraryRoot` / `DSH_ZHIZHANG_LIBRARY` 可跨项目共享（含面板） |
| 面板 | 三栏阅读默认；管线五区可切；**项目 ▸ 作品两级切换**；编辑抉择说明卡；真采纳二次确认；**常驻，不依赖工具启用** |
| 编辑抉择 | A 一次确认=编辑+验收 · B 仅候选 · C 拒/换模式；未表态按 B；**禁止静默验收** |
| 旁路 | diagnose.audit · brief.full · save.direct · inspire.craft_only · accept.flags · **multi.draft** · finalize.ship |
| 存储 | `.zhizhang/{works,library,inspiration}`；`ledger.json` = 审校留痕（非小说状态） |
| HTTP 根 | 跟随最近一次 Agent 工具的存储根（同进程）；首次工具调用前回退宿主 cwd |
| 面板快照 | JSON 轮询默认不含 HTML；`?html=1` 才返回（工具 `panel_snapshot` 仍默认带 HTML） |
| 发行形态 | **仅 dist + docs + scripts/smoke.mjs**；无 src/tsconfig，不在此目录构建 |
| 安装 | profile `dsh.profile.bundles` 加 `dsh-zhizhang`（或 patch insert）+ 重启；会话内再调 `zhizhang_enable` |
| 测试 | `npm run smoke`（46 tools / 写作链 / 闸 / 沙箱 / 面板 HTTP） |
| 打包 | **未打包** |

## 质量环

- **硬闸**：lintPassToken、近期 brief、final/force、confirm_bypass；路径 A 另须 `confirm_accept_after_edit`；面板采纳另须 `confirm`
- **软传感**：Accept 一次扫（含人味/书感/反僵硬 tidy；勿例行三 audit）
- **可选硬拒**：strict_* / require_payoff（旁路）
- **编辑过稿**：`port.edit` + edit_brief / edit_stage / edit_decide
- **多草稿**：`port.multi_draft`；统一整理稿为普通候选（source=unify），accept 前仍须 lint
- **沙箱**：章节/候选 id 只能是单个路径段（禁 `/`、`\`、`.`、`..`、控制字符、Windows 保留名）；
  统一在 store 校验，工具与 HTTP 同规则
