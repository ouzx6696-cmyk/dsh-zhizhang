import crypto from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { classify } from "../errors/classify.js";
export async function atomicWrite(file, data, opts) {
    const dir = path.dirname(file);
    await fs.mkdir(dir, { recursive: true });
    const tmp = path.join(dir, `.${path.basename(file)}.${process.pid}.${crypto.randomUUID()}.tmp`);
    let fh;
    try {
        fh = await fs.open(tmp, "wx");
        await fh.writeFile(data);
        await fh.sync();
        await fh.close();
        fh = undefined;
        await fs.rename(tmp, file);
        try {
            const dfd = await fs.open(dir, "r");
            try {
                await dfd.sync();
            }
            finally {
                await dfd.close();
            }
        }
        catch (err) {
            const code = err.code;
            if (code === "EINVAL" || code === "ENOTSUP" || code === "EPERM") {
                opts?.onEinval?.(dir);
            }
            else {
                throw err;
            }
        }
    }
    catch (err) {
        if (fh)
            await fh.close().catch(() => undefined);
        await fs.rm(tmp, { force: true }).catch(() => undefined);
        throw classify(err);
    }
}
