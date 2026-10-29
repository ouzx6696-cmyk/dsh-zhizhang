# 安装与升级 0.5.0

需要 DSH `dsh-v0.2.1-rc.4`、Node 24（≥24.9）、Python 3.11。升级前备份头条目录、`.zhizhang/` 和新增的 `.writer/`。

```sh
dsh plugin --profile desktop add ./dsh-writer-0.5.0.tgz
```

只安装 `dsh-writer`。如曾单独安装织章，移除旧插件与配置行，保留作品文件。原织章配置原样放在顶层 `zhizhang`，不要再配置 `fanqie.zhizhang`。

```yaml
- id: writer
  config:
    # python: 'py -3.11'
    compatibilityEntry: false
    workflow:
      review: quick
      maxAutoRevisionRounds: 2
    zhizhang:
      rootDir: '.zhizhang'
      # storageRoot: 'D:/写作/织章'
      # worksRoot: 'D:/写作/小说'
      multiDraftEnabled: false
    fanqie:
      requireEditorPass: false
```

`rootDir` 相对项目目录，`storageRoot` 指定织章存储根，`worksRoot` 单独指定小说集合目录；三者含义不互换。头条继续使用原顶层 `rootDir/storageRoot` 配置。

默认只有头条、番茄两个启动入口，`fanqie_enable` 自动加载小说引擎。旧自动化仍需 `zhizhang_enable` 时可设置 `compatibilityEntry: true`；已有正文、候选、回报和面板 API 不迁移。

旧配置 `fanqie.outputsDir` 仍可读取，但当前审读回报存于作品目录，该配置不再决定回报位置。

任务写入项目 `.writer/tasks/`，导出写入 `.writer/exports/`。重启后在原项目主会话启用对应模式，再通过任务 ID 恢复。面板不能创建 DSH 会话，必须显式选择已启用的主会话。小说右栏只投递到已明确打开该作品的主会话；同一作品有多个主会话时，请在任务页选择。

异常退出若留下任务写锁，系统不会自动清除；请先确认没有其他写入进程，再核对锁文件及任务记录。

`workflow.review` 支持 quick/editor/manual；独立编辑依赖 DSH 的子代理工具，失败时可由作者切换快速或人工审读。`maxAutoRevisionRounds` 为 0–5，达到上限需作者决定。切换审读方式不取消底层 QA 与版本门禁。`fanqie.requireEditorPass: true` 要求独立编辑的当前版本有效回报；人工模式也不能绕过。

0.3.0 外置历史审读回报不自动迁移；原稿不需重建。真实模型写作、Windows/macOS 桌面体验必须在目标环境验收，不能用模拟模型的宿主测试代替。
