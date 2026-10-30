# 方法方案：默认、原版与用户方案

模型写作时读取的方法论（方法、语料、模板、案例）按"方案"组织，两种写作模式各有一套，互不影响。

| 方案 | 是什么 | 能否修改 |
|---|---|---|
| 默认 | 插件自带的精炼版：从原版提炼重写，去重、去空话，判据对齐质检规则、门禁与真实工具。**新装插件就用它** | 只读（随插件版本更新） |
| 原版 | 上游原件（toutiao-viral-writer 4.0.0、inspiration-forge-suite 1.3.0），一字未改 | 只读（经 `npm run assets -- import` 更新） |
| 用户方案一、二…… | 作者提交的版本：以默认或原版为底，逐份覆盖或新增 | 可改 |

## 读取顺序
1. 用户方案里有这份 → 用用户的；
2. 否则用它的底（默认或原版）；
3. 默认里没有的 id 回落到原版（如头条的 `template-card` JSON 模板）。

几个写法：
- `原版:s3-headline` / `默认:edit` 强制读某个内置方案；
- 长篇原版 forge id（如 `novel-writer/references/editor_method`、只写 `references/writing`）在默认方案下自动对到同类方法（`edit`、`write-chapter`），对照表在 `packages/fanqie/profiles/default/profile.json` 的 `aliases`，111 份原件都有归宿；
- `user:相对路径` 仍是配置目录里的作者自备资产（见 [ASSETS.md](ASSETS.md)），与方案并存。

## 默认方案的内容

**今日头条**（30 个 id，与原版一一对应）：`overview`、`s1-hot` … `s7-delivery`、`template-delivery`（`template-card` 沿用原版）、16 份语料 `corpus-*`。
- 病型、六维评分、硬闸、立项卡字段按 `qa_check.py` / `rules.py` / `card.ts` 的实际逻辑重写，每条标明"机检 / 部分机检 / 编辑判断"；
- 修正了与代码冲突的旧说法（如结尾提问须含"评论区 / 你怎么看 / 聊聊 / 留言"之一、直接引语五处才拿满细节分、段长过整齐是 ai 维最大扣分项）；
- 语料统一为"适用 / 读者与处境 / 现场与细节 / 人会这么说 / 读者真问题 / 好角度 / 雷区"，删掉成品金句与无出处的硬数字；对标范文补了长图文资讯线与故事线（本地质检 88 / 91 / 93 分）；
- 母题库二级标题与 `rules.py` 的 MOTIFS 名单逐项一致（测试锁定）。

**番茄长篇**（17 个 id，原 111 份合并而成）：

| id | 内容 |
|---|---|
| overview | 从开书到定稿的流程地图与方法目录 |
| plan-foundation | 开书立项：卖点、主角、规则、节奏档位、读者承诺 |
| plan-structure | 卷幕结构：四层互锁、天堑前置、自增殖危机链、互换判据、幕转章纲 |
| plan-outline | 章纲 8 字段逐个怎么写（按 `fanqie_outline_check` 的真实规则） |
| library | 拆书与参考分析（九步工具链、拆解卡字段、引用边界） |
| write-chapter / scene / prose / rhythm / continuity | 写章流程、场景手法、句面与人味、节奏档位、连续性与旧账 |
| platform | 番茄连载要点（无出处的平台数字标"以作家后台当期显示为准"） |
| edit / revise | 编辑审读（与 `fanqie_review_report` 格式完全一致）、受控修订 |
| templates-plan / templates-write / examples-plan / examples-write | 常用模板与精选改前改后对照 |

原件里的自有目录、脚本命令、"写入 xx 文件"全部换成真实工具；编辑只能出编辑候选（以门禁为准）。逐份的来源、删改与修正的矛盾见 `docs/profiles/NOTES-*.md`。

篇幅：头条方法 87KB → 54KB（新增了立项卡逐字段填法与六维拿分表），长篇 forge 原件 567KB → 105KB。

## 怎么用

**写作台**：页头「方法方案」按钮（旁边显示当前方案名）→ 弹窗：
- 左列方案；点「新建方案」起名（留空自动叫"用户方案N"）、选底、可导入若干 .md 文件或整个文件夹（文件名即方法 id，同名覆盖底稿，新名字作为新增）；
- 中列方法清单（筛选；"已覆盖""新增"标记）；「设为当前」「复制」「改名」「删除」（删除须确认，删掉当前方案会回到默认）；
- 右列全文：内置方案只读；用户方案可直接修改「保存这一份」、「对照底稿」、「恢复底稿」，或「新增一份」。

**对话里**（作者明确要求时）：`toutiao_profile` / `fanqie_profile`，action = `list` / `show` / `use` / `create`（`from_dir` 导入会话目录下的文件夹）/ `save`（`text` 或 `file`）/ `reset` / `rename`。删除只在写作台做。编辑子代理看不到这两个工具。

**配置**：
```yaml
- id: writer
  config:
    profilesDir: 'D:/写作/方法方案'   # 可选；默认 $DSH_HOME/writer/profiles
    toutiao:
      profile: 用户方案一               # 可选；固定方案，写作台与工具都不能切换
```

## 存放
`<方案目录>/active.json` 记各模式当前方案；`<方案目录>/<mode>/user-N/profile.json` + `methods/<id>.md` 是用户方案。方案目录按 配置 `profilesDir` → 环境变量 `WRITER_PROFILES_DIR` → `$DSH_HOME/writer/profiles` → `~/.dsh-writer/profiles` 取第一个。

限制：每种模式最多 20 个用户方案、每个方案最多 300 份、单份最大 256KB、方案名最多 24 字；方法 id 不许越级或含 `< > : " | ? *`。

## 维护默认方案
- 文件在 `packages/<mode>/profiles/default/`，`profile.json` 是目录（顺序、标题；长篇另有 `aliases`）。改了内容后 `npm run assets -- manifest`，`npm test` 会核对：目录与文件一致、只提真实工具名、不残留脚本命令、长篇别名覆盖全部原版 id、母题库名单一致。
- 上游出了新版：先按 ASSETS.md 导入原版，再看新增内容值不值得提炼进默认方案；新增的原版 forge 文件要在 `aliases` 里给归宿（测试会拦）。
