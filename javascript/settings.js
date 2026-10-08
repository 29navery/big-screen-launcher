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

const updateButton = document.getElementById('update-install-button');
if (updateButton) {
    updateButton.addEventListener("click", () => {
        ipcRenderer.send('restart-app');
    });
}

// elements
const startWithWindowsCb = document.getElementById('start-with-windows');
const showIpodCb = document.getElementById('show-ipod-automatically');
const keepIpodCb = document.getElementById('keep-ipod-front');
const yesTextInput = document.getElementById('yes-button-text-input');
const noTextInput = document.getElementById('no-button-text-input');

// auto save
async function autoSave() {
    const settingsPayload = {
        startWithWindows: startWithWindowsCb ? startWithWindowsCb.checked : false,
        showIpod: showIpodCb ? showIpodCb.checked : false,
        keepIpodOnTop: keepIpodCb ? keepIpodCb.checked : false,
        noTextInput: noTextInput.value.trim() || 'nah, nevermind',
        yesTextInput: yesTextInput.value.trim() || 'yeah, it sucked anyway'
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
            if (showIpodCb) showIpodCb.checked = !!settings.showIpod;
            if (keepIpodCb) keepIpodCb.checked = !!settings.keepIpodOnTop;
            if (noTextInput) noTextInput.value = settings.noTextInput || 'nah, nevermind';
            if (yesTextInput) yesTextInput.value = settings.yesTextInput || 'yeah, it sucked anyway';
        }
    } catch (err) {
        console.error("Failed to load settings:", err);
    }

    if (startWithWindowsCb) startWithWindowsCb.addEventListener('change', autoSave);
    if (showIpodCb) showIpodCb.addEventListener('change', autoSave);
    if (keepIpodCb) keepIpodCb.addEventListener('change', autoSave);
    if (yesTextInput) yesTextInput.addEventListener('input', autoSave);
    if (noTextInput) noTextInput.addEventListener('input', autoSave);
});