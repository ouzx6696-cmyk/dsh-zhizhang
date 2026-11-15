import type { Clock } from "../clock.js";
import { acquireLease, type Lease } from "./lease.js";
import { createSerialRunner } from "./serial.js";
import {
  clearStaleLock,
  inspectStaleLocks,
  withWriteLock,
  type AuthorConfirmation,
  type ResourceKey,
  type StaleLock,
} from "./write-lock.js";

export interface LockService {
  lease(root: string): Promise<Lease>;
  write<T>(resource: ResourceKey, fn: () => Promise<T>, opts?: { wait?: number }): Promise<T>;
  serial<T>(key: string, fn: () => Promise<T>): Promise<T>;
  inspectStale(root: string): Promise<StaleLock[]>;
  clearStale(lock: StaleLock, confirm: AuthorConfirmation): Promise<void>;
}

export function createLockService(clock: Clock): LockService {
  const serial = createSerialRunner();
  return {
    lease: (root) => acquireLease(root, clock),
    write: (resource, fn, opts) => withWriteLock(resource, clock, fn, opts?.wait),
    serial,
    inspectStale: inspectStaleLocks,
    clearStale: clearStaleLock,
  };
}
