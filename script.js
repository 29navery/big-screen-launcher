const { ipcRenderer } = require('electron');
const path = require("node:path");
const fs = require("node:fs");

const filePath = path.join(__dirname, "app-data.json");
const data = JSON.parse(fs.readFileSync(filePath, "utf8"));
const beta = data.beta;

document.addEventListener("DOMContentLoaded", () => {
    if (!beta) {
        document.getElementById("report-button").remove()
    }
});

// rail stuff
document.addEventListener('click', (e) => {
    const libraryBtn = e.target.closest('#library-button');
    const downloadsBtn = e.target.closest('#downloads-button');
    const settingsBtn = e.target.closest('#settings-button');
    const playerBtn = e.target.closest('#player-button');
    const reportBtn = e.target.closest('#report-button');

    if (libraryBtn) window.location.href = 'index.html';
    if (downloadsBtn) window.location.href = 'downloads.html';
    if (settingsBtn) window.location.href = 'settings.html';
    if (playerBtn) window.location.href = 'music.html';
    if (reportBtn) window.location.href = 'report.html';

    const prevBtn = e.target.closest('#sngctrl-prev');
    const playPauseBtn = e.target.closest('#sngctrl-play-pause');
    const nextBtn = e.target.closest('#sngctrl-next');

    if (prevBtn) {
        ipcRenderer.send('send-audio-command', { action: 'prev' });
    }
    if (playPauseBtn) {
        ipcRenderer.send('send-audio-command', { action: 'toggle' });
    }
    if (nextBtn) {
        ipcRenderer.send('send-audio-command', { action: 'next' });
    }
});

// mini player shii
ipcRenderer.on('receive-audio-status', (event, data) => {
    const timeDisplay = document.getElementById('miniplayer-time');
    const titleDisplay = document.getElementById('miniplayer-title');
    const artistDisplay = document.getElementById('miniplayer-artist');
    const imgDisplay = document.getElementById('miniplayer-img');
    const playPauseBtn = document.getElementById('sngctrl-play-pause');

    if (titleDisplay && data.title) {
        titleDisplay.innerText = data.title;
    }
    
    if (artistDisplay && data.artist) {
        artistDisplay.innerText = data.artist;
    }

    if (imgDisplay && data.cover) {
        imgDisplay.src = data.cover;
    }

    if (playPauseBtn && data.isPlaying !== undefined) {
        playPauseBtn.src = data.isPlaying ? 'svg/music/play-pause.svg' : 'svg/music/play.svg';
    }

    if (timeDisplay && data.currentTime !== undefined) {
        const curMins = Math.floor(data.currentTime / 60);
        const curSecs = Math.floor(data.currentTime % 60).toString().padStart(2, '0');
        const durMins = data.duration ? Math.floor(data.duration / 60) : 0;
        const durSecs = data.duration ? Math.floor(data.duration % 60).toString().padStart(2, '0') : '00';

        timeDisplay.innerText = `${curMins}:${curSecs} / ${durMins}:${durSecs}`;
    }
});

// load fast
ipcRenderer.send('request-audio-status');

// prompt buttons
async function initButtonTexts() {
    const settings = await ipcRenderer.invoke('load-settings') || {};
    
    const yesBtn = document.getElementById('deletion-prompt-yes');
    const noBtn = document.getElementById('deletion-prompt-no');

    if (yesBtn) yesBtn.textContent = settings.yesTextInput || 'yeah, it sucked anyway';
    if (noBtn) noBtn.textContent = settings.noTextInput || 'nah, nevermind';
}

initButtonTexts();

// update version number in titlebar
const numberBox = document.getElementById('version-number');

ipcRenderer.invoke('get-app-version').then((version) => {
    numberBox.textContent = 'v' + version;
});

// big boy master downloads bar
const topbarDownloadsContainer = document.getElementById('topbar-download-container');
const topbarDownloadsText = document.getElementById('topbar-download-text');
const topbarDownloadsProgress = document.getElementById('topbar-download-progress');

function renderTopbarDownload(state) {
    if (!topbarDownloadsContainer) return;
    const active = state?.active;
    if (!active) {
        topbarDownloadsContainer.style.display = 'none';
        if (topbarDownloadsProgress) topbarDownloadsProgress.style.width = '0%';
        return;
    }

    topbarDownloadsContainer.style.display = 'flex';
    const progress = active.progress || {};
    if (topbarDownloadsText) {
        const detail = progress.etaStr || 'Starting…';
        topbarDownloadsText.textContent = `${active.title} — ${detail}`;
    }
    if (topbarDownloadsProgress) {
        topbarDownloadsProgress.style.width = `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%`;
    }
}

if (topbarDownloadsContainer) topbarDownloadsContainer.style.display = 'none';
ipcRenderer.on('download-state', (_event, state) => renderTopbarDownload(state));
ipcRenderer.on('download-progress', (_event, progress) => {
    if (!topbarDownloadsContainer) return;
    if (progress.status === 'completed' || progress.status === 'cancelled' || progress.status === 'failed') return;
    topbarDownloadsContainer.style.display = 'flex';
    if (topbarDownloadsText) topbarDownloadsText.textContent = `${progress.title || progress.gameName} — ${progress.etaStr || 'Downloading…'}`;
    if (topbarDownloadsProgress) topbarDownloadsProgress.style.width = `${Math.max(0, Math.min(100, Number(progress.percent) || 0))}%`;
});
ipcRenderer.invoke('get-download-state').then(renderTopbarDownload).catch(error => console.warn('Could not read download state:', error));
