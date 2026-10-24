// Bridge between the desktop app's main process and the page (window.tabplayerDesktop in app.js).
const { contextBridge, ipcRenderer } = require('electron');

contextBridge.exposeInMainWorld('tabplayerDesktop', {
  /** Calls back with { name, bytes } for each file opened from Explorer, the command line or File > Open. */
  onOpenFile(callback) {
    ipcRenderer.on('open-file', (_e, file) => callback(file));
    ipcRenderer.invoke('renderer-ready'); // files waiting from startup are sent now
  },
});
