# 安装与配置

适用插件版本：**0.18.0**。需要 DeepSeek Harness（DSH）宿主和 Node.js ≥22。React 与客户端运行时由宿主提供；本插件没有独立聊天界面或内置模型配置。

旧安装记录曾在 DSH 0.2.1-rc.2 上验证 0.17.0 的挂载方式。0.18.0 已完成构建与模块协议级检查，但尚未在真实 DSH 桌面重新验收；不同宿主版本的 CLI 和 profile 管理以宿主自身说明为准。

## 1. 准备插件

发行附件优先选择 `dsh-zhizhang-0.18.0.tgz`，它是已构建的 npm 格式 tarball；不必在用户机器上重新编译。也可解压预构建 ZIP 后按目录安装。GitHub 自动生成的 Source code 压缩包属于源码快照，与这两个发行附件不同。

从源码使用：

```bash
git clone https://github.com/ouzx6696-cmyk/dsh-zhizhang.git
cd dsh-zhizhang
npm ci
npm run check
```

仓库包含 `dist/`。如果使用发行压缩包，应确认其中有 `package.json`、`cordis.patch.yml`、`dist/index.js` 和 `dist/client.js`。不要只复制 `src/`；本说明不假设该版本已发布到 npm。

## 2. 挂载并启用 bundle

当前 DSH 官方规则支持直接安装 tarball：

```bash
dsh plugin --profile desktop add ./dsh-zhizhang-0.18.0.tgz
```

使用 desktop profile 前先启动过 DSH 桌面以完成初始化，再完全退出桌面进程执行 CLI 安装。`--profile` 放在 `add` 之前。

如果使用源码 checkout 或解压后的预构建 ZIP，可将路径替换为实际插件目录：

```bash
dsh plugin --profile desktop add link:/absolute/path/to/dsh-zhizhang
```

Windows 含空格路径可使用 `link:"D:/plugins/dsh-zhizhang"`。目录名不承担版本判断，实际版本以包内 `package.json` 为准。

当前官方 `dsh plugin --profile ... add ...` 会识别 `dsh.bundle`，并自动将组合包加入 profile 的 `dsh.profile.bundles`。如果使用旧版 CLI 或手动安装依赖，需检查该列表确实包含 `dsh-zhizhang`；也可按宿主支持的方式在 profile patch 中插入插件，参照仓库的 [cordis.patch.yml](../cordis.patch.yml)。不要同时重复插入同一个插件。

完成后重启相应 profile 或 DSH。Electron 管理的 desktop profile 可能拒绝 CLI `--dump-config`，这时通过桌面侧栏和会话中的启用回执确认。

## 3. 在会话中启用

让 Agent 调用 `zhizhang_enable`，或直接说“启用织章”。挂载阶段只提供这个工具及面板接口；启用后才向当前 Agent 注册完整工具集与必要规则。新 Agent 作用域需要再次启用，同一作用域重复调用不会重复挂载。

确认侧栏出现“织章”，并能在会话中调用 `zhizhang_product_map`。如果缺少 Agent 作用域而报 `no_agent_ctx`，按[排错说明](TROUBLESHOOTING.md)处理。

## 4. 配置存储和面板

配置位于插件插入项的 `config`，示例：

```yaml
- insert:
    - id: zhizhang
      name: dsh-zhizhang
      config:
        rootDir: .zhizhang
        # storageRoot: /absolute/path/to/writing-data
        # worksRoot: /absolute/path/to/novels
        # libraryRoot: /absolute/path/to/shared-library
        # sourceRoot: /absolute/path/to/books
        allowLanPanel: false
        # panelHosts: [writing-host.local]
        # panelToken: replace-with-your-own-token
        multiDraft:
          enabled: false
```

| 配置 | 默认与用途 |
| --- | --- |
| `rootDir` | `.zhizhang`；默认相对于会话 cwd 的数据目录 |
| `storageRoot` | 固定数据根；存放工作区分析、灵感、汇编及默认作品/库目录 |
| `worksRoot` | 默认 `<数据根>/works`；单独指定作品目录 |
| `libraryRoot` | 默认 `<数据根>/library`；可共享参考库 |
| `sourceRoot` | 默认未设置；供按文件名查找本地源书 |
| `allowLanPanel` | 默认关闭；显式允许非本机面板连接 |
| `panelHosts` | 可接受的主机名；未设置时 LAN 列表取本机非回环网卡地址 |
| `panelToken` | 可选访问令牌；配置后本机和 LAN 都必须提供 |
| `multiDraft.enabled` | 默认关闭；可选的同章多草稿统一整理功能 |

覆盖配置时注意：官方 patch 按行覆盖，`config` 是整体替换而不是逐键深度合并，需重述该行仍要保留的设置。

`multiDraftEnabled` 是现有的等价兼容配置。配置字段和环境变量见[数据目录优先级](DATA.md#目录优先级)。独立根建议使用绝对路径，便于工具和面板定位同一批资产。

配置令牌后，在织章设置卡输入令牌，浏览器仅在当前会话保存。开启 LAN 不会取消 Host、Origin 和令牌检查；代理部署还需要在实际环境验收。

## 升级

先停止写入并备份实际数据根，核对 [CHANGELOG 的 0.18.0 升级说明](../CHANGELOG.md#0180)，再替换插件并重启宿主。候选、历史稿和恢复记录属于作品资产，不随插件目录更新而删除。存在未完成操作时先检查原记录，不靠重装插件解决写入冲突。

## 官方依据

本页按 [DSH 打包与安装插件](https://github.com/deepseek-ai/DeepSeek-Harness/blob/22ddee3792402c3e70ec5f86a63c3e3e895a2f60/docs/user/develop/basic/publish.zh.md)核对。清单、客户端和兼容性规则见 [DSH 发行核对](DSH_RELEASE.md)。官方源码说明不等于织章已在所有宿主版本上完成实际安装验证。
