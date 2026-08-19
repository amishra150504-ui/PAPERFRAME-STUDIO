const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('paperframeDesktop', {
  openPrintPdf(bytes) {
    return ipcRenderer.invoke('paperframe-open-print-preview', bytes);
  },
  onOpenPdf(callback) {
    const listener = (_event, payload) => callback(payload);
    ipcRenderer.on('paperframe-open-pdf', listener);
    return () => ipcRenderer.removeListener('paperframe-open-pdf', listener);
  }
});
