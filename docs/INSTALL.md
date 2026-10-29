# 安装与升级 0.4.0

1. 使用 DSH dsh-v0.2.1-rc.4、Node 24、Python 3.11；先备份原 `.zhizhang/` 和头条目录。
2. 停止 DSH。旧 profile 若单独装过 `dsh-zhizhang`，先移除旧插件及其旧配置行，避免重复注册 `zhizhang_enable`。移除插件不会主动删除作者作品目录。
3. 只安装一个包：

```sh
dsh plugin --profile desktop add ./dsh-writer-0.4.0.tgz
```

插件配置示例：

```yaml
- id: writer
  config:
    python: 'py -3.11'
    zhizhang:
      rootDir: '.zhizhang'
      # storageRoot: 'D:/写作/织章'
      # worksRoot: 'D:/写作/小说'
      multiDraftEnabled: false
    fanqie:
      requireEditorPass: true
```

将原织章配置原样移到这一处 `zhizhang:`，保持原数据路径；原 `fanqie.zhizhang` 配置需要删除。没有改变默认 `.zhizhang/`、章节元数据或原面板接口。无需导入或重写 0.20.0 的作品文件。

重启后确认三个入口可见；写长篇用 fanqie_enable，或直接 zhizhang_enable。织章写作台右栏新增写作 Agent 区块。编辑回报随作品存放；原 0.3.0 外置回报不自动移动，请重新审读，或在备份后将对应作品下的章回报目录复制到作品 writer-reviews 中，保持章 id 目录名一致。

投递按钮必须有同项目主会话最近使用织章的记录。没有目标或宿主未提供 sessionController 时返回明确错误，不发送到其他项目或编辑子会话。桌面点击与 Windows 真机仍需人工验收；云端验证见交付报告。
