import { fileURLToPath } from "node:url";
import { build } from "esbuild";
import { readFile } from "node:fs/promises";
const pkg = JSON.parse(await readFile(new URL("../package.json", import.meta.url), "utf8"));
await build({
  entryPoints: [fileURLToPath(new URL("../test/engine/components.jsx", import.meta.url))],
  outfile: fileURLToPath(new URL("../build/test-components.cjs", import.meta.url)),
  bundle: true,
  platform: "browser",
  format: "cjs",
  external: ["react", "react-dom"],
  define: { __WB_VERSION__: JSON.stringify(pkg.version), __WB_PACKAGE__: JSON.stringify(pkg.name) },
  logLevel: "warning",
});
