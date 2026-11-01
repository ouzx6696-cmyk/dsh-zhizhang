# 资产：清单、更新与扩展

"资产"指模型写作时读取的方法论与规则：方法、语料、模板、案例，以及质检规则脚本。分三类：

| 类 | 在哪 | 谁改 | 怎么读 |
|---|---|---|---|
| 上游原件 | `packages/toutiao/skill`（toutiao-viral-writer）、`packages/fanqie/skill/forge`（inspiration-forge-suite） | 只通过「导入新版」更新，不手改 | `toutiao_method_get`、`fanqie_forge_get` |
| 本项目自写 | 两个桥接脚本、长篇规则测试、长篇引擎内置方法资产（`fanqie/src/engine/method-assets.ts`） | 直接改，改完重建清单 | 桥接脚本由工具调用；内置方法用 `fanqie_method_get` |
| 默认方案 | `packages/toutiao/profiles/default`、`packages/fanqie/profiles/default`（从原件提炼重写的精炼版，模型默认读它） | 直接改，改完重建清单（见 [PROFILES.md](PROFILES.md)） | `toutiao_method_get`、`fanqie_forge_get`（当前方案为默认时） |
| 作者自备 | 配置 `toutiao.assets.dirs` / `fanqie.assets.dirs` 指定的目录 | 作者自己 | `toutiao_method_get` / `fanqie_forge_get`，id 为 `user:相对路径` |

## 清单（assets/）
- `assets/sources.json`：来源登记与更新预设。每个来源写明模式、版本、在仓库里的位置、上游目录名与识别文件、版本号从哪读（`versionFrom`）、代码里哪些地方写着这个版本号（`versionRefs`）、登记表（头条的 `METHOD_FILES`）、本项目放在上游目录里的文件（`local`，导入时保留）、有意改过的上游文件（`patched`，导入时不覆盖、列为需人工合并）。
- `assets/manifest.json`：生成的清单，每个文件一行：来源、类别（入口 / 方法 / 语料 / 模板 / 案例 / 规则 / 测试 / 内置 / 其他）、出处（upstream / local / patched）、可加载 id 与工具、字节数、SHA-256。随插件包一起发布（包内 `assets/`），用来核对装的是哪一版。
- 现状（0.7.1）：toutiao-viral-writer 4.0.0 共 44 份、可加载 30；inspiration-forge-suite 1.3.0 共 124 份、可加载 111；长篇桥接与测试 2 份；引擎内置方法 12 项。上游原件 167 份与原件逐字节一致，本项目文件 15 份（含引擎内置 12 项）。

命令（先 `npm run build`，引擎内置方法从构建产物读）：

```bash
npm run assets -- manifest     # 重新生成清单
npm run assets -- check        # 清单、登记表、版本号是否与磁盘一致；npm test 也会跑
```

`check` 拦这些情况：清单过期；上游原件被手改而没登记到 `patched`；头条 `references/`、`corpus/`、`templates/` 下有文件没登记到 `METHOD_FILES`（模型取不到）；登记表指向不存在的文件；`sources.json`、原件、代码里的版本号对不上。

## 更新上游方法论（预设流程）
拿到上游新版（目录或 zip 都行；没标 UTF-8 的 Windows zip，中文文件名也能正确解开）：

```bash
# 1. 先比对，不落盘：列出新增、修改、删除、需人工处理
npm run assets -- import toutiao-viral-writer ~/下载/toutiao-viral-writer-4.1.0.zip
npm run assets -- import inspiration-forge-suite ~/下载/inspiration-forge-suite-1.4.0.zip

# 2. 确认后应用
npm run assets -- import toutiao-viral-writer ~/下载/toutiao-viral-writer-4.1.0.zip --apply
```

`--apply` 会：覆盖新增与修改的文件、删除上游已删的文件；保留 `local` 里的本项目文件；`patched` 里的文件不动、列入"需人工处理"；把 `sources.json` 与 `versionRefs` 里的版本号改成新版；重建清单并立即跑一次检查；报告存为 `assets/updates/<来源>-<新版本>.md`。

应用之后：
1. 看报告的「应用后检查」。头条新增了方法文件，就在 `packages/toutiao/src/methods.ts` 的 `METHOD_FILES` 加一行，再 `npm run assets -- manifest`。上游删了文件而登记表还指着它，删掉那一行。
2. 上游改了质检规则（`scripts/rules.py` 等）时，跑 `npm run test:py`，必要时同步 `packages/toutiao/src/brief.ts` 的常驻规则说明。
3. `npm test`（方法加载测试会逐份真实加载），再写 CHANGELOG。

## 作者自备资产
在配置里指定目录（绝对路径，或相对会话工作目录）：

```yaml
- id: writer
  config:
    toutiao:
      assets:
        dirs: ['我的头条方法', 'D:/写作/语料']
    fanqie:
      assets:
        dirs: ['D:/写作/长篇笔记']
```

- 目录里的 `.md`、`.txt`、`.json` 按相对路径成为 id：`我的头条方法/标题/养老题.md` → `user:标题/养老题`。`toutiao_method_get id=list`、`fanqie_forge_get id=list` 会列出来。
- 只读，不覆盖自带方法；与自带方法、质检规则或门禁冲突时以自带为准（工具说明里也这样告诉模型）。
- 限制：单份不超过 256KB，每个目录最多 300 份、最深 4 层；隐藏文件、`node_modules`、`__pycache__` 跳过；两个目录有同名 id 时用先列的那份并给出提示；目录不存在只提示不报错；id 不能越出目录。
- 作者自备资产不进清单，也不随插件包发布。

## 扩展预留
- **新配置项**：`assets` 段现在只认 `dirs`，其余键报错（防止拼错悄悄不生效）。以后要加（例如按 id 停用自带方法、指定常用目录）在 `packages/core/src/user-assets.ts` 的 `AssetsConfig` 和 `KNOWN` 登记，两种模式自动生效，再补 INSTALL.md 的表。
- **新上游来源**：在 `sources.json` 加一项（`kind: "upstream"`，填 `dest`、`upstreamRoot`、`marker`、`versionFrom`、`versionRefs`、`tool`；需要登记表就加 `registry`），资产命令与检查无需改代码。只有新的登记表形态（不是头条 `METHOD_FILES` 也不是 forge 按路径取）需要在 `scripts/assets.mjs` 的 `idFor` 与 `check` 各加一个分支。
- **新写作模式**：照现有两个模式，在 `sources.json` 加它的来源，配置段加 `assets`（调用 `parseAssetsConfig`），方法工具接 `listUserAssets` / `getUserAsset`。
- **清单格式**：`schemaVersion: 1`。字段只增不改；要改含义时升版本号，`check` 按版本分别处理。
