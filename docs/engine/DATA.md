# 长篇数据与备份

长篇数据默认保存在会话工作目录的 `.writer/`，与插件安装目录分开。作品、参考库、候选和历史文件应一起保留。

## 数据位置

| 数据 | 默认位置 | 配置或环境变量 |
| --- | --- | --- |
| 数据根 | `<会话目录>/.writer/` | `fanqie.storageRoot`、`WRITER_NOVEL_ROOT` |
| 作品 | `<数据根>/works/` | `fanqie.worksRoot`、`WRITER_NOVEL_WORKS` |
| 参考库 | `<数据根>/library/` | `fanqie.libraryRoot`、`WRITER_NOVEL_LIBRARY` |
| 本地书源 | 默认未设置 | `fanqie.sourceRoot`、`WRITER_NOVEL_SOURCE_ROOT` |

工具的 `working_dir` 指数据根本身。项目使用过的目录会登记在 DSH home，供写作台发现；作品未显示时先检查会话工作目录和配置。

## 主要文件

```text
<data-root>/
  works/<work-key>/
    meta.json                       作品根基、规划和章节目录
    chapters/<chapter-id>.md       章纲、正文和审读信息
    candidates/                     候选正文与元数据
    revisions/                      修订前的章节历史
    writer-reviews/<chapter-id>/    编辑审读回报
    ledger.json                     操作记录
  library/                          书源、分析和已采纳参考卡
  inspiration/                      规划会话与候选
  analyses/                         工作区参考分析
  manuscripts/                      汇编结果
```

章节保存、采纳和审读会核对相应版本；定稿正文修改后需要重新审读。接续索引记录处理过的章节与正文摘录，使用时仍应结合实际正文和设定。

## 备份

停止写作后，使用插件包内的备份脚本，将实际数据根备份到新目录：

```bash
node /path/to/dsh-writer/scripts/writer-backup.mjs --source /path/to/writing --output /path/to/backup
node /path/to/dsh-writer/scripts/writer-backup.mjs --verify /path/to/backup
```

如果作品、参考库或书源另设了目录，可多次传入 `--source`。源码仓库内同一脚本是 `scripts/backup.mjs`。备份脚本不自动迁移或恢复数据。

## 中断与汇编

| 需要检查的操作 | 检查及恢复入口 |
| --- | --- |
| 章节保存、候选、采纳及相关记录 | `fanqie_status(recovery=inspect|resume)` |
| 书源导入、拆书分析及卡片操作 | `fanqie_library_list(recovery=inspect|resume)` |
| 规划应用 | `fanqie_inspire_status(recovery=inspect|resume)` |

先确认原操作已经结束，再按工具提示检查和恢复。`fanqie_assemble` 将选中的章节汇编到 `manuscripts/`；汇编文件方便阅读或交付，不能替代完整作品备份。
