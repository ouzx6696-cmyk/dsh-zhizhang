/**
 * The lock is never broken on a timeout or PID check. If a process dies, an
 * operator must verify that no writer is active before removing the lock.
 * Only cooperating writers participate; external edits remain unprotected.
 */
export declare function withResourceLock<T>(root: string, fn: () => Promise<T>): Promise<T>;
