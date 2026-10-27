# 业务契约与入口

Ports 保留业务能力与策略的公开名称。共同作品操作在 work-store 与 storage/chapters 中实现；工具和面板都调用它们，不另建定稿或修订规则。

| 操作 | 前提 | 一起成立的结果 |
| --- | --- | --- |
| stageCandidate | 目标章存在、正文非空 | 候选正文和元数据一致，不改正式章 |
| acceptCandidate | 目标版本及上下文匹配，定稿修订须 force | 当前章、目录、候选采纳标记和核心留痕一起恢复 |
| updateChapter | 实际修改范围；可传 expectedRevision | 直接保存、定稿/审读声明及修订走共同逻辑 |
| status=reviewed | expectedRevision 为实际已读版本 | 保存主体、结论、正文和依据版本的审读声明 |
| status=final | 当前审读通过、依据未变、依赖前章已定稿及真实授权 | 当前版本定稿并登记接续来源 |
| acknowledgeRevision | 当前 expectedRevision | 清除本章已核对提示，不改变旧候选或正文 |
| applyPlanning | 明确 apply；绑定作品时依据未变 | 对应规划与应用标记、必要引用一致 |
| reference analysis | 指定原文和问题 | 局部报告/迁移包；显式 save 才保存工作区成果，不入公共库 |

扫描和内容审读分开。已有扫描凭据过期会拒绝，未预扫的候选在采纳时扫描。显式 strict 策略按当前扫描命中判断。

旧候选无 targetRevision 时需 expectedRevision；不能让 force 充当基线绕过。明确 append 是向锁内当前正文追加，不是替换旧基线。

成功、未写入而拒绝、待恢复的部分状态分别表达。恢复使用固定目标白名单与哈希，不能把外部 JSON 当任意文件写入计划。细节见 [DATA.md](DATA.md)。
