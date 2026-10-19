# 改动指南 · 只动 Ports · 测试怎么长

> 策略与可演进行为落在 `src/lib/ports/`。工具保持薄。  
> 端口细则：[PORTS.md](./PORTS.md) · 测试规则：[TEST.md](./TEST.md)

---

## 当前（0.15.3）· 按需启用 + 面板多项目

- **作品目录可见化**：新增 `worksRoot`（或 `DSH_ZHIZHANG_WORKS`），作品直接落在
  `<worksRoot>/<书名>/`（meta/chapters/candidates），不再是隐藏的 `<base>/works/`；
  索引与面板摘要记录 works 路径。本机默认布局见 `cordis.patch.yml`（D:/织章）。
- **本地书源目录**：新增 `sourceRoot`（或 `DSH_ZHIZHANG_SOURCE_ROOT`）指向一个书文件夹；
  `library_list` 列出该目录的 `.txt/.md`（已导入/未导入），`library_import` 可用裸文件名导入；
  面板 Library 区显示待导入数量与文件名。只读扫描，不自动导入。
- **拆书库复用**：新增 `libraryRoot` 配置（或 `DSH_ZHIZHANG_LIBRARY`），把 `library`
  指到共享目录；`works / manuscripts / inspiration` 仍按项目隔离。工具与面板读取同一份库。
- **面板多项目**：工具在 `ensureStorage` 时把工作区登记进 `$DSH_HOME/zhizhang-projects.json`
  （只存指针 + 时间，不复制正文）；面板新增 **项目下拉**（`GET …/projects`），
  顶栏 `项目 ▸ 作品` 两级切换。`?base=<项目 id>` 只接受**已登记且存在**的根，
  未知根一律 `400 bad_base`——面板不会退化成任意路径浏览器。
  - 项目摘要（作品数 / 章节 / 字数）每次都从各项目自己的 `.zhizhang` 现算（5s 缓存），
    可重算、可删索引、**不再是权威副本**；项目不可达时保留 `exists:false` 行并标「不可达」。
  - 采纳 / 读章 / 读候选 / 统一整理都跟随面板当前项目（POST body 的 `base` 字段）。


- **按需加载**：profile 挂载只注册一个 `zhizhang_enable`（+ 只读面板 HTTP），
  **不再**每会话注入 46 个工具与 SYSTEM_BRIEF。
  - 触发后按 **Agent 作用域** 挂载 46 tools + 硬规则；仅该会话可见
    （宿主不支持作用域时退化为进程内全局）。
  - 同一 Agent 重复调用幂等；换会话 / 重启后需重新启用。
  - Web 面板仍常驻（读正式章 / 候选 / 真采纳），不依赖工具启用。
- **版本**：`src/lib/version.ts` 单源 `PLUGIN_VERSION`；package / ProductMap / Scheduler / EditPort /
  MultiDraftPort / 面板页脚都引用它（测试断言 0.15.3）。

## 此前（0.15.2）

- **按需启用**：profile 挂载只注册 `zhizhang_enable` + 只读面板 HTTP；触发后按 Agent 作用域
  挂 46 tools + 硬规则。回执直接带 `ProductMap.formatForAgent()`，省一次往返。

## 此前（0.15.1）

- **工程加固（不改默认链 / 不改旁路表）**：
  - **id 沙箱**：章节 / 候选 id 统一在 store 校验（禁 `/`、`\`、`.`、`..`、控制字符、Windows 保留名；允许中文），
    工具与 HTTP 同源；新错误码 `bad_id`。`candidate_stage` / `chapter_save` / `chapter_read` 等全部覆盖。
  - **面板轮询降载**：`GET …/snapshot` 默认**不**返回 HTML（显式 `?html=1` 才带）；
    候选 `wordCount` 在 stage 时落盘（旧数据回退读正文）；章节透镜按 mtime+size 缓存；
    候选正文按 id 加载，不再每 6s 重拉。
  - **面板根对齐**：HTTP 面板跟随最近一次 Agent 工具使用的存储根（`last-agent-tool`），
    不再固定读宿主 cwd（之前会「工具写 workspace、面板看 profile」两套根）。
  - **Web 修复**：切章清空旧正文/标题；snapshot 的 `ok:false` 不再被当成空态；
    `load` 加请求序号防乱序；采纳后强制刷新（防「已采纳仍显示待采纳」导致二次采纳）；
    采纳超时后自动对账；候选轮询不再丢失阅读选区；剪贴板 Promise 兜底；`escapeHtml` 补 `'`。
  - **包**：新增 `scripts/smoke.mjs`（`npm run smoke`，node ≥22，无需 DSH/bun）；
    补 `types`；移除指向不存在源码的 `build/prepare/typecheck/test` 脚本与 devDependencies
    （本目录是发行形态，构建请回源码仓）。
