/** macOS 上修饰键用 ⌘（实际按键是 metaKey，全局快捷键同时接受 Ctrl 与 ⌘）。 */
const MAC = /Mac|iPhone|iPad/.test(navigator.platform);

/** 把“Ctrl K”这类写法按平台显示：macOS 显示“⌘K”，其它平台原样。 */
export function shortcutLabel(keys: string) {
  return MAC ? keys.replace(/Ctrl\s*\+?\s*/g, "⌘") : keys;
}
