# 本地落盘模型

> 认知入口：[COGNITION.md](./COGNITION.md) · 卡口径：[PILLARS.md](./PILLARS.md) / [QUALITY.md](./QUALITY.md)

默认根目录：`<会话 cwd>/.zhizhang/`（可被 `working_dir` / `storageRoot` 覆盖）。无 Postgres。

### 本机推荐布局（可用 `worksRoot` 自定义）

```text
D:/织章/
├── .zhizhang/            # storageRoot：manuscripts/（组装稿）、inspiration/
├── 小说项目/              # worksRoot：一本书一个同名文件夹
│   ├── 某本书/
│   │   ├── meta.json
│   │   ├── chapters/
│   │   ├── candidates/
│   │   ├── brief-crumbs.json     # 开写 brief 留痕（accept 硬闸用）
│   │   ├── payoff-audits.json    # 兑付审计留痕（可选 require_payoff）
│   │   ├── quality-lexicon.json  # 可选：本书 ending 词汇表（开单书严格兑付审计）
│   │   └── ledger.json           # 审校留痕（非小说状态）
│   └── 另一本/
└── 拆书库/                # libraryRoot + sourceRoot
    ├── index.json
    ├── sources/          # 导入后的原文副本
    ├── cards/            # 技法卡（craft / mind）
    ├── candidates/
    └── 某本原始书.txt      # 本地书源：可直接放 .txt/.md，按文件名导入
```

`worksRoot` 让作品目录变成**可见的、书名命名的文件夹**，而不是藏在 `.zhizhang/works/` 下；
`storageRoot` 仍管稿件组装/灵感等共享数据。不改配置时，一切都回退到 `<会话 cwd>/.zhizhang/`。

面板跟随：工具会把最近使用的根写到 `$DSH_HOME/zhizhang-last-root.json`（默认 `~/.dsh/`），
HTTP 面板据此与 Agent 使用同一份 `.zhizhang`；标记缺失时才回退宿主 cwd。

### 本地书源目录（`sourceRoot`）

除了 `file:` 全路径，还可以指定一个**书源文件夹**，让工具直接按文件名导入：

```yaml
config:
  sourceRoot: 'D:/books'            # 或环境变量 DSH_ZHIZHANG_SOURCE_ROOT
```

- `zhizhang_library_list` 会多出一段「本地书源」：列出 `.txt / .md` 文件、大小、**已导入 / 未导入**；
- `zhizhang_library_import { title, file: "某某书.txt" }` 先找会话 cwd，找不到再到 `sourceRoot` 里找；
- 目录只被**读**（不自动导入、不改文件）；导入仍走 `library_import` 显式动作；
- 面板 Library 区显示「本地书源 + 待导入 N（文件名…）」。

### 共享拆书库（跨项目复用）

默认 `library` 跟着项目走（`<项目>/.zhizhang/library/`）。要让多个项目共用一份拆书库，
配 `libraryRoot`（或环境变量 `DSH_ZHIZHANG_LIBRARY`）：

```yaml
config:
  libraryRoot: 'D:/writes/shared-library'   # 绝对路径最稳
```

- 只替换 `library`；`works / manuscripts / inspiration` 仍在各自项目里；
- 工具与 Web 面板都读同一个库（`library_*`、`chapter_brief` 取卡、面板 Library 区）；
- 复用单位就是一个目录：

```text
shared-library/
├── index.json        # 源 + 卡索引（工具维护）
├── sources/<src>.txt / .json
├── cards/<card>.json
└── candidates/
```

  → 备份 / 迁移 / 换机就是拷这个目录；新项目只改配置，不复制内容。

- 参与资源锁的进程会串行写库；外部编辑仍不受锁保护，遗留锁须核对后处理。

跨项目索引：同一目录下的 `zhizhang-projects.json` 记录**所有**被工具用过的根
（`{id, base, name, lastUsedAt}`，只存指针不存正文）。面板项目下拉读它；
摘要（作品 / 章节 / 字数）每次现算，索引丢了会自动重建，**不能**当数据源。

```text
.zhizhang/
├── works/                         # 写作支柱
│   └── <workKey>/
│       ├── meta.json
│       ├── ledger.json
│       ├── brief-crumbs.json
│       ├── payoff-audits.json
│       ├── chapters/
│       │   └── c001.md
│       └── candidates/
│           ├── cand-xxx.json
│           └── cand-xxx.md
├── manuscripts/
│   └── <workKey>.md
├── library/                       # 拆书库
│   ├── sources/
│   │   ├── <sourceId>.json        # 元数据
│   │   └── <sourceId>.txt         # 导入正文
│   ├── cards/
│   │   └── <cardId>.json          # 已采纳技法卡
│   ├── candidates/
│   │   └── <lcandId>.json         # 暂存卡（未 accept）
│   └── index.json                 # 轻量检索索引（含 axis）
└── inspiration/                   # 灵感
    ├── sessions/
    │   └── <sessionId>.json
    ├── candidates/
    │   └── <icandId>.json         # foundation / outline 候选
    └── bindings.json              # workKey→绑定技法卡索引（acceptEmit apply 维护，brief 取卡先读）
```

v2 模块卡可带 `readingEvidence`：包括暂存时源文件校验和、证据章节的阅读程度申报快照。它不证明阅读或卡片质量；旧卡没有该字段时按未声明处理。暂存后书源发生变化时需重新核对并暂存。

## 技法卡采纳中断恢复

