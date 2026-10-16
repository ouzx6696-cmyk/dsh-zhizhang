# IMPL 0.3.7 · NovelSenseGate 书感软雷达

**版本字符串**：dsh-zhizhang **`0.3.7`**  
**基线**：0.3.6（novel_sense / bookCraft / 前章 brief / happened）  
**范围**：NovelSenseGate 软警告 + accept 接线 + 诊断工具。**未打包**；真机缩短提示词连写由父代理另派。

## 改动

1. **`NovelSenseGate`**（`src/lib/ports/novel-sense-gate.ts`）
   - 启发式：`same_skeleton_redemo`（对照 prevBody 发现链母题 / 短语复用）、`no_book_debt`、`closed_short_story`
   - 默认 warn `novel_sense_hits`；`strictNovel` → deny `novel_sense_strict`
   - 谦卑传感；中文提示；**不**与 HumanFeel 默认叠硬拒

2. **`AcceptPolicy`**
   - Brief → Lint → Payoff → HumanFeel → **NovelSense**
   - `prevBody` / `strictNovel`；`PortConfig.defaultStrictNovel=false`

3. **工具**
   - `zhizhang_novel_sense_audit`（可选 prev_chapter / prev_text；自动取上一章）
   - `zhizhang_candidate_accept` 增 `strict_novel`；续写自动加载前章正文

4. **版本**：package / ProductMap → **0.3.7**；STATUS / FRAMEWORK / PORTS / TOOLS / DATA / README / SYSTEM_BRIEF

## 验收

- `bun test`：**97** pass / 0 fail
- `npm run typecheck` / `npm run build`：绿
- fixture：同构换皮对轨 → warn；相邻人事章 → 不误报同构；过闭环 → warn

## 建议真机短提示验收（父代理）

1. 同一作品连写 01+02；提示词**缩短**（勿再长篇禁同构说明书）
2. 02 主戏应换（人压/账/关系），门禁可有 soft warn 但读感像追书
3. 章末有书债；勿独立短篇闭环
4. 对照旧《双轨冷柜》02 失败样：同骨架再对轨应被雷达警告

## 文件清单（主要）

- `src/lib/ports/novel-sense-gate.ts`（新）
- `src/lib/ports/accept-policy.ts` / `config.ts` / `audit.ts` / `index.ts` / `product.ts`
- `src/tools/candidates.ts` / `audit.ts` / `brief.ts`
- `test/novel-sense-gate.test.ts`
- `docs/IMPL_0.3.7.md` / STATUS / FRAMEWORK / PORTS / TOOLS

## 验收结果

- bun test: **97** pass / 0 fail
- typecheck / build: 绿
- 未打包、未做强制真机