- **版本**：package / ProductMap / Scheduler / EditPort / MultiDraftPort 统一 **0.15.1**。

## 此前（0.15.0）

- **统合切片**：COGNITION/MAP/PORTS/PANEL/STATUS/FRAMEWORK/README 与 package / ProductMap / Scheduler / EditPort / MultiDraftPort 全部钉 **0.15.0**。
- 面板↔工具：snapshot nextHints 含编辑稿/多草稿提示；panel-html 展示 draftLabel/unifyOf；右栏编辑抉择说明卡。
- 前端美化：工作台层次、阅读区、模式切换、空态/徽章（同主题变量）。
- **不改**：默认链；multi-draft 默认关；无 Tiptap；无静默写章；audit 不进默认链。

## 此前（0.14.0）

- **可选多草稿 + 统一整理（默认关）**：`PortConfig.multiDraftEnabled` / 插件 `multiDraft.enabled` / env `DSH_ZHIZHANG_MULTI_DRAFT=1`。
- 同章可多次 `candidate_stage(draft_label)`（关着也能 stage）；`unify_brief` / `unify_stage` 须开启。
- 整理稿 `source=unify` + `unifyOf`；仍走 lint → accept；**不进默认 nextHint**。
- 面板：列出全部待采纳标签；开启后「统一整理」→ `POST …/unify/prepare` 只返回 brief。
- 默认链负重与 0.13 相同。

详见 [PORTS.md](./PORTS.md) · [TOOLS.md](./TOOLS.md) · [PANEL.md](./PANEL.md)。

## 此前（0.13.0）

- **小说阅读工作台（默认）**：三栏（章节 / 正式章正文 / 状态与闸）；轻量 MD 只读；候选对照；`localStorage` 记作品+章。
- **按需读正文**：`GET …/chapter`、`GET …/candidate`；snapshot **仍无**全文。
- **管线五 Tab** 保留为顶栏「管线」次级视图。
- **真采纳**不变（confirm + AcceptPolicy）。
- 当时未做：Tiptap、页内起草、面板 A/B/C、静默写库。


## 此前（0.12.0）

- 完整 Web 控制台五 Tab + 真采纳 + 自动刷新 + settings 卡。
- `GET …/library`、`GET …/inspiration`；HTML 对齐。

---


## 总则

| 可以 | 不可以 |
|------|--------|
| 改 Port 实现或 `PortConfig` | 在工具 `execute` 里新写 if-硬闸 |
| 给 Gate 加可选 flag（默认软） | 把禁词命中默认升级为硬拒质量法 |
| 扩展 MethodRegistry 资产 id | 把整包方法灌进 `SYSTEM_BRIEF` |
| 经 Audit 端口换传感器实现 | 让 AI / bash 直写 `chapters/` / `library/cards/` |
| 扩展 Library / Inspiration 契约 | 用 foundation notes 假装技法卡已入库；静默 foundation_set |
| 改 Scheduler 默认线/旁路表 | 在工具里另写一套「推荐链」绕过 Scheduler |

契约类型：`GateDecision`（`ok` + `messages[]`；`ok===false` 须硬拒）。

---

## 改哪里（按意图）

