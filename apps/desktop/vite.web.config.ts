import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { defineConfig } from "vite";

const desktopDir = path.dirname(fileURLToPath(import.meta.url));
const pkg = JSON.parse(fs.readFileSync(path.join(desktopDir, "package.json"), "utf8")) as {
  version: string;
};

export default defineConfig({
  root: desktopDir,
  define: { __WB_VERSION__: JSON.stringify(pkg.version) },
  server: {
    hmr: false,
  },
  build: {
    outDir: path.join(desktopDir, "out", "web"),
    emptyOutDir: true,
    minify: "esbuild",
    cssMinify: "esbuild",
    rollupOptions: {
      input: path.join(desktopDir, "index.html"),
    },
  },
});
