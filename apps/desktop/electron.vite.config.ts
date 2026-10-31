import { defineConfig, externalizeDepsPlugin } from "electron-vite";
import { VERSION } from "../../packages/core/src/version";
import path from "node:path";
export default defineConfig({
  main: {
    plugins: [externalizeDepsPlugin()],
    build: { rollupOptions: { input: path.resolve("src/main.ts") } },
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
    root: ".",
    define: { __WB_VERSION__: JSON.stringify(VERSION) },
    build: { rollupOptions: { input: path.resolve("index.html") } },
  },
});
