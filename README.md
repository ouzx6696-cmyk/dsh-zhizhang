# dsh-writer 写作 Agent

`dsh-writer` 是 DeepSeek Harness（DSH）的写作插件，提供今日头条和番茄长篇两种模式。DSH 负责模型和会话，插件提供写作方法、作品管理、审读工具和写作台。

## 开始使用

1. 从 [GitHub Releases](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases) 下载 `dsh-writer-0.7.0.tgz`。
2. 安装 DSH `0.2.1-rc.4` 或兼容的 0.2.1 版本，并确保 Python 3.8 及以上可用。
3. 完全退出 DSH，在安装包所在目录执行：

   ```bash
   dsh plugin --profile desktop add ./dsh-writer-0.7.0.tgz
   ```

4. 重启 DSH，在会话中提出写作需求；Agent 会调用 `writer_enable` 启用相应模式。侧栏「写作台」用于查看和处理稿件。

已安装旧版的用户请先阅读[升级说明](docs/INSTALL.md#从-050-升级)。完整配置和其他 profile 的安装方式见[安装与配置](docs/INSTALL.md)。

## 两种写作方式

- **今日头条**：从素材或选题开始，整理立项卡和标题，保存版本，审读质检，生成交稿单，最后由作者采用。
- **番茄长篇**：管理作品设定、章纲和正文；使用规划、拆书和写作方法生成候选，审读后由作者采纳、定稿，并继续下一章。

两种模式通过 `writer_enable(mode=toutiao|fanqie)` 按需加载。同一会话使用一种模式，切换模式时新建会话。编辑子代理使用 `role=editor` 进行审读和生成编辑候选。

写作台可以阅读正文、对照候选、查看审读结果，并将续写、审读或修改请求发送到已使用该数据目录的 DSH 主会话。正文由会话中的 Agent 生成，作者决定采纳和定稿；插件不直接发布到外部平台。

## 数据与升级

头条数据默认位于会话目录的 `outputs/toutiao/`，长篇作品默认位于 `.writer/`；都可以在配置中指定位置。作品与插件安装目录分开，备份和恢复见[数据与备份](docs/engine/DATA.md)。

0.7.0 的入口和长篇数据目录与已发布的 0.5.0 不同，旧任务接口不会自动恢复。升级前请保留旧数据和配置，按[升级说明](docs/INSTALL.md#从-050-升级)核对。

## 文档

- [安装、配置与升级](docs/INSTALL.md) · [写作台](docs/WORKBENCH.md) · [工具参考](docs/TOOLS.md)
- [番茄长篇](docs/FANQIE.md) · [作品与数据](docs/engine/DATA.md) · [拆书与参考](docs/engine/DISSECT.md)
- [项目架构](docs/ARCHITECTURE.md) · [DSH 接口](docs/DSH.md) · [版本记录](CHANGELOG.md)

## 开发

需要 Node.js 22 及以上、Python 3.8 及以上。DSH 插件兼容范围为 `>=0.2.1-rc.4 <0.2.2`。

```bash
npm ci
npm test
npm run pack
```

`npm test` 运行项目自带的架构、规则、工具和引擎检查；`npm run pack` 将安装包放入 `dist-pack/`。DSH 宿主集成检查见 [DSH 接口](docs/DSH.md)。
