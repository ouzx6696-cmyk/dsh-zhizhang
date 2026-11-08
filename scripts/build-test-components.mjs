import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
const path = (relative) => fileURLToPath(new URL(relative, import.meta.url));
// 写作区组件与桌面渲染层各打一个包；React 由测试运行时注入，失败栈经 sourcemap 指回源码。
const bundles = [
  ["../test/engine/components.jsx", "../build/test-components.cjs"],
  ["../test/renderer/entry.ts", "../build/test-renderer.cjs"],
];
await Promise.all(
  bundles.map(([entry, outfile]) =>
    build({
      entryPoints: [path(entry)],
      outfile: path(outfile),
      bundle: true,
      platform: "browser",
      format: "cjs",
      sourcemap: "inline",
      external: ["react", "react-dom"],
      define: {
        __WB_VERSION__: JSON.stringify(pkg.version),
        __WB_PACKAGE__: JSON.stringify(pkg.name),
      },
      logLevel: "warning",
    }),
  ),
);
