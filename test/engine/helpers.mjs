import { readFileSync } from "node:fs";
import { Script } from "node:vm";
/** 引擎测试用：临时作品与写作台接口服务。 */
import { mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { createServer } from "node:http";
import { createWork, ensureStorage } from "../../build/fanqie/src/engine/store.js";
import { fanqieApi } from "../../build/fanqie/src/workbench/api.js";
import { API } from "../../build/workbench/src/routes.js";
export async function withWork(title = "测试作品") {
    const base = await mkdtemp(path.join(tmpdir(), "writer-engine-test-"));
    const paths = await ensureStorage(null, { storageRoot: base });
    const { meta, dir } = await createWork(paths, { title });
    return { base, paths, dir, key: meta.key, cleanup: () => rm(base, { recursive: true, force: true }) };
}
export async function servePanel(config = {}) {
    const mode = fanqieApi(config);
    const server = createServer(async (req, res) => {
        const url = new URL(req.url, 'http://writer.test');
        const chunks = [];
        for await (const chunk of req) chunks.push(chunk);
        const body = Buffer.concat(chunks).toString('utf8');
        const ctx = { url, method: req.method, path: url.pathname,
            body: async () => body ? JSON.parse(body) : {},
            json: (status, data) => { res.writeHead(status, {'content-type':'application/json'}); res.end(JSON.stringify(data)); } };
        if (!await mode.handle(ctx)) ctx.json(404, {ok:false,code:'not_found'});
    });
    await new Promise(resolve => server.listen(0, "127.0.0.1", resolve));
    const { port } = server.address();
    return {
        api: `http://127.0.0.1:${port}${API}`,
        close: () => new Promise((resolve, reject) => server.close(err => err ? reject(err) : resolve())),
    };
}
export const jpost = (api, route, body) => fetch(`${api}${route}`, {
    method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body),
});

export function loadComponents(react) {
    const module = { exports: {} };
    new Script(readFileSync(new URL('../../build/test-components.cjs', import.meta.url), 'utf8')).runInNewContext({
        module, exports: module.exports,
        require(id) { if (id === 'react') return react; if (id === 'react-dom') return {createPortal: node => node}; throw new Error('Unexpected component dependency: ' + id); },
        URL, AbortController, setTimeout, clearTimeout,
    });
    return module.exports;
}
