# 数据、修订与恢复

创作资产默认落在会话 cwd 下的 `.writer/`。它与插件安装目录是两回事：升级插件不应删除作品、参考库或恢复记录。

## 目录优先级

| 目录 | 解析顺序 |
| --- | --- |
| 数据根 | 工具 `working_dir` → 配置 `storageRoot` → `WRITER_NOVEL_ROOT` → 会话 cwd 下的 `rootDir`（默认 `.writer`） |
| 作品根 | 配置 `worksRoot` → `WRITER_NOVEL_WORKS` → `<数据根>/works` |
| 参考库 | 配置 `libraryRoot` → `WRITER_NOVEL_LIBRARY` → `<数据根>/library` |
| 本地源书目录 | 配置 `sourceRoot` → `WRITER_NOVEL_SOURCE_ROOT` → 未设置 |

`working_dir` 指数据根本身，不会自动再加一层 `.writer`。它及独立作品/库/源书根的相对路径以会话 cwd 为基准；`storageRoot` 和根环境变量经进程路径解析，建议统一填写绝对路径。

工具使用过的项目会写入 DSH home 中的最近根和项目索引，供没有会话上下文的写作台发现项目。写作台选定项目后沿该项目继续读取；首次未发现作品时，先通过会话创建或打开一次，并核对真实目录。

## 文件布局

```text
<data-root>/
  analyses/ref-*.json                  局部参考分析与迁移包
  works/<work-key>/                    可由 worksRoot 单独指定
    meta.json                         根基、规划、目录、接续及修订提示
    chapters/<chapter-id>.md           现行正文、章纲、审读及依赖
    candidates/<id>.json + <id>.md     候选元数据和正文
    revisions/<chapter-id>/<hash>.md   原始章节文件历史
    ledger.json                       最近 1000 条操作留痕
    brief-crumbs.json                  简报来源记录
    payoff-audits.json                 按需诊断记录
  library/                            可由 libraryRoot 单独指定
    sources/                          原文与来源元数据
    analyses/                         阅读计划、事实、结构和报告
    candidates/                       待入库卡
    cards/                            已采纳卡
    index.json                        来源与卡索引
  inspiration/                        规划会话、候选与应用记录
  manuscripts/                        汇编结果
```

章节文件保留 JSON front matter 和正文。未知扩展字段在正常更新中保留。历史目录中的文件不参与普通汇编，候选也不会自动成为现行正文。

## 版本如何生效

章节 revision 来自正文、规范化章纲和位置，排除标题、时间和审读字段。候选携带目标基线；简报与审读记录根基、规划及实际前稿的版本。旧候选缺基线时，要明确提供当前 `expected_revision` 或重新暂存。

显式 append 是向锁内当前正文追加，与按旧基线替换整章不同。定稿正文修改仍需 `force=true`。保存前先独占留存原字节历史，随后提交现行修改；后续失败可能留下未采用的历史副本，它不等于提交成功。

接续索引分 working 与 finalized，仅覆盖实际处理过的来源。旧章没有条目不代表未定稿，旧 `happened` 也不自动升级为已核事实。

## 中断后先检查，再恢复

| 中断发生在哪 | 检查入口 | 恢复入口 |
| --- | --- | --- |
| 章节保存、候选、扫描/简报/兑付留痕、采纳 | `fanqie_status(work=..., recovery=inspect)` | 同工具 `recovery=resume` |
| 导入、拆书分析、阅读计划、卡采纳或删除 | `fanqie_library_list(recovery=inspect)` | 同工具 `recovery=resume` |
| 规划应用 | `fanqie_inspire_status(recovery=inspect)` | 同工具 `recovery=resume` |

先确认原操作及其写入进程已经结束，再检查文件状态。遇到遗留 `.writer-write-lock` 不按时间猜测失效，不直接删锁重试。跨主机、进程状态不明或文件已被修改时，先保留现场供人工核对。

恢复记录描述原本要提交的固定目标及前后哈希。部分文件已写入时，恢复会核对这些状态，再完成原意图；发生冲突则停止，不覆盖后来修改。不能把外部 JSON 当作任意文件写入方案。

旧章节 journal v1–v4 继续解码，v5 将直接保存的章节、目录与留痕一起恢复。其他协议保留各自目标白名单及来源守卫。合作锁不阻止任意外部程序编辑；路径写入拒绝符号链接祖先和链接资产，不宣称保证断电持久性。

## 离线备份

停止所有写入，再对实际资产根执行：

```bash
node scripts/backup.mjs --source /data/writing --output /backups/writing-2026-10-27
node scripts/backup.mjs --verify /backups/writing-2026-10-27
```

如果作品根或公共库独立在外，加入相应来源：

```bash
node scripts/backup.mjs --source /data/writing --source /data/novels --source /data/shared-library --output /backups/writing-complete
```

输出目录必须是新目录。脚本生成来源清单和内容哈希，校验文件、目录与链接；符号链接只保存链接本身，不追随复制目标。发现写锁会停止。脚本不自动恢复或迁移作品，恢复备份前需要明确目标与覆盖范围。

## 汇编不是备份

`fanqie_assemble` 按章序输出到 `manuscripts/`，同目标可覆盖。默认收录有正文的章节；兼容参数 `only_final=true` 收录 `reviewed` 与 `final`，不会重新验证内容审读或改变状态。

实际被选中的章节缺失或损坏时，汇编停止并保留旧输出。自定义输出须留在 `manuscripts` 内。备份须包含规划、候选和历史等实际资产，不能只留一份汇编文本。
