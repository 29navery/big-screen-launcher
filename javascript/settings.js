const { ipcRenderer } = require('electron');
const fs = require('fs');
const path = require('path');

// Update Checking
async function getLatestVersion() {
    try {
        const response = await fetch('https://tungstenball.org/data/appversion.txt');
        if (!response.ok) throw new Error(`HTTP err, status ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error('Failed to load latest version:', error);
    }
}

function getMyVersion() {
    try {
        const versionPath = path.join(__dirname, 'appversion.txt');
        return fs.readFileSync(versionPath, 'utf8');
    } catch (error) {
        console.error("Error reading local version file:", error);
        return null;
    }
}

async function checkUpdates() {
    const latestRaw = await getLatestVersion();
    const myRaw = getMyVersion();

    const latest = latestRaw ? latestRaw.trim() : '';
    const myVersion = myRaw ? myRaw.trim() : '';

    const prompt = document.getElementById('update-prompt');
    const text = document.getElementById('update-version-text');

    if (latest && myVersion && latest > myVersion) {
        if (prompt) prompt.style.setProperty("display", "block");
        if (text) text.textContent = `Latest Version: ${latest}`;
    } else {
        if (prompt) prompt.style.setProperty("display", "none");
    }
}

checkUpdates();

const importLibraryButton = document.getElementById('import-library-btn');
if (importLibraryButton) {
    importLibraryButton.addEventListener('click', async () => {
        importLibraryButton.disabled = true;
        try {
            const result = await ipcRenderer.invoke('import-library-json');
            if (!result.canceled) {
                window.alert(`Library imported: ${result.added} added, ${result.updated} updated.`);
            }
        } catch (error) {
            console.error('Could not import library:', error);
            window.alert('Could not import library: ' + error.message);
        } finally {
            importLibraryButton.disabled = false;
        }
    });
}

const updateButton = document.getElementById('update-install-button');
if (updateButton) {
    updateButton.addEventListener("click", () => {
        ipcRenderer.send('restart-app');
    });
}

// elements
const startWithWindowsCb = document.getElementById('start-with-windows');
const appSFXCb = document.getElementById('app-sfx');
const showIpodCb = document.getElementById('show-ipod-automatically');
const keepIpodCb = document.getElementById('keep-ipod-front');
const yesTextInput = document.getElementById('yes-button-text-input');
const noTextInput = document.getElementById('no-button-text-input');
const xeniaDirInput = document.getElementById('xenia-directory');
const dolphinDirInput = document.getElementById('dolphin-directory');
const cemuDirInput = document.getElementById('cemu-directory');
const ryujinxDirInput = document.getElementById('ryujinx-directory');
const yuzuDirInput = document.getElementById('yuzu-directory');
const rpcs3DirInput = document.getElementById('rpcs3-directory');
const shadps4DirInput = document.getElementById('shadps4-directory');

// auto save
async function autoSave() {
    const settingsPayload = {
        startWithWindows: startWithWindowsCb ? startWithWindowsCb.checked : false,
        appSFX: appSFXCb ? appSFXCb.checked : false,
        showIpod: showIpodCb ? showIpodCb.checked : false,
        keepIpodOnTop: keepIpodCb ? keepIpodCb.checked : false,
        noTextInput: noTextInput.value.trim() || 'nah, nevermind',
        yesTextInput: yesTextInput.value.trim() || 'yeah, it sucked anyway',
        xeniaDirInput: xeniaDirInput.value.trim() || '',
        dolphinDirInput: dolphinDirInput.value.trim() || '',
        cemuDirInput: cemuDirInput.value.trim() || '',
        ryujinxDirInput: ryujinxDirInput.value.trim() || '',
        yuzuDirInput: yuzuDirInput.value.trim() || '',
        rpcs3DirInput: rpcs3DirInput.value.trim() || '',
        shadps4DirInput: shadps4DirInput.value.trim() || ''
    };

    try {
        await ipcRenderer.invoke('save-settings', settingsPayload);
    } catch (err) {
        console.error("Error auto-saving settings:", err);
    }
}

// load
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const settings = await ipcRenderer.invoke('load-settings');
        if (settings) {
            if (startWithWindowsCb) startWithWindowsCb.checked = !!settings.startWithWindows;
            if (appSFXCb) appSFXCb.checked = !!settings.appSFX;
            if (showIpodCb) showIpodCb.checked = !!settings.showIpod;
            if (keepIpodCb) keepIpodCb.checked = !!settings.keepIpodOnTop;
            if (noTextInput) noTextInput.value = settings.noTextInput || 'nah, nevermind';
            if (yesTextInput) yesTextInput.value = settings.yesTextInput || 'yeah, it sucked anyway';
            if (xeniaDirInput) xeniaDirInput.value = settings.xeniaDirInput || '';
            if (dolphinDirInput) dolphinDirInput.value = settings.dolphinDirInput || '';
            if (cemuDirInput) cemuDirInput.value = settings.cemuDirInput || '';
            if (ryujinxDirInput) ryujinxDirInput.value = settings.ryujinxDirInput || '';
            if (yuzuDirInput) yuzuDirInput.value = settings.yuzuDirInput || '';
            if (rpcs3DirInput) rpcs3DirInput.value = settings.rpcs3DirInput || '';
            if (shadps4DirInput) shadps4DirInput.value = settings.shadps4DirInput || '';
        }
    } catch (err) {
        console.error("Failed to load settings:", err);
    }

    if (startWithWindowsCb) startWithWindowsCb.addEventListener('change', autoSave);
    if (appSFXCb) appSFXCb.addEventListener('change', autoSave);
    if (showIpodCb) showIpodCb.addEventListener('change', autoSave);
    if (keepIpodCb) keepIpodCb.addEventListener('change', autoSave);
    if (yesTextInput) yesTextInput.addEventListener('input', autoSave);
    if (noTextInput) noTextInput.addEventListener('input', autoSave);
    if (xeniaDirInput) xeniaDirInput.addEventListener('input', autoSave);
    if (dolphinDirInput) dolphinDirInput.addEventListener('input', autoSave);
    if (cemuDirInput) cemuDirInput.addEventListener('input', autoSave);
    if (ryujinxDirInput) ryujinxDirInput.addEventListener('input', autoSave);
    if (yuzuDirInput) yuzuDirInput.addEventListener('input', autoSave);
    if (rpcs3DirInput) rpcs3DirInput.addEventListener('input', autoSave);
    if (shadps4DirInput) shadps4DirInput.addEventListener('input', autoSave);
});
// Locate emulator executables and persist the selected path.
for (const id of ['xenia', 'dolphin', 'cemu', 'ryujinx', 'yuzu', 'rpcs3', 'shadps4']) {
    document.getElementById(id + '-directory-button').addEventListener('click', async () => {
        try {
            const selected = await ipcRenderer.invoke('dialog:open-emulator-file');
            if (!selected) return;
            document.getElementById(id + '-directory').value = selected;
            await autoSave();
        } catch (error) { window.alert('Could not locate emulator: ' + error.message); }
    });
}
