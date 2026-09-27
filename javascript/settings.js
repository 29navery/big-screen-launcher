const { ipcMain } = require('electron');
const fs = require('fs');
const path = require('path');

// spooky ahh version shit
async function getLatestVersion() {
    try {
        const response = await fetch('https://tungstenball.org/data/appversion.txt');
        if (!response.ok) throw new Error(`HTTP err, status ${response.status}`);
        return await response.text();
    } catch (error) {
        console.error('failed to load latest version:', error);
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
        console.log('Update available!!');
        if (prompt) prompt.style.setProperty("display", "block");
        if (text) text.textContent = `Latest Version: ${latest}`;
    } else {
        console.log(`Latest: "${latest}", Current: "${myVersion}"`);
        console.log('no updates..');
        if (prompt) prompt.style.setProperty("display", "none");
    }
}

checkUpdates();

const updateButton = document.getElementById('update-install-button');
if (updateButton) {
    updateButton.addEventListener("click", function(event) {
        ipcMain.invoke('restart-app');
    });
}

// steamgriddb!!!!
const apiKeyInput = document.getElementById('sgdb-api-key-input');
const saveSettingsButton = document.getElementById('save-settings-btn');

// loading . . .
window.addEventListener('DOMContentLoaded', async () => {
    try {
        const settings = await ipcRenderer.invoke('load-settings');
        if (apiKeyInput && settings && settings.apiKey) {
            apiKeyInput.value = settings.apiKey;
        }
    } catch (err) {
        console.error("Failed to load settings from AppData:", err);
    }
});

// saving . . .
if (saveSettingsButton) {
    saveSettingsButton.addEventListener('click', async () => {
        const apiKey = apiKeyInput ? apiKeyInput.value.trim() : '';
        const settings = { apiKey };

        try {
            const success = await ipcRenderer.invoke('save-settings', settings);
            if (success) {
                console.log("SteamGridDB API Key saved successfully to AppData!");
                alert("Settings saved successfully!");
            } else {
                alert("Failed to save settings.");
            }
        } catch (err) {
            console.error("Error saving settings:", err);
        }
    });
}