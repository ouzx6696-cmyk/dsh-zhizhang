# 番茄与织章源码整合（0.4.0）

织章完整源码位于 packages/zhizhang。该模块 private，不再独立发布，发行单元只有 dsh-writer。三个原始触发工具保留；挂载写作插件时统一校验 zhizhang 配置并调用内部 apply，原数据路径及接口不变。

番茄通过内部 tools/context.openWork、withPluginConfig 与 lib/work-store 的 readWorkMeta/readChapter 访问数据，不再解析 front matter、扫描目录猜作品。work 省略时使用织章同会话最近作品，再退回唯一作品；working_dir 也共用选择入口。

编辑回报存储于作品 writer-reviews/<章id>/，以正文 SHA-256 判断新鲜度。原 0.3.0 外置回报不会自动移动。章 id 校验复用织章 assertResourceId，允许兼容原来的中文章 id。

统一 linter 是 zhizhang_style_lint。织章雷达及 token 语义保持原样；随后运行原版 forge Python 正文体检，同一行重叠文本命中不重复附加，超长段单列。独立 fanqie_manuscript_lint 已删除，原 Python linter 作为规则源保留。

定稿的回报检查位于 storage/chapters.prepareChapterSaveUnlocked，持有作品写锁后执行；saveChapter、updateChapter 和面板 finalize 共用此路径。启用 requireEditorPass 后，没有当前版本的通过回报、回报含硬伤或未完整回读都不能定稿。工具门禁继续负责作者审批，面板继续使用原确认与 expectedRevision 校验。

右栏从原 chapter 接口的 meta.writerReview 读取结论、新鲜度与硬伤数量。新增 POST /api/dsh-zhizhang/writer/action，复用原 loopback、Host/Origin、token 与限流校验。固定 action 白名单（continue/review/revise）及 confirm=true，服务端只为已登记作品投递。通过 dsh-adapter 调 sessionController.prompt，以 queue 模式提交普通用户消息。

投递目标按项目 base 记录最近成功使用织章的主会话；origin=subagent、parentSession 存在或 editor 角色的会话不更新目标。未记录目标、宿主无控制器或投递失败时明确报错，不退回其他项目的会话。目标记录不跨宿主重启持久化，重启后需重新使用织章。

原 47 项测试文件保持不变，哈希基线在 docs/zhizhang-original-tests.json。结构变更新增专门测试，不通过删改原断言来使其通过。
