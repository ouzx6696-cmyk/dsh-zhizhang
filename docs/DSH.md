# DSH 宿主接口

插件基线为 DSH `0.2.1-rc.4`，包声明的兼容范围是 `>=0.2.1-rc.4 <0.2.2`。宿主适配集中在 `packages/host`，业务代码不直接依赖 DSH 运行时包。

| 宿主能力 | 插件用途 |
| --- | --- |
| 工具注册与会话作用域 | 注册 `writer_enable`，按模式为当前会话加载工具 |
| 提示段落与执行门禁 | 提供写作规则，处理作者确认与模式限制 |
| 子代理 | 在支持时让编辑子代理审读和生成编辑候选 |
| Web 路由与客户端席位 | 提供侧栏写作台及两种模式的接口 |
| `sessionController.prompt` | 把写作台动作发送到对应的 DSH 主会话 |

写作台投递使用普通会话消息。没有可用的会话控制服务，或当前数据目录尚无主会话时，对应按钮不可用。

## 检查宿主集成

准备一个安装了 `@deepseek-ai/dsh@0.2.1-rc.4` 的目录后运行：

```bash
WRITER_DSH_RUNTIME=/path/to/dsh-runtime npm run test:dsh
WRITER_DSH_RUNTIME=/path/to/dsh-runtime npm run test:e2e
WRITER_DSH_RUNTIME=/path/to/dsh-runtime npm run test:e2e:fanqie
```

宿主流程使用模拟模型；桌面客户端和真实模型的表现需要在目标环境中检查。
