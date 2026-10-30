# 安装与使用

## 1. 前置
- DSH 桌面版或 CLI `0.2.1-rc.4`（0.2.1 正式版同样适用；0.2.2-alpha 有插件接口迁移，暂不支持）。
- Python 3.8+。Windows 装 python.org 版本并勾选"Add to PATH"；插件会依次尝试 `py -3`、`python`、`python3`。

## 2. 安装
桌面版先启动一次完成初始化，**完全退出**后在终端执行：

```bash
# 装过的先卸再装
dsh plugin --profile desktop remove dsh-writer
dsh plugin --profile desktop add ./dsh-writer-<版本>.tgz
```

CLI 的其他 profile 同理（`--profile web`、`--profile headless`）。重启 DSH。会话里能看到 `writer_enable`、侧栏有「写作台」即装好。

## 3. 配置（可选）
`$DSH_HOME/profiles/<名>/cordis.patch.yml` 里按 id 覆盖（覆盖后整段 config 以此为准）：

```yaml
- id: writer
  config:
    python: 'C:/Python312/python.exe'   # 两种模式共用
    toutiao:
      storageRoot: 'D:/写作/头条'
      requireEditorPass: true           # 送验收前必须经编辑子代理红笔
    fanqie:
      storageRoot: 'D:/写作/长篇'
      requireEditorPass: true           # 定稿前（对话或写作台）必须有"通过"且版本匹配的编辑审读回报
    workbench:
      allowLan: false
```

### 今日头条（`toutiao:`）
| 项 | 默认 | 说明 |
|---|---|---|
| `rootDir` | `outputs/toutiao` | 相对会话工作目录 |
| `storageRoot` | 无 | 绝对路径，设置后忽略 rootDir；也认 `WRITER_TOUTIAO_ROOT` |
| `requireEditorPass` | `false` | 送"待验收"前必须经编辑子代理红笔 |
| `disabledGates` | `[]` | 锁定门禁不可关闭 |

### 番茄长篇（`fanqie:`）
| 项 | 默认 | 说明 |
|---|---|---|
| `rootDir` | `.writer` | 数据目录，相对会话工作目录 |
| `storageRoot` / `worksRoot` / `libraryRoot` / `sourceRoot` | 无 | 固定数据根、作品目录、共享拆书库、本地书源；也认 `WRITER_NOVEL_ROOT` / `WRITER_NOVEL_WORKS` / `WRITER_NOVEL_LIBRARY` / `WRITER_NOVEL_SOURCE_ROOT` |
| `requireEditorPass` | `false` | 定稿前必须审读通过且版本匹配；对话定稿和写作台定稿都受约束 |
| `multiDraft.enabled` | `false` | 同章多草稿统一整理 |
| `disabledGates` | `[]` | 只有 `fanqie.finalize_requires_review` 可关闭 |

审读回报存在作品目录 `writer-reviews/<章 id>/` 下，跟着书走。

### 写作台（`workbench:`）
| 项 | 默认 | 说明 |
|---|---|---|
| `allowLan` | `false` | 允许局域网访问写作台接口（仍检查 Host、Origin 与令牌） |
| `hosts` | 本机网卡地址 | 局域网访问时接受的主机名 |
| `token` | 无 | 访问令牌；配置后在插件详情页「写作台」卡片填写 |

配置里出现未知字段（包括拼错的）时，DSH 加载插件会报错并指出位置。

## 4. 使用
- **今日头条**：新会话说"写一篇头条，题材是……"。Agent 调用 `writer_enable mode=toutiao` 后按 S1–S7 走；"已交稿"会弹作者确认，或在写作台点"采用"。
- **番茄长篇**：新会话说"写番茄长篇"或"续写第 N 章"。Agent 调用 `writer_enable mode=fanqie`，之后按默认链写，用章纲检查、核旧账、派编辑审读；**定稿和 force 覆盖定稿都会弹作者确认**。
- **写作台**：侧栏「写作台」，顶部切换模式。按钮（续写、派编辑、按回报/质检修改、新写一篇）会往最近在这个数据目录用过写作工具的对话发一条以【写作台】开头的消息（Agent 正忙就排队）。从没在对话里用过的目录，按钮是灰的，先在对话里启用一次。
- 一个会话只写一种模式；要换就新开会话。
- 长篇数据备份：`node <插件目录>/scripts/writer-backup.mjs --source <数据根> --output <备份目录>`。
- **插件不会替你发布，也不登录头条或番茄账号。**

## 5. 排错
| 现象 | 处理 |
|---|---|
| `找不到 Python 3.8+` | 安装 Python 或在配置里填 `python` |
| `writer_enable` 报 `NO_AGENT` | 当前调用没有 Agent 作用域，新开会话重试 |
| `writer_enable` 报 `CONFLICT` | 这个会话已经在写另一种模式（或另一角色），新开会话 |
| 头条"已交稿"/长篇定稿一直被拒 | headless 等无审批通道的模式按"拒绝"处理（失败即关闭）；在桌面端操作 |
| 长篇工具说"还没有作品" | 先 `fanqie_project_create`；改过数据位置的话检查 `fanqie.storageRoot` |
| 写作台按钮灰、提示没有会话 | 该数据目录还没有会话用过写作工具；先在对话里启用一次 |
| 抓榜失败 | 预期行为之一：Agent 会改用网页搜索，再不行请你粘贴热榜 |
