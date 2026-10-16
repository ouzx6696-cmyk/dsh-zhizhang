# 调研笔记：DSH 插件形态与对标

日期：2026-10-15（Asia/Hong_Kong）

## 官方插件契约（DeepSeek Harness）

来源：[Your first plugin](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/)、[Package and install](https://deepseek-harness.github.io/deepseek-harness/en/develop/basic/publish)、[Plugins and lifecycle](https://deepseek-harness.github.io/deepseek-harness/en/develop/framework/)、[cordis.patch.yml 说明](https://findharness.com/blog/deepseek-harness-cordis-patch-yml-explained)

- 插件模块导出 `name` / 可选 `inject` / `apply(ctx, config)`。
- `inject: ['tools']` 等会等待服务就绪再加载；`ctx.tools.register(tool)` 在卸载时自动撤销。
- 可发布 **bundle**：`package.json` → `dsh.bundle.patch` 指向 `cordis.patch.yml`；补丁用 `insert` 写入 `id` + **npm 包名**（非相对路径）。
- 安装：`dsh plugin --profile web add link:$(pwd)` 或 `add ./dsh-zhizhang` / `github:…`。
- Git 安装需 `prepare` 构建 + pnpm `allowBuilds`；本仓库用 `prepare: npm run build`（tsc → dist/）。

## tea-whale/dsh-writing-studio（网络已 clone；仓库内保留 snippets）

路径：`docs/research/snippets/writing-studio/（及 /tmp clone）`

**借鉴：**

| 项 | 做法 |
|----|------|
| 零运行时依赖 | 仅 Node 内置 fs/path |
| 工具族前缀 | `writing_*` → 我们用 `zhizhang_*` |
| 状态机 | 建项目 → 大纲 → 逐节 save/review → assemble |
| 存储 | `.writing-studio/projects/*.json` + `manuscripts/`；原子写 + 进程内锁 |
| 会话记忆 | `lastProjectBySession`，多项目时禁止猜 |
| systemPrompt | 可选 `systemPrompt.section` 轻量引导 |
| 边界 | 「真正的文字由模型生成；工具只负责可靠落盘」——与产品决策一致 |

**未照搬：** 模板八套、节审校回写 revised_content（织章改为 candidate_stage/accept + 审校留痕（ledger））。

## siweina/dsh-novel-writer（元数据快照）

路径：`docs/research/dsh-novel-writer-meta/`（完整仓过大，仅存 package.json / cordis.patch.yml / README 头）

**借鉴：**

| 项 | 做法 |
|----|------|
| 章节库 | `novel_books` / `novel_chapters` / `novel_read` → `zhizhang_project_*` / `chapter_*` |
| 伏笔/设定 | `novel_plot` / `novel_settings` → 织章用 `foundation.threads` + ledger，首期不引入 ONNX |
| 开写材料 | `novel_chapter_brief` 思路 → 由 Agent 调 `outline_get` + `foundation_get` + `chapter_read` 自组 |
| 侧栏面板 | `dsh.client` + sidebar seats；**本期仅文档预留**（轻量面板二期），首期纯工具 |
| cordis | `id: novel-writer` + `config.root` |

**刻意不做：** 本地 embedding、22 工具全量（含 method_*/chapter_brief）、MCP 双形态（可后续加）。

## 织章独立版（`/workspace/zhizhang`）可移植概念

| 概念 | 来源 | 插件落点 |
|------|------|----------|
| style-linter 四类 + 对白豁免 | `src/lib/studio/style-linter.ts` | `src/lib/style-linter.ts` + `zhizhang_style_lint` |
| situationLens / livedScene / stateLens | `types.ts` Outline | `zhizhang_outline_*` |
| 四维自审证据卡 | `author-review.tsx` | `zhizhang_review_ledger` dims |
| 五类审校范畴 | `ai-output.ts` review | ledger `evidence_kinds` + Agent 侧提示 |
| 不自动写库 / 候选采纳 | Contract 4.0 | `candidate_stage` / `candidate_accept` |
| Contract 4.0 文风/任务规则 | `ai-output.ts` STYLE_CONTRACT + rules | `method-assets.ts` + `zhizhang_method_*` / `chapter_brief`（按需） |
| Next UI / Postgres | 整站 | **放弃**，不进本包 |

## 网络与 CLI

- 已成功 clone：`tea-whale/dsh-writing-studio`、`siweina/dsh-novel-writer`（/tmp，再拷研究副本）。
- 本环境未验证 `dsh` CLI 是否安装；脚手架按官方文档可 `link:` 安装。
