import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { VERSION } from "../../packages/core/src/version";
import path from "node:path";
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: {
      rollupOptions: {
        input: path.resolve("src/main/index.ts"),
        output: { entryFileNames: "main.js" },
      },
    },
  },
  preload: {
    build: {
      rollupOptions: {
        input: path.resolve("src/preload.ts"),
        output: { format: "cjs", entryFileNames: "preload.cjs" },
      },
    },
  },
  renderer: {
    plugins: [
      {
        name: "desktop-woff2",
        enforce: "pre",
        transform(code: string, id: string) {
          // Electron supports WOFF2; legacy WOFF copies only inflate the installer.
          if (id.includes("/@fontsource/") && id.endsWith(".css"))
            return code.replace(/,\s*url\([^)]*\.woff\)\s*format\(['"]woff['"]\)/g, "");
        },
      },
    ],
    root: ".",
    define: { __WB_VERSION__: JSON.stringify(VERSION) },
    build: {
      // electron-vite 默认不压缩渲染层；渲染包随安装包分发且每次启动都要解析，压缩后体积减半。
      minify: "esbuild",
      cssMinify: "esbuild",
      rollupOptions: { input: path.resolve("index.html") },
    },
  },
});