| 你想改的 | 打开 |
|----------|------|
| 默认路径 / 旁路表 / 回执下一步 | `ports/scheduler.ts`（再确认 ProductMap / SYSTEM_BRIEF 引用它） |
| 产品地图叙事 / 三阶段交接文案 | `ports/product.ts`（闭环句 ≡ Scheduler.defaultLine） |
| 质量面文案 / 毒点政策 / 书债线索 | `ports/quality-policy.ts` |
| 拆书双轴 / 准入 / combo / lean 卡块 | `ports/library.ts` |
| 灵感分喂 / forge / apply | `ports/inspiration.ts` |
| Accept 组合顺序与旗标默认 | `ports/accept-policy.ts` + `ports/config.ts` |
| 写后可选编辑 / A·B·C | `ports/edit.ts` + `tools/candidates.ts`；技能 `docs/skills/web-novel-master-optimizer.md` |
| 各闸软硬行为 | `*-gate.ts` |
| lean/full 方法包列表 | `ports/methods.ts` + `method-assets.ts` |
| 常驻硬规则短文 | `tools/brief.ts`（`SYSTEM_BRIEF`；保持短，细节指 product_map） |
| 当前小说状态 / happened 对齐 | `ports/foundation.ts` + `tools/candidates.ts`；读者合同 `method-assets.ts` |
| 库准入（声纹假阳） | `ports/library.ts` `admitCardContent` / `neutralizeVoiceNegations` |
| 工具名与参数壳 | `src/tools/*`（只接线，不藏策略） |
| 落盘路径与原子写 | `lib/store.ts`（谨慎；DATA.md 同步） |
| 面板 UI / HTTP | `src/client/client.js` + `lib/panel-html.ts` + `lib/http-api.ts`；见 [PANEL.md](./PANEL.md) |

Compose 入口：`src/index.ts` 只注册工具 + apply，不塞业务 if。

---

## 新能力怎么挂

1. **先定端口**：新策略 → 新 Port 或扩展现有 Port；导出挂到 `ports/index.ts`。  
2. **工具薄接**：`defineTool` → 调 Port → 回执引用 `Scheduler.nextHint(...)`。  
3. **地图/硬规则**：若改变「怎么跑」，更新 Scheduler（及必要时 SYSTEM_BRIEF 一句指针）。  
4. **测试**：一条**契约套件**，不是 N 条句子测试。  
   - 产品叙事（闭环句、分喂、互指）→ `test/contracts/product-loop.test.ts`  
   - 调度默认/旁路 → `test/contracts/scheduler.test.ts`  
   - 闸/传感 → `test/gates/`  
   - 支柱工序 → `test/pillars/`  
5. **断言偏好**：hit code / 硬拒 code；少绑中文长句；金样放 `test/fixtures/`。  
6. **禁止**：为 SYSTEM_BRIEF / dissect 新加的一句单独开 `test()`。  
7. **版本**：只改 docs → 可不升版；动契约/默认行为 → 升小版并改 `package.json` + STATUS + ProductMap/Scheduler `version` 对齐。  
8. **打包**：用户不主动要 zip **就不打包**。

---

## 改完自检

```bash
# 源码仓：
bun test
npm run typecheck
# 需要 dist 时再 npm run build

# 本发行包：
npm run smoke
```

确认：默认链仍最短合格；旁路仍显式；mind/craft 分喂未破；雷达默认仍软。

---

## 0.11.1

- **编辑深度优化（仍可选）**：`polish-depolish` brief / MODE_INFO 正向写成「保留呼吸与毛边」；明确去AI味 ≠ 磨成范文齐句；禁止为去味熨平句长、主语砍光。
- **技能** `web-novel-master-optimizer` 对齐同一口径；齐刷短句优先退回写手或换 `polish-rhythm`。
- **edit_stage 软提示**：对人味 `uniform_short_run` 等挂回执（不阻断 A/B/C）。
- A/B/C 契约不变；写手 lint 后仍可直 accept。
- 版本号与 ProductMap / Scheduler / EditPort `version` 对齐 **0.11.1**。

---

## 0.11.0


- **写后可选编辑**：`port.edit`；默认模式 `polish-depolish`；链上 lint 后可选 edit_brief→edit_stage→用户选 A/B/C。
- **路径 A**：一次确认 `confirm_accept_after_edit` = 应用编辑 + accept；未确认硬拒；未表态按 B；禁止静默验收。
- **反僵硬**：拆书 craft 抽打碎逻辑 + 本书载体；`allowedEdges` 应落纸；lean 一行正向；`stiffness_tidy` 默认 warn（非脏话配额）。
- **连续性**：lean n≥2 注入前章正文全文；对外「当前小说状态」。
- 版本号与 ProductMap / Scheduler / EditPort `version` 对齐 **0.11.0**。
- 更早小步说明见 [archive/CHANGE_NOTES_0.10.x.md](./archive/CHANGE_NOTES_0.10.x.md)。

