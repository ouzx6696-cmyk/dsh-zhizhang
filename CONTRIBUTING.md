# 开发与维护

织章是 DSH 插件。源码、发行产物、作者资产分别管理：本仓库维护实现和说明，`.zhizhang/` 等运行数据属于作者，不进入源码提交。

## 本地开发

需要 Node.js ≥22 和 npm。仓库以 Node 22、24 为 CI 检查范围。

```bash
npm ci
npm run check
```

| 命令 | 用途 |
| --- | --- |
| `npm run check` | 日常完整校验：架构护栏、构建和全部测试 |
| `npm test` | 构建并运行四个文件中的行为测试 |
| `npm run build` | 编译 TypeScript，并用 esbuild 把 `src/client/` 打包为 ModuleLoader 格式的 `dist/client.js` |
| `npm run build:check` | 检查类型并在内存中打包、校验客户端，不写构建产物 |
| `npm run typecheck` | 只运行 TypeScript 检查 |
| `npm run guard` | 检查依赖方向、运行时循环及禁止关闭类型检查 |

插件没有独立开发服务器。客户端与宿主集成需要实际 DSH；仓库检查可以在不启动宿主的情况下运行。

## 目录分工

```text
src/index.ts           宿主挂载与按需启用
src/tools/             工具参数、回执与编排入口
src/lib/domain/        版本、证据、规划及工作流规则
src/lib/services/      采纳、上下文和局部参考分析
src/lib/storage/       文件、锁、历史与恢复协议
src/lib/ports/         参考库、规划、方法、编辑与质量策略
src/lib/work-store.ts  作品、候选、留痕和汇编操作
src/lib/panel-*.ts     作者查询与展示
src/lib/http-api.ts    面板接口及访问检查
src/client/            浏览器半侧源码（JSX + CSS），构建为 dist/client.js
test/                  四类行为测试与隔离辅助
scripts/               架构检查、客户端构建、离线备份
dist/                  提交到仓库的发行代码与类型声明
docs/                  当前说明及历史档案
.github/workflows/     Node 22/24 的同一套检查
```

## 修改原则

先确认本次操作的输入、权威来源、授权范围和最终结果，再决定修改位置。以完整业务行为为单位检查工具、HTTP、面板、状态与恢复，不在不同入口各写一套规则。

- 新能力优先复用共同作品操作；当前章只有一份现行正文，候选和历史不能暗中成为第二份权威稿。
- 写入前核必要版本，涉及多文件一致性时保留明确意图；恢复只处理已验证的固定目标，冲突时停止并保留资产。
- 存储不得反向依赖面板和业务导航；底层文件能力直接引用原语，类型使用 `import type`。
- 不用机械指标替代文学判断，不把扫描、内容审读和作者授权合并。
- 旧工具名、数据和恢复格式有实际使用者；改变兼容行为须明确说明，不能靠静默默认值掩盖损坏。

客户端遵循 DSH 客户端规则：组件只接收 props，不接触 `ctx`；席位通过 `ctx.slots.inject(...)` 等待声明并随插件 fiber 撤销；不在模块级保存“已启用”之类单例状态；用户可见文案集中在 `src/client/copy.js`；样式不写颜色字面量（构建会拒绝），hover 放在 `@media (hover: hover)` 内，中性描边 0.5px，圆角使用 `--dsw-radius-*`。

对应的分层和操作契约见 [ARCHITECTURE](docs/ARCHITECTURE.md)、[PORTS](docs/PORTS.md)。

## 测试与文档

复用现有 domain、workflow、storage、panel 四个测试文件。优先验证用户能观察到的结果、拒绝行为和资产保留；不为每个模块增加长流程或独立烟测。细节见[测试说明](docs/TEST.md)。

源码变化后运行 `npm run check`，把实际生成的 `dist/` 与源码一起提交。文档变化重点核链接、命令、示例参数和包内文件；没有代码变化时不必为文案编写测试。

工具说明表从 `dist/index.js` 的 `__testing.tools` 提取名称、description 和 parameters，使用实际编译结果核对，不另写一套参数定义。示例必须区分“参数模板”和“实际执行结果”。

## 版本与发行

文档整理不自动提升功能版本。功能发版时依次核对：

1. 将相同版本写入 `package.json`、`package-lock.json` 的包元数据及 `src/lib/version.ts`。
2. 在 [CHANGELOG](CHANGELOG.md) 将对应未发布内容整理为新增、调整、修复与升级影响，使用可核实的日期和提交。
3. 运行 `npm run check`，确认源码与 `dist/` 一起更新。
4. 执行 `npm pack --dry-run` 核对清单，或 `npm pack --pack-destination /absolute/output` 生成归档；包应含 `dist/`、bundle patch 和当前说明。
5. 独立解包后核入口及客户端文件，验证按需启用；实际安装和平台兼容只报告真正完成的验证。
6. 核对 Git 状态与远端后再按授权提交、推送；创建 GitHub Release 或发布 npm 需要相应的明确发布指令。

Git 提交、推送、标签、GitHub Release 和 npm 发布是不同状态。当前仓库的版本历史不假设已存在公开发行页或 npm 版本。

## 历史文档

当前使用说明保持一套；旧评估、方案和实施证据保留在 [docs/history](docs/history/README.md)。档案可以解释设计来由，但不能把当年的门禁、路径或测试数量重新变成现行要求。
