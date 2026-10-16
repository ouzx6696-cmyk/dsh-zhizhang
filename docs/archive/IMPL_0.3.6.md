# IMPL 0.3.6（原计划 0.3.5）· 续写吃前章 + happened

**版本字符串**：dsh-zhizhang **`0.3.6`**  
**基线**：0.3.5（bookCraft）  
**范围**：续写 brief 强制前章后果；accept 短追加 happened；灵感/章纲禁同构再演示。**未做** NovelSenseGate（→ **0.3.7**）；未打包。

## 改动

1. **`FoundationPort`**（`src/lib/ports/foundation.ts`）
   - `appendHappened(dir, {chapterId,text,title?})`：短行追加，`[chapterId]` 去重
   - `acceptReceiptLines`：happened / threads / book_ledger 回执
   - 不从正文杜撰长文

2. **`zhizhang_chapter_brief`**（`src/tools/methods.ts` + `formatReaderContract`）
   - n≥2：强制「前章后果」区 — ending + 摘要（处境/亲历）+ 文末摘录（≤600）
   - 缺 ending/正文 → 书感软提示；找不到前章 → continuation 警告
   - 续写头标：须消耗前章后果；禁止同骨架再演示

3. **`zhizhang_candidate_accept`**
   - 采纳后用 outline.ending 调用 `FoundationPort.appendHappened`
   - 回执含 `happened_appended` / `happened_remind` + threads

4. **`zhizhang_foundation_append_happened`**
   - 显式精修/补记（ending 为空或需改写时）

5. **InspirationPort / outline_set**
   - forge 输出要求 + outline styleReminder：**相邻禁同构**
   - outline_set 描述同步

6. **版本**：package / ProductMap → **0.3.6**；STATUS / FRAMEWORK / PORTS / DATA / README / SYSTEM_BRIEF §10

## 验收

- `bun test`：**87** pass / 0 fail
- `npm run typecheck` / `npm run build`：绿
- brief n≥2 含前章 ending + 落点；accept 后 happened 含 `[c00x]`

## 未做（0.3.7）

| 内容 | 说明 |
|------|------|
| **NovelSenseGate** | 同构 / 无书债 / 过闭环软警告（默认不硬拒） |
| 真机缩短提示词连写验收 | 建议 0.3.7 后做 |
| 打包 zip | 不默认 |

## 文件清单（主要）

- `src/lib/ports/foundation.ts`（新）
- `src/lib/ports/index.ts` / `product.ts` / `inspiration.ts`
- `src/lib/method-assets.ts`（formatReaderContract）
- `src/tools/methods.ts` / `candidates.ts` / `works.ts` / `brief.ts`
- `test/method-assets.test.ts` / `library-inspiration.test.ts` / version asserts
- `docs/STATUS.md` / `FRAMEWORK.md` / `PORTS.md` / `IMPL_0.3.6.md`

## 验收结果

- bun test: **87** pass / 0 fail
- typecheck / build: 绿
- 未打包、未做 NovelSenseGate
