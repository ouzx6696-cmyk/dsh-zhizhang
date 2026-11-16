import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";
import { importTs } from "../support/ts-loader.mjs";

const { atomicWrite } = await importTs("packages/core/src/fs/atomic.ts");

test("并发原子写同一目标文件 → 全部落盘成功（瞬时写锁错误经重试吸收）", async () => {
  // 回归：Windows 上同一目录/同一文件的并发原子写会瞬时 EPERM/EBUSY（码表归类为
  // storage.locked，transient/retry）。写入方不重试时，一次误碰就会让运行暂停、目标
  // 选择中断；此处用并发写逼出重叠窗口，断言重试后全部成功。
  const dir = await fs.mkdtemp(path.join(os.tmpdir(), "zz-atomic-retry-"));
  const target = path.join(dir, "record.json");
  const payload = JSON.stringify({ text: "雨落在旧码头的铁皮棚上。".repeat(20) });

  const results = await Promise.allSettled(
    Array.from({ length: 8 }, () => atomicWrite(target, payload)),
  );
  const rejected = results.filter((r) => r.status === "rejected");
  assert.deepEqual(
    rejected.map((r) => `${r.reason?.code}: ${r.reason?.message}`),
    [],
    "并发原子写不应有失败",
  );

  const stored = await fs.readFile(target, "utf8");
  assert.equal(stored, payload);
  // 目录里不残留任何 tmp 文件
  const leftover = (await fs.readdir(dir)).filter((name) => name.endsWith(".tmp"));
  assert.deepEqual(leftover, []);
});
