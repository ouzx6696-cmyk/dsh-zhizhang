# DSH 插件发行核对

本页记录织章 0.20.0 的发行核对；官方规则沿用下列固定来源，不把 DSH 官方 monorepo 的 workspace 约束当作第三方包必须复制的布局。

## 官方来源

2026-10-27 读取官方仓库 `deepseek-ai/DeepSeek-Harness`，固定提交为 `22ddee3792402c3e70ec5f86a63c3e3e895a2f60`，该 checkout 的宿主版本为 0.2.1-rc.3。0.19.0 另按同仓库的插件开发教程（插件、工具、配置、生命周期、服务与事件）、`packages/client/AGENTS.md` 客户端规则、`docs/web-styling.md` 与 `docs/ui-radius.md` 复核。

- [打包与安装插件](https://github.com/deepseek-ai/DeepSeek-Harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/user/develop/basic/publish.zh.md)：组合包 manifest、profile、patch、Git 安装与预构建 tarball。
- [客户端模块规则](https://github.com/deepseek-ai/DeepSeek-Harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/packages/client/modules/README.zh.md)：客户端声明、导出、加载及共享模块。
- [兼容性声明](https://github.com/deepseek-ai/DeepSeek-Harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/upgrade-guide/v0.2.1-alpha.3/plugin-engines-dsh/guide.zh.md)：`engines.dsh` 优先，其次 DSH peer 范围。
- [CLI 选项位置](https://github.com/deepseek-ai/DeepSeek-Harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/upgrade-guide/v0.2.1-alpha.1/plugin-option-placement/guide.zh.md)：`--profile` 位于转发给包管理器的命令之前。

## 本包核对

| 要求 | 织章对应实现 |
| --- | --- |
| 组合包声明 `dsh.bundle.patch` | 指向包内 `./cordis.patch.yml` |
| patch 按安装后的包名引用插件 | 插入 `name: dsh-zhizhang`，不用开发机绝对路径 |
| 运行时入口和相对模块已构建 | `main`/exports 指向 `dist/index.js`，类型指向 `dist/index.d.ts`，完整 dist 一起打包 |
| 客户端有 web 声明及导出 | `dsh.client.platform=web`，导出 `./client` 到 `dist/client.js`，按 ModuleLoader 注册 |
| 客户端为 lazy-CJS factory，仓库外自行复刻构建 | `scripts/build-client.mjs` 用 esbuild 打包；React 为唯一静态外部模块，宿主 ui-primitives 通过同一 require 可选获取 |
| 插件导出 `Config` 供加载时校验 | `src/lib/config-schema.ts`：宿主有 Schemastery 时生成 Schemastery 对象，否则导出等价的 Standard Schema；可选 peer 依赖 |
| 样式随插件停用回收 | 样式表带 `data-plugin`/`data-plugin-css`，只用 `--dsw-*` 主题变量 |
| 宿主路由按应用基址解析 | 面板请求以 `document.baseURI` 解析 `api/dsh-zhizhang/*` |
| 运行时文件包含在发布清单 | `files` 包含 dist、bundle patch、离线备份脚本及当前说明，不含历史档案、开发检查脚本、作品数据或 node_modules |
| 分发预构建代码 | npm 格式 `.tgz` 作为标准安装附件；ZIP 提供同一套预构建文件的便捷解压形式 |
| 正确区分加载与按需启用 | CLI 安装自动登记当前 bundle；Agent 会话仍须调用 `zhizhang_enable` |

第三方包不需要仿照官方 workspace 的 `private:true`、内部目录布局或 monorepo 构建脚本。官方推荐 `pnpm pack`；本仓库使用 npm 的同格式 `npm pack`，先构建校验，再打包实际文件。

## 安装和升级提示

```bash
dsh plugin --profile desktop add ./dsh-zhizhang-0.20.0.tgz
```

desktop profile 应先由桌面程序初始化，再完全退出桌面程序运行 CLI。当前 CLI 会将声明了 `dsh.bundle` 的包加入 bundles；旧 CLI 或手工依赖安装需核对实际 profile。用户 patch 覆盖整行 config，不能假设逐键合并。

Git 安装可能需要用户允许 prepare 构建；预构建 tarball 避免让用户为了编译插件而开启 Git 依赖构建。GitHub 自动附带的 Source code 不是专门整理的预构建发行附件。

本包保持 Node ≥22 声明，实际宿主还须满足其自己的运行时要求。目前未添加无法据实验证的 `engines.dsh` 范围；未被版本门禁拒绝不等于兼容性已经证实。真实 DSH 桌面、Windows 和反向代理仍需实际验收，不能仅凭源码阅读或模块测试宣称通过。

GitHub Release 应固定到准备完成的源码提交，附版本说明、预构建 tarball/ZIP 和 SHA-256 校验值。发布到 GitHub 不等于发布到 npm。
