# 独立客户端（0.9.1 开发版）

独立入口位于 `apps/desktop`，使用 Electron、React 和 Pi SDK。头条与长篇工具、候选、审读、方法方案继续与 DSH 入口共用。发行包见 [v0.9.1](https://github.com/ouzx6696-cmyk/dsh-zhizhang/releases/tag/v0.9.1)，客户端仍属开发预览。

## 开发

开发环境使用 Node.js 22.19+（建议 24）和 npm，运行规则脚本还需 Python 3。首次 `npm install` 会准备 Electron 开发运行时。

```bash
npm install
npm run desktop:dev
```

`WRITER_PYTHON` 可以指定 Python 可执行文件。应用中先选择长篇数据根（包含 works，或一个空目录）或头条文章目录，再保存模型连接。默认接口格式为 OpenAI 兼容；Key 使用 Electron safeStorage 保存，模型运行时从内存获取，不写入另一份模型配置。

写作台保留原操作；“对话”显示对话区域，“刷新对话”重读对应 Pi 会话，“查看更早消息”继续读取历史。宽窗口为对话单独留位，窄窗口使用抽屉。编辑通过 `writer_review` 运行，采用与定稿仍由作者决定。方法方案的原内容不变，“方法目录”可指定既有用户方案根目录。

打开文章或章节后，自由输入会携带发送时的对象与已加载版本；切页不改变已经发送的任务。对话分别显示当前阅读与运行对象，其他作品仍在运行时，顶部提供返回和停止入口。编辑工具结果会显示实际审读或质检摘要，并可回到对应章节、文章。

查看已保存对话不需要先连接模型。Agent 触发的作者确认使用原生对话框；停止任务会取消等待中的确认。保存模型连接会停止当前任务，保留历史与作品文件。

应用数据保存在 Electron userData 下；作品和方法方案保存在所选目录。Pi 会话按模式、根目录和作品关联，工具顺序执行。停止请求不撤销已经保存的稿件。

## 构建

```bash
npm run desktop:build
npm run desktop:pack       # Windows NSIS 安装器；Linux 交叉构建需 Wine
npm run desktop:portable   # Windows 免安装 ZIP
```

build 包含公共 TypeScript 与桌面 TypeScript 检查、资产准备、Main/Preload/Renderer 构建。pack 生成 Windows x64 NSIS 安装包，准备固定版本、带 SHA-256 校验的 Windows CPython，并放入包外资源目录。Python 运行包来源与版本记录在资源中的 writer-runtime.json；随运行包保留其许可证文件。首次打包需要访问 GitHub 和 Electron 发行资源。

Windows x64 为本版安装包目标；macOS/Linux 可用于源码开发，不宣称相应平台已完成安装包支持。客户端实际桌面交互、真实模型及 Windows 安装运行的核对结果需以本次工作记录为准。

DSH 插件仍由 `npm run pack` 生成，不包含 Pi/Electron 运行依赖。独立版与 DSH 不同时写同一作品。

## 既有业务配置

需要启用原有可选能力时，在应用 userData 下的 `writer.json` 填写 `toutiao` / `fanqie` 配置，例如：

```json
{
  "toutiao": { "requireEditorPass": true },
  "fanqie": { "requireEditorPass": true, "multiDraft": { "enabled": true } }
}
```

字段沿用现有配置解析器；作品根以界面所选目录为准，Python 以应用运行资源为准。更改此文件后重启应用。

本次实现与未验证范围见 [0.9.1-IMPLEMENTATION.md](0.9.1-IMPLEMENTATION.md)，设计依据见 [0.9.1-OPTIMIZATION.md](0.9.1-OPTIMIZATION.md)。
