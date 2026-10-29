# 写作 Agent 0.4.0

一个 `dsh-writer` 插件，同时包含今日头条、番茄长篇方法与织章写作台。织章完整源码已并入 `packages/zhizhang/`，不再单独发布。沿用 0.20.0 的 `.zhizhang/` 数据格式与 `/api/dsh-zhizhang` 面板接口。

安装与升级见 [docs/INSTALL.md](docs/INSTALL.md)，本次交付、接口出处与限制见 [docs/releases/0.4.0.md](docs/releases/0.4.0.md)。

初始只提供三个触发工具：`toutiao_enable`、`fanqie_enable`、`zhizhang_enable`。启用番茄时同时启用织章；直接启用织章也会挂载番茄检查与门禁。头条和长篇仍按会话隔离。

织章配置只写在插件顶层 `zhizhang:`；不再重复配置 `fanqie.zhizhang`。章节、作品选择直接复用织章内部接口。审读回报保存在 `<作品目录>/writer-reviews/<章id>/`，备份作品目录会一并包含回报。旧 0.3.0 在 `outputs/fanqie/reviews` 的历史回报不自动迁移，升级后可重新审读。

统一质检工具为 `zhizhang_style_lint`：先输出织章语感雷达，再附 forge 超长段与套话检查，同位置重复命中去重。独立的 `fanqie_manuscript_lint` 已删除。

织章右栏“写作 Agent”展示回报结论、是否过期、硬伤数量，并提供续写、派编辑审读、按未通过回报修改。操作经确认后用 rc.4 的 `sessionController.prompt` 发送普通用户消息；仅选择同一项目中最近使用织章的主会话，子会话不参与。重启宿主后须先在主会话重新使用织章，建立投递目标。

`fanqie.requireEditorPass: true` 时，对话定稿与面板定稿都会检查当前正文的通过回报，缺失、过期、未完整回读或含硬伤均拒绝。原有作者确认与版本检查继续生效。

开发基线：DSH `dsh-v0.2.1-rc.4`、Node 24（≥24.9）、pnpm 11.25.0、TypeScript 5.8.3、Python 3.11 标准库。

```sh
pnpm install --frozen-lockfile
pnpm test
pnpm test:zhizhang
pnpm pack:bundle
```

真实 DSH 测试需设置 `WRITER_DSH_RUNTIME`；Python 不在 PATH 时设置 `WRITER_PYTHON`。源码中不附 node_modules、构建产物或作者作品数据。内部织章模块为 private，所有发行通过根目录 `dsh-writer` 完成。
