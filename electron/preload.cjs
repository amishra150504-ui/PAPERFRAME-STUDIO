const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperframeDesktop', {
  onOpenPdf(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('paperframe-open-pdf', listener);
    return () => ipcRenderer.removeListener('paperframe-open-pdf', listener);
  }
});
