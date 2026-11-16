# 五章记账夹具

五章正文均为本测试夹具原创，按 S1 第一卷前五个章纲续写，每章 2000–3000 字（不计空白），不引用任何已出版作品。

- `chapter-01.txt` 至 `chapter-05.txt`：UTF-8 正文。
- `expected/chapter-XX.json`：期望 `LedgerDelta[]`，包含 state、thread、entity.new、knowledge、fact 与 record 的判别联合样例。
- `responses/extract-X.json`：对应 `【阶段】extract` + `第 X 组` 的假模型响应，内容为 JSON 数组文本。
- 每条 delta 的 quote 均逐字来自对应正文；该夹具只供假模型和后续 L-01 / T-02 / ACC-02 使用，不直接写入设定集真源。
