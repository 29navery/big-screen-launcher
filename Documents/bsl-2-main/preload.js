const { contextBridge, ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Expose a safe API to your frontend renderer script
contextBridge.exposeInMainWorld('electronAPI', {

    openExternal: (url) => ipcRenderer.invoke('open-external-link', url),
    readLocalVersion: () => {
        try {
            const versionPath = path.join(__dirname, 'appversion.txt');
            return fs.readFileSync(versionPath, 'utf8').trim();
        } catch (error) {
            console.error("Error reading local version file:", error);
            return null;
        }
    }
});