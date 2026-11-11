/**
 * 窗口放大时界面按比例放大，而不是停在设计尺寸、四周留出大片空白。
 * 设计基准为默认窗口：宽 1380、可用高约 760（扣掉系统标题栏与菜单）。
 * 取宽高两个比例中较小者，保证放大后纵向仍放得下；不小于 1（小窗口靠响应式布局），
 * 不大于 1.75（超宽、超高屏不至于字大得离谱）；按 0.05 取整，拖动窗口时不会每个像素都重排。
 */
const ZOOM_BASE = { width: 1380, height: 760 } as const;
export const ZOOM_MAX = 1.75;

export function fitZoom(width: number, height: number): number {
  if (!(width > 0) || !(height > 0)) return 1;
  const ratio = Math.min(width / ZOOM_BASE.width, height / ZOOM_BASE.height);
  const clamped = Math.min(ZOOM_MAX, Math.max(1, ratio));
  return Math.round(clamped * 20) / 20;
}
