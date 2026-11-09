type PoolOutcome<T> = { status: "ok"; value: T } | { status: "failed"; error: unknown };
/**
 * 并发池：最多 limit 路同时在跑，完成一路就补位下一路；结果按输入顺序排列。
 * 纯函数：只管调度与单路失败隔离，任务内容与失败的含义都由调用方决定。
 */
export async function runTaskPool<T>(
  count: number,
  limit: number,
  worker: (index: number) => Promise<T>,
  options: { stopOn?: (error: unknown) => boolean } = {},
): Promise<PoolOutcome<T>[]> {
  const outcomes: PoolOutcome<T>[] = new Array(count);
  let next = 0,
    stopped = false;
  let failure: unknown;
  await Promise.all(
    Array.from({ length: Math.min(limit, count) }, async () => {
      for (;;) {
        if (stopped) return;
        const index = next++;
        if (index >= count) return;
        try {
          outcomes[index] = { status: "ok", value: await worker(index) };
        } catch (error) {
          // allow-catch: 池契约就是单路失败进结果，由调用方决定降级或整单报错。
          outcomes[index] = { status: "failed", error };
          if (!stopped && options.stopOn?.(error)) {
            stopped = true;
            failure = error;
          }
        }
      }
    }),
  );
  if (stopped) throw failure;
  return outcomes;
}
