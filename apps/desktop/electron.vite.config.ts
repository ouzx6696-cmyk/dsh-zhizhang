import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { VERSION } from "../../packages/core/src/version";
import { CONTENT_SECURITY_POLICY } from "./src/main/csp";
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
      {
        // 生产窗口走 file://，响应头不生效，策略只能写进页面；开发服务器不注入（见 csp.ts）。
        name: "desktop-csp",
        apply: "build",
        transformIndexHtml: () => [
          {
            tag: "meta",
            attrs: { "http-equiv": "Content-Security-Policy", content: CONTENT_SECURITY_POLICY },
            injectTo: "head-prepend",
          },
        ],
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
