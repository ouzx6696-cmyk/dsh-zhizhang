# 番茄长篇

番茄长篇模式把作品管理、规划、正文和审读放在同一条写作流程中。启用 `writer_enable(mode=fanqie)` 后，Agent 可以使用 `fanqie_*` 工具，作者可在写作台查看和处理作品。

## 常用流程

1. 创建或打开作品，整理作品根基、人物、已有事实和章节规划。
2. 准备当前章节简报，根据章纲、前文和本书约束创作。
3. 保存候选，在写作台或会话中比较、审读，由作者决定采纳。
4. 对当前版本审读并由作者定稿，再按作品进度续写。

已有章纲或正文可以直接从相应步骤开始。详细工具和参数见[长篇工具参考](engine/TOOLS.md)，作品生命周期见[作品与生命周期](engine/COGNITION.md)。

## 方法与审读

插件内含 inspiration-forge（规划）、inspiration-forge-library（参考分析）和 novel-writer（正文写作与编辑）。使用 `fanqie_forge_get` 按需读取方法，使用 `fanqie_method_get` 读取引擎方法资产。

`fanqie_style_lint` 提供语感雷达和 forge 正文体检，命中用于回看。编辑可通过 `fanqie_review_report` 提交问题、位置与修改建议；回报绑定当时的正文版本，正文变化后需重新核对。

`fanqie.requireEditorPass` 默认关闭。开启后，对话和写作台定稿都要求当前正文有编辑通过回报；定稿仍由作者确认。

## 数据与参考

作品默认位于会话目录的 `.writer/`，包含设定、章纲、正文、候选及编辑回报。拆书材料可用于当前分析或整理成参考库，再由作者选择用于规划。目录、备份和中断恢复见[数据与备份](engine/DATA.md)；拆书流程见[参考分析与拆书](engine/DISSECT.md)。
