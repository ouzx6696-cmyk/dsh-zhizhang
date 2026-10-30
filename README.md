# writer-agent · 写作 Agent（DSH 插件）

在 DeepSeek Harness（DSH）上做的写作 Agent：**一个入口 `writer_enable`、两种写作模式（今日头条 / 番茄长篇）、一个写作台**。

- 宿主基线：DSH `0.2.1-rc.4`（`engines.dsh: >=0.2.1-rc.4 <0.2.2`）
- 运行时：Node.js ≥ 22（建议 24），Python ≥ 3.8（只用标准库）
- 插件包：`dsh-writer`（`bundle/` 目录打包而成）

## 怎么用

普通会话只多一个工具 `writer_enable`。作者说要写什么，Agent 按模式启用，本会话才挂上对应的工具、规则与门禁：

| 模式 | 启用 | 本会话获得 |
|---|---|---|
| 今日头条 | `writer_enable mode=toutiao` | 19 个 `toutiao_*` 工具、常驻总则、4 条门禁：S1 找题 → S2 立项卡 → S3 标题（34 字上限）→ S4/S5 成文红笔（版本只增不改）→ S6 规则质检硬闸（≥84、零 fail、无硬闸）→ S7 交稿单与台账；"已交稿"只能作者确认 |
| 番茄长篇 | `writer_enable mode=fanqie` | 长篇引擎 50 多个 `fanqie_*` 工具（作品、根基、章纲、候选、采纳、审读、定稿、拆书库、汇编）+ 写作层工具（forge 方法 `fanqie_forge_get`、章纲检查、旧账对照、拆书测绘、引文核对、编辑审读回报）+ 长篇门禁（定稿与 force 须作者确认，可选"定稿前须编辑通过"） |
| 编辑子代理 | 再加 `role=editor` | 头条只挂红笔/质检 9 个工具；长篇写入类工具一律拒绝，只能审读、出编辑候选、交审读回报 |

一个会话只能一种模式；要换就新开会话。

## 写作台

DSH 侧栏「写作台」，顶部切换**番茄长篇 / 今日头条**：

- **番茄长篇**：三栏（章节 / 正文与候选对照 / 生命周期、候选、写作 Agent），确认式采纳、审读、定稿；全书概况、参考库、灵感、汇编。右栏「写作 Agent」显示编辑审读结论，一键"续写下一章 / 派编辑审读本章 / 按回报修改"。
- **今日头条**：三栏（文章按状态排好 / 当前稿与交稿单 / 概况、标题、质检、采用、写作 Agent），一键"新写一篇 / 继续推进 / 派编辑红笔 / 按质检修改"，"采用"把已验收的文章标记为已交稿。

按钮发出的是一条以【写作台】开头的普通用户消息，排进最近在该数据目录上用过写作工具的主会话（DSH `sessionController.prompt`，Agent 忙时排队）。

## 目录

```
packages/
  host/        唯一接触 DSH 宿主对象的一层（结构类型 + 能力探测，零 @deepseek-ai 运行时依赖）
  core/        文件与越界检查、Python 运行器、门禁引擎、写作模式与隔离、会话追踪与投递、版本
  workbench/   写作台：server.ts（访问校验、限流、路由组合）+ client/（外壳、番茄长篇、今日头条、共用组件）
  toutiao/     今日头条：工具、总则、门禁、文章存储、写作台接口；skill/ 是规则脚本与方法文件
  fanqie/      番茄长篇：engine/（作品存储与创作工具链）+ 写作层（forge、审读回报、门禁）+ 写作台接口；skill/ 是 forge 方法与规则脚本
  app/         插件入口：writer_enable、配置校验、写作台装配
bundle/        插件包清单（package.json、cordis.patch.yml）；打包后生成 dist/、skill/、skill-fanqie/、scripts/
scripts/       构建（build-client、build-bundle）、架构守卫、长篇数据备份
test/          单元与全流程、engine/（引擎）、dsh/（真实 DSH 组件）、e2e/（真实 dsh headless）
docs/          架构、安装、工具、写作台、番茄长篇、DSH 接口、状态；engine/ 引擎细节；design/ 最初的设计文档
```

## 开发

```bash
npm ci
npm test              # 架构守卫 + Python 规则（头条 205 + 长篇 10）+ Node 84
npm run pack          # 生成 dist-pack/dsh-writer-<版本>.tgz

# 需要一份装好 DSH 的目录（mkdir dshrt && cd dshrt && npm init -y && npm i @deepseek-ai/dsh@0.2.1-rc.4 --ignore-scripts）
WRITER_DSH_RUNTIME=/path/to/dshrt npm run test:dsh          # 真实 cordis + dsh-tools 集成
WRITER_DSH_RUNTIME=/path/to/dshrt npm run test:e2e          # 今日头条：S2→S7 + 编辑子代理
WRITER_DSH_RUNTIME=/path/to/dshrt npm run test:e2e:fanqie   # 番茄长篇：开书→章纲→正文→体检→编辑审读→定稿确认
```

安装见 [docs/INSTALL.md](docs/INSTALL.md)，架构见 [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md)，现状与待桌面确认的事项见 [docs/STATUS.md](docs/STATUS.md)。
