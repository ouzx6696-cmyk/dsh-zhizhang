/** Disposable workspaces and panel server for integration tests. */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createWork, ensureStorage } from "../dist/lib/store.js";
import { createPanelApiHandler, ZZ_API_PREFIX } from "../dist/lib/http-api.js";
export async function withWork(title = "测试作品") {
    const base = await mkdtemp(path.join(tmpdir(), "zhizhang-test-"));
    const paths = await ensureStorage({}, { storageRoot: base });
    const { meta, dir } = await createWork(paths, { title });
    return { base, paths, dir, key: meta.key, cleanup: () => rm(base, { recursive: true, force: true }) };
}
export async function servePanel(config = {}) {
    const server = createServer(createPanelApiHandler(config));
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return {
        api: `http://127.0.0.1:${port}${ZZ_API_PREFIX}`,
        close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
    };
}
export const jpost = (api, route, body) => fetch(`${api}${route}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});
