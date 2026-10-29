# 写作 Agent 0.5.0

一个 `dsh-writer` 插件，两种写作模式：**头条写作**和**番茄小说**。模型、对话和工具执行使用 DSH；插件负责写作方法、稿件、作品、任务记录与作者审阅。

## 从一句需求开始

在 DSH 会话中说“根据这些资料写一篇头条”或“继续这部小说”。Agent 启用对应模式后，通过 `writer_run` 建立任务，按返回的上下文和路线连续执行。已有稿件可从修改、审读开始，不必重新找题或开书。

- 头条：素材/选题 → 立项与出处 → 标题 → 初稿 → 编辑与 QA → 交稿单 → 作者采用。
- 小说：选择作品与章节 → 写作包与章纲 → 主候选 → 审读与修订 → 作者采纳、定稿 → 续章。

DSH 侧栏“写作 Agent”打开最近任务，可查看当前目标、阶段、正文、对照版本、审读结果和下一步；“小说工作台”保留章节、候选、采纳与定稿操作。头条原稿件页继续承担作者采用。

## 任务与恢复

任务保存在会话项目的 `.writer/tasks/`。`writer_resume` 根据真实稿件、候选和回报恢复，不把聊天记忆当作稿件状态。新建头条任务会预留唯一文章标识并建立文章，后续直接使用该文章；新书任务预留作品 key，创建回执丢失时也可从原作品恢复。任务绑定一篇文章或一部作品的一章，处理其他对象应另建任务。

正文仍保存在原头条目录与 `.zhizhang/`，没有数据库迁移。导出写入 `.writer/exports/`，提供 Markdown/TXT。连续性变化先作为任务中的待确认摘要；作者确认后再通过原作品工具更新正式设定。

恢复宿主后，先在原项目主会话启用相应模式，使用 `writer_status list=true` 查看任务，再指定 ID 恢复。面板显式选择已启用的同项目、同模式主会话；不会猜测其他项目的投递目标。

## 工具与边界

默认启动入口只有 `toutiao_enable`、`fanqie_enable`；番茄自动准备内部小说工作台。启用后新增 `writer_run`、`writer_status`、`writer_resume`、`writer_checkpoint`、`writer_review`、`writer_export`。底层业务工具继续保留。

任务层不运行另一套模型循环，不在后台无人值守生成。DSH Agent 必须实际执行返回的业务步骤并 checkpoint；建立任务或收到投递回执不表示稿件已完成。审读支持 quick/editor/manual，但原有 QA、版本与作者确认条件继续有效。不会代替作者发布。

[安装升级](docs/INSTALL.md) · [架构](docs/architecture.md) · [工具](docs/TOOLS.md) · [当前状态](docs/STATUS.md) · [0.5.0 说明](docs/releases/0.5.0.md)

## 开发

基线：DSH `dsh-v0.2.1-rc.4`、Node 24（≥24.9）、pnpm 11.25.0、Python 3.11。

```sh
pnpm install --frozen-lockfile
pnpm check
pnpm build
# 可选：指定 DSH 运行时后执行两种写作模式的宿主验收
WRITER_DSH_RUNTIME=/path/to/dsh-runtime pnpm test:host
```

`pnpm check` 会同时检查业务、小说引擎与接口；设置 `WRITER_DSH_RUNTIME` 后包含 DSH 组件验证。头条规则本身发生变化时可单独运行 `pnpm test:rules`。Python 路径可通过 `WRITER_PYTHON` 指定。内置小说引擎是 private，唯一发行包是 `dsh-writer`。
