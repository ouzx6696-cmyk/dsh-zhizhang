/** The single renderer boundary for the preload bridge. */
export type DesktopApi = typeof window.writerDesktop;
export const desktop: DesktopApi = window.writerDesktop;
