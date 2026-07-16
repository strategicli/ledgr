// Preload bridge: exposes the `DesktopDataBridge` contract (src/lib/api-client.ts)
// on window.__ledgrDesktop, so the renderer's apiRequest() travels over IPC to
// the main process instead of over HTTP. contextIsolation stays on. ADR-139.
import { contextBridge, ipcRenderer } from "electron";

contextBridge.exposeInMainWorld("__ledgrDesktop", {
  request: (req: { method: string; path: string; body?: unknown }) =>
    ipcRenderer.invoke("ledgr:data", req),
});