拆书库在卡采纳时可能出现 `.zhizhang-card-pending.json`，包含原操作的卡片、索引内容和校验信息。正常完成后会移除；中断后不要删除。使用 `zhizhang_library_list(recovery=inspect)` 检查，无冲突且同一进程的原操作已结束或原进程已停止时用 `recovery=resume`。冲突、记录损坏或书源变化时保留并备份所有文件，人工核对。书源导入、删卡、拆书计划和逐章事实、剧情、节奏及人物分析各有独立恢复记录，使用相同的检查与恢复入口。书源导入、卡暂存、采纳、删除、索引校准及卡采纳恢复使用库目录 `.zhizhang-write-lock` 协调配合的进程；主要拆书分析工具使用同一库锁；底层直接写文件及外部编辑尚不受保护。写锁遗留时不会因超时自动删除，须先确认所有写入进程停止并核对待恢复操作，再人工处理。

## 多书组合

- 过滤：`sourceId` / `sourceIds` / `sourceTitle` / `axis`
- 组合包：`suggestCombo` → `cardIds` = **1 mind + ≤N craft**（可跨 `sourceId`）
- 下游：`inspire_start(card_ids)` 吃全包；`chapter_brief` lean 只注入其中 craft

## 技法卡 schema（节选 · 双轴）

```json
{
  "schemaVersion": 1,
  "id": "card-…",
  "title": "…",
  "sourceId": "src-…",
  "readingRange": "第1-3章",
  "axis": "craft",
  "mechanisms": [{ "name": "…", "experience": "…", "rebuild": "…", "discard": "…", "failWhen": "…" }],
  "humanFeel": {
    "writerCraft": "作家写法（场面取舍/信息怎么漏/节奏或小物）",
    "craftRange": "写法证据出处",
    "characterState": "这一刻场面状态（非声纹、非人设墙）",
    "stateOnPage": "状态落纸手法",
    "allowedEdges": "允许毛边",
    "failAsTemplate": "范文腔即失败"
  },
  "bookCraft": {
    "continueWhy": "章级收束后为何还想翻",
    "adjacentChange": "相邻单元变了什么",
    "failAsShortStory": "短篇闭环即失败"
  },
  "mind": {
    "sellIntoCost": "卖点如何进能力与代价",
    "infoStaging": "信息如何分期",
    "pressureMachine": "关系如何当压力机",
    "debtAndSwap": "长线债与换压",
    "readerContract": "读者合同如何立",
    "failAsEncyclopedia": "百科/设定表即失败"
  },
  "kind": "scene",
  "body": "分析正文",
  "tags": ["…"],
  "status": "accepted"
}
```

- `axis=craft`：主填 humanFeel + bookCraft；喂 **chapter_brief**  
- `axis=mind`：主填 mind；喂 **inspire forge → foundation/outline**；**不**整段灌 lean 正文 brief  
- 旧卡无 `axis`：读时按 humanFeel/mind 推断（默认 craft）  
- 拒收：世界观百科、剧情梗概、声纹/台词范本、泛人设清单、原作名词词条

## 采纳中断恢复

候选采纳期间作品目录可能出现 `.zhizhang-accept-pending.json`，其中有为恢复保存的候选正文和文件校验信息。正常采纳完成后会移除；中断后不要手动删除。先调用 `zhizhang_status(work=作品, recovery=inspect)`，无冲突且同一进程的原操作已结束或原进程已停止时再用 `recovery=resume`。冲突或记录损坏时先保留并备份所有文件，再人工核对。直接保存章节、暂存和扫描候选、简报或兑付留痕另有恢复记录，使用相同的检查与恢复入口；灵感应用使用 `zhizhang_inspire_status(recovery=inspect|resume)`。作品主要写入路径使用作品目录中的 `.zhizhang-write-lock` 协调配合的进程；外部编辑未受保护。异常退出遗留锁时先确认相关写入进程停止并核对记录，处理遗留锁后再检查或恢复采纳；不会仅凭超时自动清锁。

## 写作侧

作品 `meta.json` 可选记录作者明确选择的节奏 `pace`（快爽 / 稳推 / 慢燃；旧作品缺省为未指定）、章节 markdown front matter、`candidates/cand-*.json`（含 `lintPassToken`；编辑产物可带 `editOf` / `editMode`；`wordCount` 在 stage 时落盘，面板轮询不再逐条读正文）。

章节 id / 候选 id 规则：单个路径段（禁 `/`、`\`、`.`、`..`、控制字符、Windows 保留名），允许中文；工具与 HTTP 共用同一校验（`bad_id`）。

- Accept 组合 HumanFeelGate + NovelSenseGate；三 audit **只诊断不签发** lint token  
- `chapter_brief` 顶部「本书读者合同」；lean 默认方法仅 `style_contract`  
- accept 后 happened 按章短追加（`[c00x]` 去重）；brief n≥2 **注入前章正文全文**（ending/happened 作索引；旧 `bodyTail` 兼容）  
- Outline：`stateLens` 写场面状态/写法取舍（旧 `voiceTone` 可读兼容）

## 离线备份与迁移

停止全部相关写入进程后，可用 `node scripts/backup.mjs --source <目录> [--source <目录> ...] --output <新目录>` 备份作品、灵感及独立配置的拆书库；用 `node scripts/backup.mjs --verify <备份目录>` 校验。符号链接只保留链接本身，不包含目标；备份不保证权限、时间戳或断电持久性。脚本不覆盖目标、不自动恢复、不迁移旧数据；恢复前应人工核对来源、目标及未完成记录。

## 成稿汇编

汇编在作品锁内读取章节；符合筛选条件的章节缺失或损坏时终止，保留已有成稿。自定义输出相对存储根解析，必须位于 `manuscripts/` 内；目录链接也不能指向源资产目录。
