# dsh-writer 0.5.0

DSH 写作插件，提供头条写作与番茄小说两种模式。模型与会话由 DSH 运行；稿件、作品和任务保存在本地，采纳与定稿由作者确认。

需要 DSH `dsh-v0.2.1-rc.4`、Node 24（≥24.9）和 Python 3.11。安装这个单包后，在对应项目的 DSH 会话里提出头条写作或小说需求；侧栏「写作 Agent」可查看任务，小说工作台用于阅读、比较和采纳候选。

升级时保留原头条目录和 `.zhizhang/`，新任务记录存放在项目 `.writer/`。默认提供 `toutiao_enable` 和 `fanqie_enable`；旧自动化需要 `zhizhang_enable` 时可设置 `compatibilityEntry: true`。

[安装与配置](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/master/docs/INSTALL.md) · [任务与工具](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/master/docs/TOOLS.md) · [项目源码](https://github.com/ouzx6696-cmyk/dsh-zhizhang)
