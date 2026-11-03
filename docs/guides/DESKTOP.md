# 桌面客户端

## 开始使用

首次启动依次完成连接模型、选择写作根、开新书或新头条。预设含 DeepSeek、Kimi、通义千问、智谱及 OpenAI / Anthropic 兼容接口；服务商具体模型 ID 与账户权限以其实际提供为准。“测试连接”发送一条最短真实请求，显示延迟。

写手默认 deepseek-chat，编辑默认 deepseek-reasoner 并开启思考；规划默认跟随写手，可单独配置。编辑与规划使用独立上下文，不继承主会话完整聊天。编辑按既有工具权限工作，不替作者定稿。

写作根布局：

```text
写作根/
  novels/作品目录/    # 正文、章纲、候选、审读、版本历史
  toutiao/           # 文章、立项卡、逐版稿件、质检、交稿单、台账
  .writer/           # 小说资料库、规划资源、preferences.md
```

## 写作与作者决定

左侧导航，中间稿纸，右侧 Agent / 本章 / 方法方案。正文上方保留声明已审读、定稿；候选视图提供采纳和对照。小于 1200px 收起章节导航，小于 960px 右栏作为可开关抽屉。

输入 `/` 或 Ctrl+K 打开命令面板，支持新书、续写、改本章、派编辑、拆书、质检、交稿、导出和新对话。快捷动作随当前章节／文章状态变化，使用原写作台的任务文本。Enter 发送，Shift+Enter 换行，Ctrl+S 保存正在修改的段落，Ctrl+1/2/3 切右栏，Esc 停止任务前确认。

## 资料、导出与备份

顶栏提供 TXT、DOCX 与复制正文。头条输出标题和当前稿；长篇只输出已定稿章节。导出前显示残留标记、当前质检与 AI 生成声明提醒；故事或合成人物须按平台要求声明虚构演绎。应用不登录或自动发布到平台。

设置可备份整个写作根，复用既有离线备份脚本，生成新目录和校验清单。采纳候选、头条采用及长篇定稿前会保存轻量文件快照，位于作品的 `.writer-snapshots/`；保留原有逐版稿件与历史。备份、快照不自动恢复或删除作者文件。

恢复入口位于设置「写作根与偏好」。打开待处理作品后，点击「检查占用和未完成写入」；支持的章节／候选／留痕或采纳中断记录可在作者确认、备份并校验后完成原操作。该操作不从备份覆盖整本书，也不会自动删除遗留写锁。活进程、异机来源、文件冲突及其他尚不支持的恢复类型会保留原状并提示核对。

客户端检测 `.writer-workspace-lock.json`（宿主、进程、机器）：另一进程持有作品时只能读取。先关闭另一入口中的作品，再重新打开。进程退出释放自己的锁，同机进程已结束的锁可重取。

## 设置与故障信息

```json
{
  "toutiao": { "requireEditorPass": true },
  "fanqie": { "requireEditorPass": true, "multiDraft": { "enabled": true } }
}
```

## 开发与验证

Node.js 22.19+（建议 24）、npm、Python 3；Windows 可用 `WRITER_PYTHON` 指定 Python。

```sh
npm ci
npm run desktop:dev
npm run desktop:build
npm run test:desktop       # 真实 Pi + 本地假模型，业务与宿主边界
npm run test:desktop:ui    # Playwright 驱动真实 Electron，需桌面环境
```

业务层执行 `npm run verify`；桌面界面检查覆盖引导、作者决策、主题、命令和会话。GUI 需要显示服务，Linux 可使用 `CI=1 DISPLAY=:99 npm run test:desktop:ui`。

## Windows 构建与更新

```sh
npm run desktop:build
npm run pack --workspace @writer/desktop           # 原生 Windows NSIS
npm run pack:portable --workspace @writer/desktop  # 免安装 ZIP
```

模型 Key 使用系统 safeStorage 加密；不可用时仅保留在内存。应用 userData 的 `writer.json` 可使用上面的业务配置。

上下文与费用见[架构说明](../ARCHITECTURE.md#pi-上下文与缓存费用)，已执行验证及发行限制见[当前状态](../STATUS.md)。
