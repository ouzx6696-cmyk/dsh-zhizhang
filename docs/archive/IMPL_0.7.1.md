# IMPL 0.7.1 — 多书技法·思维组合面

## 目标
在双轴库上补产品面：按书/按轴筛卡；推荐跨书「1 mind + N craft」组合包。

## 改动
- `LibraryPort.listCards` / `searchCards`：`CardQueryOpts`（sourceId / sourceIds / sourceTitle / axis）
- `LibraryPort.suggestCombo`：恰好 1 mind + ≤N craft；缺 mind → `ok:false` + emptyReason
- 工具：`zhizhang_library_list` / `_search` 增过滤参数；新 `zhizhang_library_combo_suggest`
- inspire 工具描述注明可用 combo 的 `card_ids`
- lean 链不变；brief 仍只吃 craft；不恢复 voice

## 版本
0.7.1（产品面；卡 schema 未破）
