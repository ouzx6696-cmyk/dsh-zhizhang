# dsh-writer 0.7.0

DeepSeek Harness（DSH）写作插件，包含今日头条和番茄长篇两种模式，以及共用的写作台。

支持 DSH `>=0.2.1-rc.4 <0.2.2`，需要 Python 3.8 及以上。安装后重启 DSH，在会话中提出写作需求，Agent 通过 `writer_enable` 启用对应模式。

```bash
dsh plugin --profile desktop add ./dsh-writer-0.7.0.tgz
```

头条数据默认位于会话目录的 `outputs/toutiao/`，长篇数据默认位于 `.writer/`。从 0.5.0 升级时，入口、配置和长篇数据位置有变化，请先查阅升级说明并保留原数据。

[安装与配置](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/v0.7.0/docs/INSTALL.md) · [写作台](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/v0.7.0/docs/WORKBENCH.md) · [工具参考](https://github.com/ouzx6696-cmyk/dsh-zhizhang/blob/v0.7.0/docs/TOOLS.md)
