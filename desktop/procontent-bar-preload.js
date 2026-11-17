// The ProContent window's toolbar may only ask for these.
const { contextBridge, ipcRenderer } = require('electron');
contextBridge.exposeInMainWorld('NCBar', {
  nav: (what) => ipcRenderer.send('pc:nav', what),
  onState: (cb) => ipcRenderer.on('pc:bar', (e, st) => cb(st)),
});
