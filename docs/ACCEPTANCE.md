# 0.9.2 真实模型验收

验收回答实际稿件是否可用，与假模型工具测试分开。目前尚未执行：需要可用模型连接、至少两个真实新闻链接，以及作者评分。没有这些条件时不得宣布默认方案优于原版。

## 执行

```sh
npm run acceptance:prepare -- --output /path/to/acceptance
# 编辑 acceptance-config.example.json：模型、apiKeyEnv、newsUrls、题材
# 在运行环境配置所引用的 Key 环境变量，不把 Key 写进配置或提交仓库
npm run acceptance:run -- --config /path/to/acceptance/acceptance-config.example.json --output /path/to/acceptance
```

输出目录必须是新的验收目录，已有任务不混入另一次运行。也可手动触发 real-model-acceptance 工作流（需配置 WRITER_ACCEPTANCE_KEY secret，输入两个新闻链接组成的 JSON 数组）。真实调用会产生服务商费用。

默认与原版各跑：资讯长图文 3 篇、故事长图文 2 篇、微头条 2 篇；从一句话开书并规划前十章，逐章写作与独立编辑，第六章前开新对话。脚本拒绝代作者定稿和标记已交稿。

作品、质检、审读及 Pi 会话保留在输出目录。run-records.json 记录每篇／章的实际耗时、token 和可取得的费用。未配置模型价格时费用是 null，作者按服务商账单填写 actualCost 与币种，不记作免费。失败记录保留，进程中断或任务文字声称完成都不等于质量过线。

## 汇总和作者判断

在 subjective-scores.json 为每篇文章、每章长篇填写可读性与像人写程度（1～5），记录十章内连续性错误数、第六章新对话后是否无需补充设定、实际费用。填写后只重新汇总，不再次调用模型：

```sh
node scripts/acceptance.mjs --summarize --output /path/to/acceptance
```

metrics.json 和 COMPARISON.md 读取落盘质检、审读与实际任务记录，不根据模型自报给分。建议线按计划：头条首次质检过线率 ≥60%，两次内 ≥90%；编辑通过率 ≥70%，硬伤均值 ≤1；十章连续性错误 ≤2；新对话可直接接续；默认主观均分不低于原版。质检过线同时要求 ≥84、零 fail、无硬闸。

脚本汇总不是最终审稿：作者仍须抽查人名、时间与已发生事实、回报是否对应实际当前稿，判断定价和费用，并作最终决定。未填人工项或未跑全，不视为验收通过。仅在真实比较指出某份方法存在具体问题后修改那一份；本轮不整体改写方法论。
