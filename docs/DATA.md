# 本地落盘模型

> 认知入口：[COGNITION.md](./COGNITION.md) · 卡口径：[PILLARS.md](./PILLARS.md) / [QUALITY.md](./QUALITY.md)

默认根目录：`<会话 cwd>/.zhizhang/`（可被 `working_dir` / `storageRoot` 覆盖）。无 Postgres。

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
    └── candidates/
        └── <icandId>.json         # foundation / outline 候选
```

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

## 写作侧

作品 `meta.json`、章节 markdown front matter、`candidates/cand-*.json`（含 `lintPassToken`；编辑产物可带 `editOf` / `editMode`）。

- Accept 组合 HumanFeelGate + NovelSenseGate；三 audit **只诊断不签发** lint token  
- `chapter_brief` 顶部「本书读者合同」；lean 默认方法仅 `style_contract`  
- accept 后 happened 按章短追加（`[c00x]` 去重）；brief n≥2 **注入前章正文全文**（ending/happened 作索引；旧 `bodyTail` 兼容）  
- Outline：`stateLens` 写场面状态/写法取舍（旧 `voiceTone` 可读兼容）
