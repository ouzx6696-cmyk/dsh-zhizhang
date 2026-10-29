# dsh-writer 0.4.0

一个安装包包含头条、番茄与织章写作台；不再另装 dsh-zhizhang。

入口：toutiao_enable、fanqie_enable、zhizhang_enable。织章参数统一填在 writer 配置的 zhizhang 段；原 .zhizhang 数据格式与 /api/dsh-zhizhang 接口保持兼容。

编辑回报存入作品 writer-reviews 目录。右栏提供回报状态、续写、派编辑与按回报修改。操作发送到同项目最近使用织章的主会话，编辑子会话不会成为目标。宿主重启后须先在主会话重新使用织章。

fanqie.requireEditorPass=true 时，对话和面板定稿均要求当前版本的通过编辑回报，作者确认仍然需要。原独立 fanqie_manuscript_lint 已由 zhizhang_style_lint 的合并结果替代。

基线：DSH dsh-v0.2.1-rc.4、Node 24≥24.9、Python 3.11。升级前备份作品，移除旧独立织章插件与其配置行，避免重复注册。完整源码、迁移说明和测试输出随 writer-agent-0.4.0-src.zip 提供。

包含织章 0.20.0 代码（原仓库 https://github.com/ouzx6696-cmyk/dsh-zhizhang，基线 commit 7eeaf9a2308dc433c8f4f9e41e200041b07dfae2，原包许可 MIT）；forge 原始方法及其 LICENSE 一并保留。
