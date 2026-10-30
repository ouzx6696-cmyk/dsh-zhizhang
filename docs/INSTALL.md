# 安装、配置与升级

## 安装

需要 DSH `0.2.1-rc.4` 或兼容的 0.2.1 版本，以及 Python 3.8 及以上。插件包声明的 DSH 兼容范围为 `>=0.2.1-rc.4 <0.2.2`。Windows 用户可安装 python.org 版本并将 Python 加入 PATH。

从 [Releases](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases) 下载 `dsh-writer-0.7.0.tgz`，完全退出 DSH 后在安装包所在目录执行：

```bash
dsh plugin --profile desktop add ./dsh-writer-0.7.0.tgz
```

CLI 可将 `desktop` 换成相应的 profile。重启 DSH，确认会话中可以使用 `writer_enable`，侧栏可以打开「写作台」。已有 `dsh-writer` 时，先使用同一 profile 的 `dsh plugin ... remove dsh-writer` 卸载插件，再安装新包；作品文件单独保留。

## 从 0.5.0 升级

0.7.0 采用统一入口 `writer_enable`。已发布的 0.5.0 使用 `toutiao_enable`、`fanqie_enable` 和 `writer_run` 等任务工具，这些调用不能直接照搬到 0.7.0；旧任务记录也不会自动作为新任务恢复。

旧版小说数据默认在会话目录的 `.zhizhang/`，0.7.0 默认使用 `.writer/`。新版本不会自动迁移旧作品或确认其格式兼容。升级前请保留原来的 `.zhizhang/`、`.writer/`、头条目录和配置；有自定义路径时也保留相应目录。核对数据后再决定如何导入或重新配置，不要直接覆盖原作品。

0.7.0 的配置集中在 `python`、`toutiao`、`fanqie` 和 `workbench` 下。旧版的 `zhizhang`、`workflow` 等配置项需要移除或按下表重新设置；未知配置项会报错。

## 配置

在 `$DSH_HOME/profiles/<profile>/cordis.patch.yml` 中按插件 id 覆盖配置，例如：

```yaml
- id: writer
  config:
    python: 'C:/Python312/python.exe'  # 可选；不填则自动查找
    toutiao:
      storageRoot: 'D:/写作/头条'
      requireEditorPass: false
    fanqie:
      storageRoot: 'D:/写作/长篇'
      requireEditorPass: false
      multiDraft:
        enabled: false
    workbench:
      allowLan: false
```

| 位置 | 配置项 | 默认值与用途 |
| --- | --- | --- |
| 顶层 | `python` | 两种模式共用的 Python 命令；不填时自动查找 |
| `toutiao` | `rootDir` / `storageRoot` | 默认相对会话目录的 `outputs/toutiao`；`storageRoot` 指定固定路径 |
| `toutiao` | `requireEditorPass` | 默认 `false`；开启后送验收前需编辑或作者版本 |
| `toutiao` / `fanqie` | `python` | 可单独指定该模式使用的 Python 命令，覆盖顶层设置 |
| `toutiao` / `fanqie` | `disabledGates` | 关闭指定的非锁定门禁；默认不关闭 |
| `fanqie` | `rootDir` / `storageRoot` | 默认相对会话目录的 `.writer`；`storageRoot` 指定固定数据根 |
| `fanqie` | `worksRoot` / `libraryRoot` / `sourceRoot` | 分别指定作品、共享参考库和本地书源目录 |
| `fanqie` | `requireEditorPass` | 默认 `false`；开启后定稿需要当前正文的编辑通过回报 |
| `fanqie` | `multiDraft.enabled` | 默认 `false`；开启同章多草稿整理 |
| `workbench` | `allowLan` / `hosts` / `token` | 默认仅本机访问；用于配置局域网访问 |

头条也可使用 `WRITER_TOUTIAO_ROOT`，长篇可使用 `WRITER_NOVEL_ROOT`、`WRITER_NOVEL_WORKS`、`WRITER_NOVEL_LIBRARY` 和 `WRITER_NOVEL_SOURCE_ROOT`。数据目录的具体优先级和布局见[数据与备份](engine/DATA.md)。

## 常见问题

| 现象 | 处理 |
| --- | --- |
| 找不到 Python | 安装 Python，或在顶层 `python` 指定可执行命令 |
| `writer_enable` 提示模式冲突 | 在新会话启用另一种模式 |
| 长篇作品未显示 | 核对会话工作目录和 `fanqie` 数据路径；先在会话中打开作品 |
| 写作台动作不可用 | 先在对应数据目录的主会话使用写作工具，确认宿主提供会话控制服务 |
| 定稿或交稿需要确认 | 在提供审批或写作台确认的 DSH 环境中操作 |

备份方式见[数据与备份](engine/DATA.md)。
