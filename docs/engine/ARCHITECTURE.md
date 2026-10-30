# 长篇引擎结构

长篇引擎位于 `packages/fanqie/src/engine/`，提供作品、章节、候选、参考库和规划能力。会话工具与写作台接口调用同一套作品操作。

| 路径 | 作用 |
| --- | --- |
| `engine/tools/` | 会话工具的参数、调用与回执 |
| `engine/work-store.ts`、`engine/storage/` | 作品文件、章节、候选、历史与恢复 |
| `engine/domain/`、`engine/services/` | 章节规则、上下文、采纳与诊断 |
| `engine/ports/` | 拆书、规划、方法和质量相关能力 |
| `engine/panel-query.ts`、`engine/panel-enrich.ts` | 写作台所需的作品与章节视图 |
| `review.ts`、`forge.ts` | 编辑回报、写作方法与正文体检 |
| `workbench/` | 长篇模式的写作台接口和会话动作 |

章节有一份现行正文；候选用于比较和选择，采纳后进入工作稿。正文、章纲、审读和前文依据发生变化时，相关候选和回报需重新核对。

写作台按需读取正文与候选；表达扫描使用现有文本规则，结果可在页面中查看和修改。数据位置和恢复入口见[数据与备份](DATA.md)，日常创作步骤见[作品与生命周期](COGNITION.md)。
