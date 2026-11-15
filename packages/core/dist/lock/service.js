import { acquireLease } from "./lease.js";
import { createSerialRunner } from "./serial.js";
import { clearStaleLock, inspectStaleLocks, withWriteLock, } from "./write-lock.js";
export function createLockService(clock) {
    const serial = createSerialRunner();
    return {
        lease: (root) => acquireLease(root, clock),
        write: (resource, fn, opts) => withWriteLock(resource, clock, fn, opts?.wait),
        serial,
        inspectStale: inspectStaleLocks,
        clearStale: clearStaleLock,
    };
}
