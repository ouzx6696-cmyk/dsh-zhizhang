# 文件、版本与恢复 · 0.18.0

默认根为会话 cwd 下 `.zhizhang/`。显式 working_dir 优先于 storageRoot；随后使用 DSH_ZHIZHANG_ROOT 或默认根。worksRoot、libraryRoot、sourceRoot 可以独立配置，工具与 HTTP 使用同一解析规则。

```text
.zhizhang/
  analyses/ref-*.json          工作区分析，不是公共库
  works/<work>/
    meta.json                 根基、规划、章节目录、接续索引和修订提示
    chapters/<chapter>.md     唯一现行正文与章纲、审读及依赖
    candidates/*.json + *.md  待选/已采纳候选
    revisions/<chapter>/<sha256>.md  原始字节历史
    ledger.json               最近 1000 条操作留痕
    brief-crumbs.json          上下文依据记录
    payoff-audits.json         可选诊断
  library/                    sources、cards、candidates、analyses、index
  inspiration/                会话、规划候选、引用绑定
  manuscripts/                汇编输出
```

章节 revision 由正文、规范化章纲与位置计算，排除标题、时间、审读和展示字段。候选记录目标基线；上下文记录根基/规划指纹与实际前稿引用。审读绑定章节版本和依据，正文或关键依据变化后需重核。

continuity.finalized 只登记定稿来源和末尾摘录，working 登记条件工作来源。它们不是语义事实数据库，也不假称覆盖旧作品的全部章节；没有索引条目不等于没有定稿，应结合目录与实际正文。人物说法不自动成为真相。旧 happened 保留作者身份，不自动归为已核定稿。

历史先独占保存，再提交现行修改，失败可能留下尚未被采用的历史副本；它不代表操作成功。旧 final 保留，不补造审读。旧候选可比较，明确提供 expected_revision 后才能采用；显式 append 保留锁内追加语义。

## 中断恢复

作品用 status(recovery=inspect|resume)，库用 library_list，灵感应用用 inspire_status。先核相关进程与 `.zhizhang-write-lock`，不会按超时自动删锁。检查实际文件和冲突后完成原意图；冲突与损坏记录保留供人工核对。

章节 journal v1–v4 兼容，v5 把直接保存正文、目录与留痕一起恢复。其余旧协议保留固定目标和来源校验。目录链接与链接资产拒绝写入；合作锁不阻止任意外部修改。

## 备份与汇编

停止写入后：`node scripts/backup.mjs --source <根> [--source <独立库根> ...] --output <新目录>`；`--verify <备份目录>` 校验。独立作品根、灵感及公共库都要纳入实际备份范围。只保存链接自身，不自动恢复或迁移。

汇编持作品锁，坏章或缺章停止并保留旧输出，自定义目标必须位于 manuscripts 内。历史稿不参与普通汇编。断电持久性和真实 Windows 文件系统行为尚需目标环境验收。
