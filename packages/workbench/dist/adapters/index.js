import { createDesktopAdapter } from "./desktop.js";
const bridge = globalThis
    .window.writerDesktop;
export const dataAdapter = createDesktopAdapter(bridge);
