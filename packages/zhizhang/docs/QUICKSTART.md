# 快速开始

先按[安装说明](DSH_INSTALL.md)加载插件，在会话中启用织章。以下 JSON 展示参数形状，实际调用由 Agent 执行。每一步使用工具返回的真实作品 key、候选 ID 和 revision，不照抄占位符。

## 新建作品并准备章纲

可以直接向 Agent 说明：

> 新建《雨夜来信》。这是一本慢燃悬疑，先整理人物和第一章章纲，等我看完再写。

典型工具调用：

```text
zhizhang_project_create
{"title":"雨夜来信","genre":"悬疑","premise":"一封旧信改变了两个人对往事的理解。"}

zhizhang_foundation_set
{"work":"<作品key>","pace":"慢燃","style":"克制叙述，让人物通过行动显露态度。","characters":"女主保留旧信；男主只知道信封曾经遗失。"}

zhizhang_outline_set
{"work":"<作品key>","chapter":"c001","title":"来信","synopsis":"她收到旧信，辨认笔迹，决定先向保管人核实。","beats":"收到信—发现笔迹不符—决定求证","knowledge":"她尚不知道谁寄出了这封信。"}
```

如果目标还很粗略，可以先用 `inspire_start → forge_brief → stage → accept(apply=true)` 发展规划；已有章纲则直接使用，不需要先建参考库。

## 写作与采纳

```text
zhizhang_chapter_brief
{"work":"<作品key>","chapter":"c001"}

zhizhang_candidate_stage
{"work":"<作品key>","chapter":"c001","content":"<Agent 完成并回读的章节全文>"}

zhizhang_candidate_accept
{"work":"<作品key>","candidate":"<上一步返回的候选ID>"}
```

取简报后，Agent 依据材料创作正文。`stage` 只保存候选；`accept` 将其应用为现行工作稿，并内置机械扫描。需要提前查看命中时可调用 `style_lint`，不需要例行增加一次扫描往返。已有扫描记录但正文后来变化，仍须重新扫描。

采纳前可在面板对照正文与候选。编辑、多草稿和诊断均按实际问题启用，不是每章必经流程。

## 审读和定稿

先读取完整正文和必要前文，取得当前 `revision`。正文被截断时先补读。

```text
zhizhang_chapter_read
{"work":"<作品key>","chapter":"c001"}

zhizhang_chapter_save
{"work":"<作品key>","chapter":"c001","status":"reviewed","expected_revision":"<实际已读revision>","review_result":"pass","review_summary":"<本次完整审读的依据、结论与待处理问题>"}

zhizhang_chapter_save
{"work":"<作品key>","chapter":"c001","status":"final"}
```

最后一步须在作者实际授权内执行。发现阻断问题可记录 `review_result=blocked`，该结论不能用于定稿。代码核对版本和依赖，但不证明调用方真正读过，也不代替作者判断。

## 续写与改稿

续章先建立下一章章纲，再取它的 `chapter_brief`。前章尚未定稿也可继续写，简报会把它标为条件工作依据；后章定稿前需先核定依赖前章。

改稿先读取现行版本，再准备候选。定稿正文修改必须明确 `force=true`，原稿留存到修订历史，修改后降回草稿。根据修订提示核对相关后稿；完成后可：

```text
zhizhang_chapter_save
{"work":"<作品key>","chapter":"c001","acknowledge_revision":true,"expected_revision":"<当前revision>"}
```

这只清除本章待核对提示，不会让旧候选或旧审读恢复有效，也不会自动重写后文。

## 换会话、汇编和备份

新会话启用后，使用 `project_list → project_open → status` 找回作品；需要的上下文由该章简报和实际正文恢复。

`zhizhang_assemble` 按章序生成 Markdown，默认收录有正文的章节，不修改章节状态。当前兼容参数 `only_final=true` **同时收录 `reviewed` 和 `final`**，不是“只收最终定稿”；若交付要求全部定稿，应先逐章核对状态和审读依据。

汇编只是文本输出，不能替代备份。备份与中断恢复见 [DATA.md](DATA.md)。
