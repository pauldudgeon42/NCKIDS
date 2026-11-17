/*
 * The bridge between the page and the Mac app. Everything the page can ask the
 * app to do is listed here as window.NCDesktop; the browser version doesn't have it.
 */
const { contextBridge, ipcRenderer, webUtils } = require('electron');

const enc = (rel) => String(rel).split('/').map(encodeURIComponent).join('/');

contextBridge.exposeInMainWorld('NCDesktop', {
  isDesktop: true,
  info: () => ipcRenderer.invoke('app:info'),
  library: {
    current: () => ipcRenderer.invoke('lib:current'),
    choose: () => ipcRenderer.invoke('lib:choose'),
  },
  fs: {
    readText: (rel) => ipcRenderer.invoke('fs:readText', rel),
    writeText: (rel, text) => ipcRenderer.invoke('fs:writeText', rel, text),
    writeBytes: (rel, bytes) => ipcRenderer.invoke('fs:writeBytes', rel, bytes),
    copyIn: (src, rel) => ipcRenderer.invoke('fs:copyIn', src, rel),
    remove: (rel) => ipcRenderer.invoke('fs:remove', rel),
    list: (rel) => ipcRenderer.invoke('fs:list', rel),
    url: (rel) => 'nclib://library/' + enc(rel),
  },
  /** Where a file chosen in a file picker lives on disk (lets the app copy it instead of reading it into memory). */
  pathForFile: (file) => { try { return webUtils.getPathForFile(file) || ''; } catch (e) { return ''; } },
  /** Folder import: returns { folder, files: [{ path, name, size, type, url }] } or null if cancelled. */
  pickFolderFiles: async (exts) => {
    const r = await ipcRenderer.invoke('pick:folderFiles', exts);
    if (r) r.files.forEach((f) => { f.url = 'ncfile://picked/?p=' + encodeURIComponent(f.path); });
    return r;
  },
  http: { request: (url, opts) => ipcRenderer.invoke('http:request', url, opts) },
  secrets: {
    get: (key) => ipcRenderer.sendSync('secret:get', key),
    set: (key, value) => ipcRenderer.sendSync('secret:set', key, value),
    remove: (key) => ipcRenderer.sendSync('secret:remove', key),
  },
  tvStatus: () => ipcRenderer.invoke('tv:status'),
  /** Phone remote (desktop/remote-server.js). */
  remote: {
    status: () => ipcRenderer.invoke('remote:status'),
    start: () => ipcRenderer.invoke('remote:start'),
    stop: () => ipcRenderer.invoke('remote:stop'),
    newCode: () => ipcRenderer.invoke('remote:newCode'),
    publish: (kind, data) => ipcRenderer.send('remote:publish', kind, data),
    onCommand: (cb) => ipcRenderer.on('remote:cmd', (e, cmd) => cb(cmd)),
    onStatus: (cb) => ipcRenderer.on('remote:status', (e, st) => cb(st)),
  },
});
