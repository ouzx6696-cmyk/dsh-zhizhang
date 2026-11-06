# 代码规范：正例与反例

配合根目录 `AGENTS.md` 使用。反例都取自本仓库 0.9.7 的真实代码。

## R1 只在信任边界校验

反例（`packages/fanqie/src/engine/ports/library.ts`，工具层已用 `asString` 校验并 trim）：

```ts
const title = String(input.title ?? "").trim();
const tags = Array.isArray(input.replaceables)
  ? input.replaceables.map((x: any) => String(x).trim()).filter(Boolean)
  : [];
```

正例：工具入口解析一次，端口接收类型。

```ts
// tools/library.ts —— 边界
const input = parseStageCard(args);          // 失败抛 WriterError("bad_input")
await LibraryPort.stageCard(paths, input);

// ports/library.ts —— 内部
export async function stageCard(paths: LibraryPaths, input: StageCardInput) {
  const card = { title: input.title, replaceables: input.replaceables };
}
```

IPC 同理：每个通道在 `main/ipc/validate.ts` 有一个解析函数，`handle()` 只把解析后的类型交给处理函数。

## R2 不吞错

反例（`packages/fanqie/src/engine/work-store.ts:174`，索引损坏时返回空列表，下一次写入覆盖所有项目）：

```ts
async function readProjectsIndex() {
  try { ... } catch { return []; }
}
```

正例：

```ts
async function readProjectsIndex(): Promise<ProjectEntry[]> {
  let raw: string;
  try {
    raw = await readFile(projectsFile(), "utf8");
  } catch (err) {
    if (isNotFound(err)) return [];
    throw err;
  }
  return parseProjectsIndex(raw);            // 损坏时抛 WriterError("index_corrupt")
}
```

`.catch(() => [])`、`.catch(() => undefined)` 同样禁止。前端拿到错误要显示，不要显示成“没有数据”。

## R3 不写不可能的分支

反例（`apps/desktop/src/session/tools.ts`，115–125 行的检查在 197–207 行原样重复，第二段永远不执行）：

```ts
if (def.name === "fanqie_chapter_save" && input.content !== undefined && !input.expected_revision) { ... }
// ……80 行后……
if (def.name === "fanqie_chapter_save" && input.content !== undefined && !input.expected_revision) { ... }
```

反例（`packages/app` 时代的写法，配置已校验过仍回退原始值）：

```ts
const fanqie = { ...(parseFanqieConfig(config.fanqie).value ?? config.fanqie ?? {}) };
```

正例：解析失败就报错，成功就只用解析结果。

## R4 一件事一处实现

| 能力 | 唯一位置 |
|---|---|
| 原子写（fsync + 防符号链接）、读 JSON、存在检查、sha256、短 ID、时间戳（UTC ISO） | `packages/core/src/fsx.ts` |
| 路径沙箱 | `core/src/fsx.ts` 的 `resolveInside` |
| 恢复日志 | `packages/fanqie/src/engine/storage/journal.ts` |
| 状态文字、色调、圆点 | `packages/ui/src/status.ts` |
| 用户可见文案 | `packages/ui/src/copy.ts`（写作区与桌面共用） |
| 弹窗、步骤条、按钮 | `packages/ui/src/primitives.jsx` |
| 路由表 | `packages/workbench/src/routes.ts` |
| 错误 → HTTP 结果 | `packages/workbench/src/routes.ts` 的 `sendError` |
| 标题上限、规则版本 | `packages/toutiao/skill/scripts/rules.py` |

新增前先 `git grep`。发现第二份实现，合并而不是再写第三份。

## R5 不留死代码

- 删除前 `git grep -w 名字` 确认无生产引用。
- 只在本文件使用的符号去掉 `export`。
- 旧数据兼容：写一次性迁移（启动时执行一次并记录结果），兼容读取代码在下一版删除。

## R6 按职责组织文件

反例：`workbench-1.css … workbench-10.css`，`.wb-modal` 分散在 5 个文件。

正例：`base.css`、`controls.css`、`chapter-list.css`、`reader.css`、`inspector.css`、`toutiao.css`、`profiles.css`、`overlay.css`（弹窗与提示）。一个组件前缀只在一个文件。

## R7 表驱动替代长 if 链

反例：`packages/fanqie/src/workbench/api.ts` 的 `fanqieRoute`，631 行 if 链，同一段“项目未登记”响应重复 16 次。

正例：

```ts
const routes: Record<string, RouteHandler> = {
  "GET /chapter": withWork(getChapter),
  "GET /candidate": withWork(getCandidate),
  "POST /accept": withWork(acceptCandidate),
};
```

`withWork` 负责解析 base/work、返回统一错误；处理函数只写业务。

## R8 类型诚实

- `readWorkMeta(dir): Promise<WorkMeta>`，不是 `Promise<any>`。
- 不确定的外部数据用 `unknown` 接，在边界解析成类型。

## R9 注释

写“为什么这样做”和非显然的约束。删掉“0.9.3 修复”“兼容旧 import 路径”这类注释和指向不存在文件的引用。

## R10 测试

- 业务测试：`createToutiaoTools()` / `createFanqieTools()` + `createGateEngine()` + `executeTool()`，与桌面生产路径一致。
- 每个 bug 修复配一个修复前会失败的测试。
- 不用正则读源码断言工具名或版本号；从运行结果取。

例外：`test/engine/workbench-ui.test.mjs` 用自建最小 hook 运行时（state／ref／memo／effect 按调用顺序落槽，setState 后 flush 重渲染）在 Node 里驱动写作台组件的真实异步状态流，不引入新测试依赖。它不迁 Playwright：组件级状态流回归要能在无显示环境的 `npm test` 里跑，端到端旅程已由 `test:desktop:ui` 覆盖。改写作台组件状态逻辑时在此补用例。
