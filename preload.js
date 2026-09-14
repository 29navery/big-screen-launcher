const { contextBridge, ipcRenderer } = require('electron');
const invoke = (channel, ...args) => ipcRenderer.invoke(channel, ...args);
const onProgress = (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on('downloads:progress', handler);
  return () => ipcRenderer.removeListener('downloads:progress', handler);
};
const onImportProgress = (callback) => {
  const handler = (_event, payload) => callback(payload);
  ipcRenderer.on('imports:progress', handler);
  return () => ipcRenderer.removeListener('imports:progress', handler);
};
const onAppReopened = (callback) => {
  const handler = () => callback();
  ipcRenderer.on('app:reopened', handler);
  return () => ipcRenderer.removeListener('app:reopened', handler);
};
contextBridge.exposeInMainWorld('launcher', {
  appInfo: {
    version: () => invoke('app:version'),
    bootstrap: () => invoke('app:bootstrap'),
    checkUpdate: () => invoke('app:checkUpdate'),
    openDownloadPage: () => invoke('app:openDownloadPage'),
    openChangelogPage: () => invoke('app:openChangelogPage'),
    getChangelog: () => invoke('app:getChangelog'),
    onReopened: onAppReopened
  },
  windowControls: {
    minimize: () => invoke('window:minimize'),
    maximize: () => invoke('window:maximize'),
    close: () => invoke('window:close'),
    focus: () => invoke('window:focus')
  },
  system: { stats: () => invoke('system:stats'), storage: () => invoke('system:storage') },
  settings: { get: () => invoke('settings:get'), update: (s) => invoke('settings:update', s) },
  themes: {
    importCss: () => invoke('themes:import'),
    remove: () => invoke('themes:remove'),
    list: () => invoke('themes:list'),
    apply: (filePath) => invoke('themes:apply', filePath),
    importBackground: () => invoke('themes:backgroundImport'),
    removeBackground: () => invoke('themes:backgroundRemove'),
    openFolder: () => invoke('themes:openFolder'),
    openDocs: () => invoke('themes:openDocs'),
    getDocs: () => invoke('themes:getDocs')
  },
  folders: { choose: () => invoke('folders:choose') },
  library: { scan: () => invoke('library:scan') },
  imports: {
    list: () => invoke('imports:list'),
    confirm: (i) => invoke('imports:confirm', i),
    discard: (ids) => invoke('imports:discard', ids),
    importZip: () => invoke('imports:importZip'),
    importDropped: (paths) => invoke('imports:importDropped', paths),
    onProgress: onImportProgress
  },
  games: {
    list: () => invoke('games:list'),
    update: (id, u) => invoke('games:update', id, u),
    remove: (id) => invoke('games:remove', id),
    removeWithFiles: (id) => invoke('games:removeWithFiles', id),
    launch: (id) => invoke('games:launch', id),
    running: () => invoke('games:running'),
    repair: (id) => invoke('games:repair', id),
    browseFiles: (id) => invoke('games:browseFiles', id),
    stop: (id) => invoke('games:stop', id)
  },
  artwork: {
    refresh: (id) => invoke('artwork:refresh', id),
    refreshMissing: () => invoke('artwork:refreshMissing'),
    replace: (id, slot) => invoke('artwork:replace', id, slot),
    searchReplace: (id, title) => invoke('artwork:searchReplace', id, title)
  },
  downloads: {
    open: () => invoke('downloads:open'),
    openDrive: () => invoke('downloads:openDrive'),
    openUrl: (url) => invoke('downloads:openUrl', url),
    install: (input) => invoke('downloads:install', input),
    cancel: (name) => invoke('downloads:cancel', name),
    onProgress,
    catalog: () => invoke('downloads:catalog'),
    resolveManifest: () => invoke('downloads:resolveManifest')
  }
});
