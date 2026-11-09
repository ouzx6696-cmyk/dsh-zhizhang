# 本地下载缓存

这个目录只放测试和构建时下载的运行时与工具，不是源码，也不含作品数据。

- `electron/`：Electron 45.2.3 压缩包缓存（约 151 MB，从 npmmirror 下载）。
- Electron 解压后的运行目录在 `node_modules/electron/dist`（约 357 MB），同样只属于本项目。
- 整个 `.cache` 目录可以随时直接删除；删掉后下次跑测试会重新下载。`node_modules` 也可随时重装。
- 下载统一指向这里，避免占用系统盘。目录已在 `.gitignore` 中忽略，只有本说明文件会被提交。

重新下载（Git Bash，在仓库根目录执行）：

```sh
electron_config_cache="$PWD/.cache/electron" \
ELECTRON_MIRROR="https://npmmirror.com/mirrors/electron/" \
ELECTRON_CUSTOM_DIR="{{ version }}" \
node node_modules/electron/install.js
```

